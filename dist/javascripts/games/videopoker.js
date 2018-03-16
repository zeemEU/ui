Loader.require("vp")
.then(function(vp){
	ethUtil.onStateChanged((state)=>{
		if (!state.isConnected) return;
		syncAllGames().then(syncUserCredits);
	});

	const $gameCtnr = $("#Machine .game-ctnr");
	const $tabberCtnr = $("#Machine .tabber-ctnr");
	const $credits = $("#Machine .credits-ctnr");


	const tabber = new Tabber();
	tabber.onNewGame(()=>{
		const game = createGame(null, getVpSettings(false));
		tabber.selectGame(game);
	});
	tabber.onSelected((game) => {
		$gameCtnr.children().detach();
		$gameCtnr.append(game.$e);
		game.$e.removeClass("flash");
		setTimeout(()=>{ game.$e.addClass("flash"); }, 10);
	})
	$tabberCtnr.append(tabber.$e);

	// An id-mapping of gameState objects' blockchain values, reset each block.
	var gameStates = {};

	function createGame(gameState, settings) {
		if (!gameState) gameState = {state: "betting"};
		
		game = new Game(vp);
		game.onEvent(updateGameFromEvent);
		game.setSettings(settings);
		game.setGameState(gameState);
		tabber.addTab(game);
		return game;
	}

	// Updates a Game's settings and state, and optionally creates it.
	function updateGame(gameState, settings, createIfNotFound, forceUpdate) {
		var game = tabber.getGames().find(g => {
            // If game is dealt, look for matching UIID.
            // UIID was sent along with the bet.
			return gameState.state == "dealt"
				? g.getGameState().uiid == gameState.uiid
				: g.getGameState().id == gameState.id;
		});

		if (game) {
            // Update settings, if passed.
            if (settings) game.setSettings(settings);
            // Update gameState if we have a newer version of it
            if (forceUpdate || gameState.blockLoaded > (game.getGameState().blockLoaded || 0)) {
                game.setGameState(gameState);
                tabber.refreshDeletable(game);
            }
		} else {
			if (createIfNotFound) createGame(gameState, settings);
		}
	}

    // - Creates all bet or drawn+won Games.
    // - Updates all displayed game's states.
    // - Notifies falsely-existant game's of their perile.
    function updateSyncedGames(settings) {
        // Update games (create if necessary)
        Object.values(gameStates).forEach(gs => updateGame(gs, settings, gs.isActive));

        // Go through tabber's games, and make sure they're all updated.
        const touchedIds = Object.values(gameStates).map(gs => gs.id);
        tabber.getGames().forEach(g => {
            const gs = g.getGameState();
            const id = gs.id;
            // No id -- it's betting. Just update settings.
            if (!id) { g.setSettings(settings); return; }
            // It's already been updated. Do nothing.
            if (touchedIds.indexOf(id) >= 0) return;
            // Game exists in tabber, but not on blockchain! It's invalid.
            gs.isInvalid = true;
            gs.isActive = false;
            gs.blockLoaded = settings.latestBlock.number;
            updateGame(gs);
        });

        if (!tabber.hasTabs()) createGame(null, settings);
    }

	// Collates event data into gameState, and forcibly updates the Game.
	// This should be called when games complete a transaction.
	function updateGameFromEvent(ev) {
		const gameState = updateGameStateFromEvent(ev);
        gameState.blockLoaded = ev.blockNumber;
		updateGame(gameState, null, false, true);
	}

	// Updates a gameState from an event received.
	function updateGameStateFromEvent(ev) {
		const id = ev.args.id.toNumber();
		var gs = gameStates[id];
		const curBlock = ethUtil.getCurrentStateSync().latestBlock.number;
        const blockLoaded = Math.max(curBlock, ev.blockNumber);

		// Clobber gameState with data from event.
		if (ev.name == "BetSuccess") {
			gs = {
				state: "dealt",
				id: id,
				uiid: ev.args.uiid.toNumber(),
				bet: ev.args.bet,
				payTableId: ev.args.payTableId,
				payTable: getPayTable(ev.args.payTableId.toNumber()),
				iBlock: ev.blockNumber,
				iBlockHash: ev.blockHash,
				iBlocksLeft: null,
				iHand: PUtil.getIHand(ev.blockHash, id),
				draws: new BigNumber(0),
				dBlock: null,
				dBlockHash: null,
				dBlocksLeft: null,
				dHand: null,
				handRank: null,
				payout: null,
                isWinner: false,
                isInvalid: false,
                isActive: null,
                blockLoaded: null
			};
			// compute iHand, dHand
			gs.iBlocksLeft = Math.max((gs.iBlock + 255) - curBlock, 0);
			gs.iHand = gs.iBlocksLeft > 0 ? gs.iHand : new PUtil.Hand(0);
            gs.isActive = true;
            gs.blockLoaded = blockLoaded;
			gameStates[id] = gs;
			return gs;
		}

		// Tack on draw data, if we've seen the game bet.
		if (ev.name == "DrawSuccess") {
			if (!gs) return;

			gs.state = "drawn";
			gs.draws = ev.args.draws;
			gs.dBlock = ev.blockNumber;
			gs.dBlockHash = ev.blockHash;
			gs.iHand = new PUtil.Hand(ev.args.iHand);

			// compute blocksLeft, iHand, dHand, handRank, payout
			gs.dBlocksLeft = Math.max((gs.dBlock + 255) - curBlock, 0);
			gs.dHand = PUtil.getDHand(gs.dBlockHash, id, gs.iHand.toNumber(), gs.draws)
			gs.dHand = gs.dBlocksLeft > 0 ? gs.dHand : gs.iHand;
            gs.draws = gs.dBlocksLeft > 0 ? gs.draws : new BigNumber(31);
			gs.handRank = gs.dHand.getRank();
			gs.payout = gs.bet.mul(gs.payTable[gs.handRank]);
            gs.isWinner = gs.payout.gt(0);
			gs.isActive = gs.isWinner ? true : false;
            gs.blockLoaded = blockLoaded;
			return gs;
		}

		// Tack on finalization data, if we've seen the game bet.
		if (ev.name == "FinalizeSuccess") {
			if (!gs) return;

			gs.state = "finalized";
			gs.dHand = new PUtil.Hand(ev.args.dHand);
			gs.handRank = ev.args.handRank.toNumber();
			gs.payout = ev.args.payout;
            gs.isWinner = gs.payout.gt(0);
			gs.isActive = false;
            gs.blockLoaded = blockLoaded;
			return gs;
		}

		throw new Error(`Unexpected event: ${ev.name}`);
	}

	// - Loads all pending gameStates from events, adds to tabber.
	// - Notifies any tabbed games (with no events) of error.
	//
	// Note: It's possible a user has created a game way in the past
	//  and not taken any action. These games are still "alive"
	//  but _this_ UI will not show them. Otherwise, calls to
	//  the provider may become prohibitively expensive.
	function syncAllGames() {
		const state = ethUtil.getCurrentStateSync();
		const curUser = state.account;
		if (!curUser) { return; }

		const blockCutoff = state.latestBlock.number - 11520; // approx 48 hrs.
		return Promise.all([
            getVpSettings(true),
			vp.getEvents("BetSuccess", {user: curUser}, blockCutoff),
    		vp.getEvents("DrawSuccess", {user: curUser}, blockCutoff),
    		vp.getEvents("FinalizeSuccess", {user: curUser}, blockCutoff),
    		loadPayTables()
		]).then(arr=>{
            const settings = arr[0];

			// Delete games older than a block. They will be repopulated.
            // This assumes the provider has an event lag of at most 1 block.
			Object.keys(gameStates).forEach(id=>{
                const gs = gameStates[id];
                if (settings.latestBlock.number > gs.blockLoaded) {
                    delete gameStates[id];
                }
            });

			// Update states of all the games we've gotten.
			// First BetSuccess, then DrawSuccess, then FinalizeSuccess.
			arr[1].forEach(updateGameStateFromEvent);
			arr[2].forEach(updateGameStateFromEvent);
			arr[3].forEach(updateGameStateFromEvent);

			// Update game objects, creating tabs if necessary
			updateSyncedGames(settings);
		});
	}

	function syncUserCredits(){
		const state = ethUtil.getCurrentStateSync();
		const curUser = state.account;
		if (!curUser) {
			$credits.text("No account");
			return;
		}
		vp.credits([curUser]).then(eth=>{
			$credits.text(`${ethUtil.toEthStr(eth, 7, "ETH", true)}`);
		})
	}


	//////////////////////////////////////////////////////////////
	/// HELPER FUNCTIONS /////////////////////////////////////////
	//////////////////////////////////////////////////////////////

	const payTables = [];
	function loadPayTables() {
		return vp.numPayTables().then((n)=>{
			n = n.toNumber();
			
			const promises = [];
			for (var i=payTables.length; i<n; i++) {
				let index = i;
				promises.push(vp.getPayTable([index]).then(pt => {
					payTables[index] = pt;
				}));
			}
			return Promise.all(promises);
		});
	}
	function getPayTable(i) {
		if (!payTables[i]) throw new Error(`Paytable #${i} not yet loaded.`);
		return payTables[i];
	}

	var getAverageBlockTime = (function(){
		var avgBlockTime = 15000;

		function updateAvgBlockTime() {
			ethUtil.getAverageBlockTime().then(timeMs=>{
				avgBlockTime = timeMs;
			});
		}
		setInterval(updateAvgBlockTime, 60000);
		updateAvgBlockTime();
		
		return function(){
			return avgBlockTime;
		}
	}());

	// Returns settings that all games need to know about.
	var getVpSettings = (function(){
		var curSettings;

		return function getVpSettings(fresh) {
			if (!fresh) return curSettings;

            const state = ethUtil.getCurrentStateSync();
            const curUser = state.account;
            const creditsPromise = curUser
                ? vp.credits([curUser])
                : Promise.resolve(new BigNumber(0));

			return Promise.all([
				vp.minBet(),
				vp.maxBet(),
				vp.curMaxBet(),
				vp.getCurPayTable(),
				creditsPromise
			]).then(arr => {
				curSettings = {
					minBet: arr[0],
					maxBet: BigNumber.min(arr[1], arr[2]),
					curPayTable: arr[3],
                    credits: arr[4],
					latestBlock: state.latestBlock,
					avgBlockTime: getAverageBlockTime()
				};
				return curSettings;
			});
		}
	}());
});

// Simple tabber that understands what games are.
// Listens for game events and displays summary in tab.
// Only allows closing of tab for non-active games.
function Tabber() {
	const _self = this;

	const _$e = $(`
		<div class="Tabber">
			<div class='tab new'>
				<div>New Machine...</div>
			</div>
		</div>
	`);

	var _onNewGame = ()=>{};
	var _onSelected = ()=>{};

	const _$newTab = _$e.find(".tab.new").click(function(){
		_onNewGame();
	});

	// an array of tabs to tabObjs
	const _tabs = [];

	this.onNewGame = function(fn) { _onNewGame = fn; };
	this.onSelected = function(fn) { _onSelected = fn; };
	this.addTab = function(game) {
		const tab = {};
		_tabs.push(tab);

		// create tab element, clicking selects it, animate it in.
		const $e = $(`
			<div class='tab shrunken'>
				<div class="remove">×</div>
				<div class="title">Machine 1</div>
				<div class="status"></div>
			</div>
		`).click(()=>{ _self.selectTab(tab); }).insertBefore(_$newTab);
		setTimeout(()=>{ $e.removeClass("shrunken"); }, 10);

		// initialize the elements
		const $remove = $e.find(".remove").click((e) => {
			e.stopPropagation();
			_self.deleteTab(tab);
		});
		$e.find(".title").text(`Machine ${_tabs.length}`);
		$e.find(".status").append(game.$ms);

		// set tab properties
		tab.$e = $e;
		tab.$remove = $remove;
		tab.game = game;
		tab.isSelected = false;

		// refresh delete button, select tab if its the only one
		if (_tabs.length == 1) _self.selectTab(tab);
		_self.refreshDeletable();
		return tab;
	}
	this.deleteTab = function(tab) {
		tab.$e.addClass("shrunken");
		setTimeout(()=>{ tab.$e.remove(); }, 200);
		const index = _tabs.indexOf(tab);
		_tabs.splice(index, 1);
		if (tab.isSelected) {
			// select the tab to the right, or left.
			_self.selectTab(_tabs[index] ? _tabs[index] : _tabs[index-1]);
		}
		_self.refreshDeletable();
	}
	this.selectTab = function(tab){
		if (!tab || tab.isSelected) return;
		_tabs.forEach(t => {
			t.isSelected = t == tab;
			t.isSelected ? t.$e.addClass("selected") : t.$e.removeClass("selected");
		});
		_onSelected(tab.game);
	}
	this.selectGame = function(game) {
		_self.selectTab(_tabs.find(t => t.game == game));
	}
	this.hasTabs = function(){
		return _tabs.length > 0;
	}
	this.getGames = function(){
		return _tabs.map(t=>t.game);
	}
	this.refreshDeletable = function(){
		if (_tabs.length == 1) { _tabs[0].$remove.hide(); return; }
		_tabs.forEach(t=>{
			t.game.getGameState().isActive ? t.$remove.hide() : t.$remove.show();	
		});
	}
	this.$e = _$e;
}

// Game Object that gets it state set externally.
function Game(vp) {
	const _$e = $(".Game.template").clone().removeClass("template").show();
	const _$payTable = _$e.find(".payTable");
    // better, hand, miniHand
    const _better = util.getBetter();
    const _hd = new HandDisplay();
    const _miniHd = new HandDisplay();
	// status
	const _$status = _$e.find(".gameStatus");
	const _$details = _$status.find(".details");
	const _$gameBet = _$details.find(".gameBet");
	const _$gameId = _$details.find(".gameId");
    const _$msg = _$status.find(".msg");
	const _$required = _$status.find(".required");
    const _$invalid = _$e.find(".invalid");
	// mini-status
	const _$ms = _$e.find(".mini-status").detach();
	const _$msState = _$ms.find(".state");
    const _$msHand = _$ms.find(".hand");
    const _$msLoading = _$ms.find(".loading");
    // this holds all children actions
    const _$fieldCtnr = _$e.find(".field-ctnr");
    	// state = betting
    	const _$bet = _$fieldCtnr.find(".actionArea.bet");
    	// state = dealt
    	const _$draw = _$fieldCtnr.find(".actionArea.draw").hide();
    	// state = drawn (win)
    	const _$finalizeWin = _$fieldCtnr.find(".actionArea.finalizeWin").hide();
            const _$chkBetAgain = _$finalizeWin.find(".chk-bet-again");
            const _$willBetFull = _$finalizeWin.find(".will-bet-full");
            const _$willCreditFull = _$finalizeWin.find(".will-credit-full");
            const _$willBetSome = _$finalizeWin.find(".will-bet-some");
            const _$willCreditSome = _$finalizeWin.find(".will-credit-some");
        // state = drawn (loss)
    	const _$finalizeLoss = _$fieldCtnr.find(".actionArea.finalizeLoss").hide();
        // state = finalized
    	const _$finalized = _$fieldCtnr.find(".actionArea.finalized").hide();
    // buttons
	const _$btnPlayAgain = _$e.find(".btnPlayAgain");

    // Insert hand objects to correct spots
    _hd.$e.appendTo(_$e.find(".hd-ctnr"));
    _hd.onDrawsChanged(_refreshDrawBtn);
    _miniHd.$e.appendTo(_$msHand);
    _miniHd.freeze(true);
    _better.$e.prependTo(_$bet);

    // Events
    _$btnPlayAgain.click(()=>{
        _self.setGameState({state: "betting"});
    });
    _$chkBetAgain.click(_refreshBetAgain);
    _better.onChange(_refreshPayTable);

	// const _$logs = _$e.find(".logs").hide();
	const _self = this;

	// global params, set externally
	const _vp = vp;
	var _maxBet;
	var _curPayTable;
	var _latestBlock;
	var _avgBlockTime;

	// state of the currentGame
	var _gameState = {};
	var _isSkippingDrawing = false;
    var _isTransacting = false;
    var _isError = false;

	var _onEvent = ()=>{};

	this.$e = _$e;
	this.$ms = _$ms;

	this.onEvent = (fn) => _onEvent = fn;

	this.getGameState = () => Object.assign({}, _gameState);

	// Sets global settings, so better and blocktimes are accurate.
	this.setSettings = function(settings) {
		if (!settings) return;
		_maxBet = settings.maxBet;
		_curPayTable = settings.curPayTable;
		_latestBlock = settings.latestBlock;
		_avgBlockTime = settings.avgBlockTime;
        _better.setMin(settings.minBet);
        _better.setMax(settings.maxBet);
        _better.setCredits(settings.credits);
		_refreshDebounce();
	}

    // Sets the gameState of the game. Causes a refresh.
	this.setGameState = function(gameState) {
        // Skip re-updating state to "dealt" if we're skipping drawing.
        // Unless there's a new hand -- then we should show it.
		if (_isSkippingDrawing && gameState.state=="dealt") {
			const curHand = _gameState.iHand.toNumber();
			const dealtHand = gameState.iHand.toNumber();
			if (curHand==dealtHand) return;
		}
        // These are resets that should only happen once per game.
        if (gameState.id !== _gameState.id) {
            _isSkippingDrawing = false; // no longer skipping (case needed: dealt -> fake-drawn)
            _refreshHand(null, 31);     // reset cards to empty (case needed: finalize -> dealt)
        }
        // These are resets that should happen once per state.
        if (gameState.state != _gameState.state) _resetTx();
        _gameState = Object.assign({}, gameState);
        _refreshDebounce();
	}

	// Resets everything that is state-specific.
	function _resetTx() {
        // Revert tx-specific variables.
        _isTransacting = false;
        _isError = false;

        // Revert all TX related DOM changes.
        _$msLoading.hide();
		_$e.find(".statusArea").empty().hide();
        _$e.find(".actionBtn").removeClass("disabled").removeAttr("disabled")
            .each((i,e)=>{ $(e).text($(e).data("txt-default")); });
	}

	// Draws miniStatus, payTable, hand, and shows correct actionArea
	function _refresh() {
        _refreshMiniStatus();
        _refreshPayTable();

        // reset all things that may change within the same state.
        _$fieldCtnr.removeAttr("disabled");
        _$e.removeClass("isWinner isInvalid");
        _$e.find(".actionArea").hide();
        _$invalid.hide();
        _$payTable.find("tr").removeClass("won");
        _$details.hide();
        _$required.hide();

        // If game is invalid, show invalid message and disable all form elements.
        if (_gameState.isInvalid) {
            _$e.addClass("isInvalid");
            _$invalid.show();
            _$fieldCtnr.attr("disabled", "disabled");
        } 

        // Betting. simply show the bet actionArea and an empty hand.
        // We can return here.
        if (_gameState.state=="betting") {
            _$bet.show();
            _$msg.text(`Select a bet amount, and press "Deal"`)
            _better.setMode("both");
            _better.freeze(false);
            _refreshHand(null, 31);
            return;
        };

        // Show the bet, id, and update better to be bet amount.
        _$details.show();
        _$gameBet.text(`Bet: ${_eth(_gameState.bet)}`);
        _$gameId.text(`Game #${_gameState.id}`);
        _better.setBet(_gameState.bet);

        // It's a winner, add class and hilite paytable entry.
        if (_gameState.isWinner) {
            _$e.addClass("isWinner");
            _$payTable.find("tr").eq(_gameState.handRank).addClass("won");
        }

        // It's dealt, show draw actionArea, relevant status, and hand.
        if (_gameState.state == "dealt") {
            _$draw.show();
            // If iHand is valid: Show it and allow holding if not transacting.
            // If iHand is not valid: Show it and force zero holds.
            if (_gameState.iBlocksLeft > 0) {
                _$msg.html(`Your cards have been dealt.<br>Select cards to hold, and click "Draw"`);
                _$required.show().text(`You must draw within ${_gameState.iBlocksLeft} blocks.`);
                _refreshHand(_gameState.iHand, null, _isTransacting ? null : false);
            } else {
                _$msg.html(`Your dealt cards are no longer availabe.<br>Please click "Draw" for a new hand.`);
                _refreshHand(null, 31, true);
            }
            return;
        }

        // It's drawn. Show final hand, and win/loss actionArea and relevant details.
        if (_gameState.state == "drawn") {
            _refreshHand(_gameState.dHand, _gameState.draws, true, true);
            if (_gameState.isWinner){
                _$finalizeWin.show();
                _$msg.empty().append(`You won ${_eth(_gameState.payout)} with ${_gameState.dHand.getRankString()}!`);
                _refreshBetAgain();

                // Show required message if there are dBlocksLeft.
                if (_gameState.dBlocksLeft > 0) {
                    _$required.show().text(`You must claim your winnings within ${_gameState.dBlocksLeft} blocks.`);
                }
            } else {
                _$finalizeLoss.show();
                _$msg.empty().append(`You lost. Try again?`);
            }
            return;
        }

        // They finalized. Show the final hand and message.
        if (_gameState.state == "finalized") {
            _$finalized.show();
            _refreshHand(_gameState.dHand, _gameState.draws, true, true);
            _$msg.empty().append(`You've been credited ${_eth(_gameState.payout)} for ${_gameState.dHand.getRankString()}.`);
            return;
        }

        const msg = `Unexpected game state: ${_gameState.state}`;
        _$msg.empty().append(msg)
        throw new Error(msg);
    }

    const _refreshDebounce = util.debounce(0, _refresh);

    // Update the HandDisplays. For draws and freeze, null means "dont change".
    function _refreshHand(hand, draws, freeze, showHandRank) {
        if (freeze === undefined) freeze = true;
        _hd.setHand(hand, draws, freeze, showHandRank);
        _miniHd.setHand(hand, draws, true, showHandRank);
    }

    // Refresh the mini-status display.
	function _refreshMiniStatus() {
		// Add class for state, transacting, and error.
		_$ms.removeClass().addClass("mini-status").addClass(_gameState.state);
        if (_isTransacting) _$ms.addClass("isTransacting");
        if (_isError) _$ms.addClass("isError");

        // Update the isWinner class.
        if (_gameState.isWinner){
            _$ms.addClass("isWinner");
        }

        // update the state
        if (!_isTransacting) {
            const s = _gameState.state;
            if (s=="invalid") _$msState.text("Invalid");
            else if (s=="betting") _$msState.text("New Game");
            else if (s=="dealt") _$msState.text("Dealt");
            else if (s=="drawn") _$msState.text(_gameState.isWinner ? "Winner!" : "Complete");
            else if (s=="finalized") _$msState.text(_gameState.isWinner ? "Credited" : "Complete");
            else {
                _$msState.text(_gameState.state);
                throw new Error(`Unexpected game state: ${_gameState.state}`);
            }
        }

        // if it's invalid, show it as such.
        if (_gameState.isInvalid) {
            _$ms.addClass("isError");
            _$msState.text(`${_$msState.text()} [Invalid]`);
        }
	}

	// Draws proper multipliers in the paytable, using proper payTable.
	function _refreshPayTable() {
		var payTable = _gameState.state == "betting"
			? _curPayTable
			: _gameState.payTable;

		if (!payTable) {
			const $rows = _$payTable.find("tr").not(":first-child");
			$rows.find("td").not(":first-child").text("--");
			return;
		}
			
		// draw multipliers
		payTable = payTable.slice(1,-1);
		const $rows = _$payTable.find("tr");
		payTable.forEach((v,i)=>{
			$rows.eq(i+1).find("td").eq(1).text(`${v} x`);
		});

		// draw payouts depending on bet
		const bet = _gameState.bet || _better.getValue() || new BigNumber(0);
        const format = (v)=> v.equals(0) ? "--" :ethUtil.toEthStr(v, 3, "ETH");
		$rows.eq(0).find("td").eq(2).text(`Payout (for ${format(bet, 3, "ETH")} bet)`);
		payTable.forEach((v,i)=>{
			const payout = bet.mul(v);
			$rows.eq(i+1).find("td").eq(2).text(`${format(payout, 3, "ETH")}`);
		});
	}

    // Displays the proper text on the draw button
    function _refreshDrawBtn() {
        _miniHd.setDraws(_hd.getDraws());
        const numDraws = _hd.getNumDraws();
        const cardsStr = numDraws == "1" ? "Card" : "Cards"
        _$e.find(".btnDraw").text(`Draw ${numDraws} ${cardsStr}`);
    }

    // Refresh the payout bullet points inside $finalizeWin
    function _refreshBetAgain() {
        if (!_isTransacting) _$chkBetAgain.removeAttr("disabled");

        _$willBetFull.hide();
        _$willCreditFull.hide();
        _$willBetSome.hide();
        _$willCreditSome.hide();

        _$chkBetAgain.siblings(".eth").text(_eth(_gameState.bet));
        if (_$chkBetAgain.is(":checked")) {
            const creditAmt = _gameState.payout.minus(_gameState.bet);
            if (creditAmt.equals(0)) {
                _$willBetFull.show().find(".eth").text(_eth(_gameState.bet));
            } else {
                _$willBetSome.show().find(".eth").text(_eth(_gameState.bet));
                _$willCreditSome.show().find(".eth").text(_eth(creditAmt));
            }
        } else {
            _$willCreditFull.show().find(".eth").text(_eth(_gameState.payout));
        }
    }


    // Abstracts out having a button fire a transaction.
    //   getPromiseFn: must return a promise, or null
    //   callbackFn(obj): called with tx results. should call obj.resolve/reject
    //   errFn: called if TX errors, when user clears the error
    function _initActionButton($btn, getPromiseFn, callbackFn, errFn) {
        const gps = util.getGasPriceSlider(5);
        const $statusArea = $btn.closest(".actionArea").find(".statusArea");
        const $tip = $("<div></div>").show().append(gps.$e);

        // Attach tip to button that lets user pick gas price
        (function attachTip(){
            tippy($btn[0], {
                // arrow: false,
                theme: "light",
                animation: "fade",
                placement: "top",
                html: $tip[0],
                trigger: "mouseenter",
                onShow: function(){ gps.refresh(); },
                onHidden: function(){
                    // fixes a firefox bug where the tip won't be displayed again.
                    $btn[0]._tippy.destroy();
                    attachTip();
                }
            });
        }());

        $btn.click(function(){
            this._tippy.hide(0);
            $(this).blur();
            
            // get promise, or return.
            var promise;
            try {
                promise = getPromiseFn(gps.getValue());
            } catch(e) {
                console.error(e);
                ethStatus.open();
                errFn();
            }
            if (!promise) return;

            // Get various button states, and waitTime
            const defaultTxt = $(this).data("txt-default");
            const pendingTxt = $(this).data("txt-pending");
            const successTxt = $(this).data("txt-success");
            const waitTimeMs = (gps.getWaitTimeS() || 30) * 1000;

            // On TX success, call callbackFn and update status according to result.
            const onSuccess = (res) => {
                const obj = {
                    resolve: function(msg){
                        $btn.text(successTxt);
                        $txStatus.find(".status").append($("<div></div>").append(msg));
                        $txStatus.find(".clear").hide();
                    },
                    reject: function(msg){
                        $txStatus.find(".status").append($("<div></div>").append(msg));
                        onFailure();
                    }
                }
                callbackFn(res, obj);
            }

            // Called immediately if TX fails or callbackFn rejects
            const onFailure = () => {
                _isError = true;
                _$ms.addClass("isError");
                _$msState.text(`Error ${pendingTxt}`);
                $txStatus.addClass("error");
            }

            // Mark as transacting. This means keep hand frozen, and don't change _$ms.state
            _isTransacting = true;
            _isError = false;
            // Update DOM elements. Reset them upon clearing an error (or never).
            _refreshMiniStatus();
            _$msState.text(pendingTxt);
            _$msLoading.show().html(util.$getLoadingBar(waitTimeMs, promise, true));
            $statusArea.empty().show();
            $btn.attr("disabled", "disabled").addClass("disabled").text(pendingTxt);

            // Should reset everything back, then call errFn.
            const onClearError = () => {
                _isTransacting = false;
                _isError = false;
                _refreshMiniStatus();
                _$msLoading.hide();
                $statusArea.hide();
                $btn.removeAttr("disabled").removeClass("disabled").text(defaultTxt);
                if (errFn) errFn();
            }

            // create $txStatus object, with proper callbacks
            const $txStatus = util.$getTxStatus(promise, {
                waitTimeMs: waitTimeMs,
                onClear: onClearError,
                onSuccess: onSuccess,
                onFailure: onFailure
            }).appendTo($statusArea);
        });
    }

    function _initDealButton() {
        const $btn = _$bet.find(".btnDeal");

        const getPromiseFn = (gasPrice) => {
            const bet = _better.getValue();
            if (bet===null) { return; }

            _better.freeze(true);
            _gameState.uiid = Math.floor(Math.random() * 1000000000000);
            return _better.getBetType() == "eth"
                ? vp.bet([_gameState.uiid], {value: bet, gas: 130000, gasPrice: gasPrice})
                : vp.betWithCredits([bet, _gameState.uiid], {gas: 130000, gasPrice: gasPrice});
        }
        const callbackFn = (res, obj) => {
            const betSuccess = res.events.find(e=>e.name=="BetSuccess");
            const betFailure = res.events.find(e=>e.name=="BetFailure");
            if (betSuccess) {
                obj.resolve("Your cards will be shown shortly...");
                _onEvent(betSuccess);
            } else if (betFailure) {
                obj.reject(`Your bet was refunded: ${betFailure.args.msg}`);
            } else {
                obj.reject("Did not receive an expected event!");
            }
        };
        const errFn = () => {
            _better.freeze(false);
        };

        _initActionButton($btn, getPromiseFn, callbackFn, errFn);
    }

	
    function _initDrawButton() {
        const $btn = _$draw.find(".btnDraw");
        const getPromiseFn = (gasPrice) => {
            const draws = _hd.getDraws();
            if (draws == 0) {
                _isSkippingDrawing = true;
                _onEvent({
                    name: "DrawSuccess",
                    blockHash: _gameState.iBlockHash,
                    blockNumber: _gameState.iBlock,
                    args: {
                        id: new BigNumber(_gameState.id),
                        iHand: _gameState.iHand,
                        draws: new BigNumber(0)
                    }
                });
                return;
            } else {
                _hd.freeze(true);
                const params = [_gameState.id, draws, _gameState.iBlockHash];
                return vp.draw(params, {gas: 130000, gasPrice: gasPrice});
            }
        };
        const callbackFn = (res, obj) => {
            const drawSuccess = res.events.find(e=>e.name=="DrawSuccess");
            const drawFailure = res.events.find(e=>e.name=="DrawFailure");
            if (drawSuccess) {
                obj.resolve(`Your drawn cards will be shown shortly...`);
                _onEvent(drawSuccess);
            } else if (drawFailure) {
                obj.reject(`Drawing failed: ${drawFailure.args.msg}`);
            } else {
                obj.reject(`Did not receive an expected event!`);
            }
        };
        const errFn = () => {
            _hd.freeze(false);
            _refreshDrawBtn();
        }
        _initActionButton($btn, getPromiseFn, callbackFn, errFn);
    }

    function _initFinalizeButton() {
		const $btn = _$finalizeWin.find(".btnFinalize");
    	const getPromiseFn = (gasPrice) => {
            _$chkBetAgain.attr("disabled", "disabled");
            const params = [_gameState.id, _gameState.dBlockHash];
            return _$chkBetAgain.is(":checked")
                ? vp.betFromGame(params.concat(_gameState.uiid), {gas: 130000, gasPrice: gasPrice})
                : vp.finalize(params, {gas: 130000, gasPrice: gasPrice});
        };
        const callbackFn = (res, obj) => {
            const success = res.events.find(e=>e.name=="FinalizeSuccess");
            const failure = res.events.find(e=>e.name=="FinalizeFailure");
            const betSuccess = res.events.find(e=>e.name=="BetSuccess");
            const betFailure = res.events.find(e=>e.name=="BetFailure");
            if (success) {
                var msg = `You've been credited: ${_eth(success.args.payout)}`;
                if (betSuccess) {
                    msg += `<br>You've also bet ${_eth(betSuccess.args.bet)}. Your cards will be displayed shortly.`;
                    obj.resolve(msg)
                    _onEvent(betSuccess);
                } else if (betFailure) {
                    msg += `<br>Your bet failed: ${betFailure.args.msg}`;
                    obj.resolve(msg);
                    _onEvent(success);
                } else {
                    obj.resolve(msg);
                    _onEvent(success);
                }
            } else if (failure) {
                obj.reject(`Finalizing failed: ${failure.args.msg}`);
            } else {
                obj.reject(`Did not receive an expected event!`);
            }
        };
        const errFn = () => {
            _$chkBetAgain.removeAttr("disabled");
        }
        _initActionButton($btn, getPromiseFn, callbackFn, errFn);
    }

    function _eth(v) {
        return ethUtil.toEthStr(v, 5, "ETH", true);
    }

	(function _init() {
		_initDealButton();
		_initDrawButton();
		_initFinalizeButton();
	}());
}

function HandDisplay() {
    const _self = this;
    const _$e = $(`
        <div class='HandDisplay'>
            <div class="hand-rank">Hand Rank</div>
        </div>
    `);
    (function(){
        const html = `
            <div class="card-ctnr">
                <div class="card">
                    <div class="back"></div>
                    <div class="face">
                        <div class="cardIcon">
                            <div class="corner"></div>
                            <div class="suit"></div>
                        </div>
                        <div class="heldIcon">HELD</div>
                    </div>
                </div>
            </div>
        `;
        for (var i=0; i<5; i++) _$e.append($(html));
    }())
    const _$cards = _$e.find(".card").data("card", {cardNum: -1});
    const _$handRank = _$e.find(".hand-rank");

    var _curHandNumber = 0;
    var _isFrozen = false;
    var _onDrawsChanged = ()=>{};
    const _EMPTY_CARD = {cardNum: -1};

    // Events
    _$cards.click(_toggleHeld);

    this.$e = _$e;

    // do not allow clicking to hold a card
    this.freeze = function(bool) {
        if (bool === null) return;
        _isFrozen = bool;
        _isFrozen ? _$e.addClass("frozen") : _$e.removeClass("frozen");
    }

    this.setDraws = function(draws) {
        if (draws === null) return;
        if (draws.toNumber) draws = draws.toNumber();

        const isChanged = _self.getDraws() == draws;
        _$cards.map((i,c)=>{
            const $card = $(c);
            const isDrawn = draws & Math.pow(2, i);
            isDrawn ? $card.removeClass("held") : $card.addClass("held");
        });
        if (isChanged) _onDrawsChanged();
    }

    // animate in/out any changed cards, and set cards as held
    this.setHand = function(hand, draws, freeze, showHandRank) {
        const isEmpty = !hand || !hand.isValid();
        if (isEmpty) draws = 31;

        _self.setDraws(draws);
        _self.freeze(freeze);

        // Check to see if hand is the same as we currently have.
        const handNumber = hand ? hand.toNumber() : 0;
        const isNewHand = _curHandNumber != handNumber;
        _curHandNumber = handNumber;

        // update cards, keep track of those that changed
        const changedCards = [];
        if (isNewHand) {
            _$cards.map((i,c) => {
                const $card = $(c);
                if (isEmpty) {
                    const isChanged = !!$card.data("card");
                    $card.data("card", _EMPTY_CARD);
                    if (isChanged) changedCards.push($card);
                } else {
                    const card = hand.cards[i];
                    const isChanged = $card.data("card").cardNum != card.cardNum;
                    $card.data("card", card);
                    if (isChanged) changedCards.push($card);
                }
            });
        }
        
        // animate any changed cards
        var pauseTime = 0;
        if (changedCards.length) {
            const flipInterval = 100;
            const flipDuration = 400;

            // hide shown cards, from left to right, pausing flipInterval between each
            changedCards.forEach($card => {
                if ($card.hasClass("show")) {
                    setTimeout(() => $card.removeClass("show"), pauseTime);
                    pauseTime += flipInterval;
                }
            });

            // show cards, from left to right, pausing flipInterval between each.
            if (pauseTime) pauseTime += 200;
            changedCards.forEach($card => {
                const card = $card.data("card");
                if (card.cardNum == -1) return;
                setTimeout(() => {
                    const $cardIcon = $card.find(".cardIcon");
                    $cardIcon.removeClass().addClass("cardIcon").addClass(card.toClass());
                    $cardIcon.find(".corner").html(card.toValString() + card.toSuitString());
                    $cardIcon.find(".suit").html(card.toSuitString());
                    $card.addClass("show");
                }, pauseTime);
                pauseTime += flipInterval;
            });
        }

        // show handRank
        if (showHandRank) {
            if (!hand) return;
            setTimeout(()=>{ 
                _$handRank.addClass("show");
                if (hand.isWinner()) {
                    _$handRank.addClass("isWinner");
                    _$handRank.text(hand.getRankString() + "!");    
                } else {
                    _$handRank.removeClass("isWinner");
                    _$handRank.text(hand.getRankString());
                }
                _$cards.removeClass("hilited");
                hand.getWinningCards().forEach(i => _$cards.eq(i).addClass("hilited"));
            }, pauseTime);
        } else {
            _$cards.removeClass("hilited");
            _$handRank.removeClass("show");
        }
    }

    this.getDraws = function() {
        var drawsNum = 0;
        _$cards.each(function(i,c){
            drawsNum += $(c).is(".held") ? 0 : Math.pow(2,i);
        });
        return drawsNum;
    }

    this.getNumDraws = function(){
        return 5 - _$cards.filter(".held").length;
    }

    this.onDrawsChanged = function(fn) {
        _onDrawsChanged = fn;
    }

    function _toggleHeld(e) {
        if (_isFrozen) return;
        _$cards.each((i,c) => {
            if (c !== e.currentTarget) return;
            _$cards.eq(i).toggleClass("held");
            _onDrawsChanged();
        });
    }
}


var PUtil = (function(){
	function PokerUtil() {
	    // Takes an array of ints (0 to 51), or a number/BigNumber where
	    //  each 6 bits represents a card (0 to 51).
	    // Can return the Hand as a number, can rank the hand, and can
	    //  test if the hand is valid.
	    function Hand(numOrArray) {
            const _self = this;

	        // _cards will be set to an array of cards between 0-51
	        // If any card is invalid, _cards will be an empty array.
	        // Does not check for duplicates.
	        const _cards = (function(){
	            if (!numOrArray) return [];
	            function cardFromNum(cardNum) {
	                if (typeof cardNum !== "number") return null;
	                return new Card(cardNum);
	            }

	            var arr;
	            if (Array.isArray(numOrArray)){
	                arr = numOrArray.map(cardFromNum);  
	            } else {
	                numOrArray = numOrArray.toNumber ? numOrArray.toNumber() : numOrArray;
	                arr = [0,1,2,3,4].map(i => {
	                    const mask = 63 * Math.pow(2, 6*i);
	                    const cardNum = (numOrArray & mask) / Math.pow(2, 6*i);
	                    return cardFromNum(cardNum);
	                });
	            }
	            arr = arr.filter(c => !!c && c.cardNum <= 51);
	            if (arr.length != 5) arr = [];
	            return arr;
	        }());

	        this.cards = _cards;
	        
	        this.clone = function(){
	            return new Hand(_cards);
	        }

	        this.toNumber = function(){
	            var num = 0;
	            _cards.forEach((c,i) => {
	                const mask = c.cardNum * Math.pow(2, 6*i);
	                num = num + mask;
	            });
	            return num;
	        }

	        // True if all 5 cards are unique, and between 0-51
	        this.isValid = function(){
	            if (_cards.length != 5) return false;
	            if (numOrArray == 0) return false;
	            if (_cards.some(c => c.cardNum > 51)) return false;

	            // ensure there are 5 unique card values
	            const seen = {};
	            _cards.forEach(c => seen[c.cardNum] = true)
	            return Object.keys(seen).length == 5;
	        }

	        this.toString = function(){
	            if (!this.isValid()) return '[InvalidHand]';
	            const cardsStr = _cards.map(c => c.toString()).join(", ");
	            return `${cardsStr} [(${this.toNumber()}) ${this.getRankString()}]`;
	        }

	        this.isWinner = function(){
	        	return this.getRank() <= 9;
	        }

            // Returns an array of card indexes that contribute to winning hand.
            this.getWinningCards = function() {
                const rank = this.getRank();
                if (rank == 11 || rank == 10) return [];
                // rf, sf, fh, fl, st: return all cards
                if ([1,2,4,5,6].indexOf(rank)!==-1) return [0,1,2,3,4];
                // cards that have non-unique values
                const counts = (new Array(13)).fill(0);
                _cards.forEach(c => counts[c.val]++);
                return _cards
                    .map((c,i)=>counts[c.val] > 1 ? i : null)
                    .filter(i=>i!=null);
            }

	        this.getRank = function(){
	            if (this.isValid()) {
	                if (isRoyalFlush()) return 1;
	                else if (isStraightFlush()) return 2;
	                else if (isFourOfAKind()) return 3;
	                else if (isFullHouse()) return 4;
	                else if (isFlush()) return 5;
	                else if (isStraight()) return 6;
	                else if (isThreeOfAKind()) return 7;
	                else if (isTwoPair()) return 8;
	                else if (isJacksOrBetter()) return 9;
	                else return 10;
	            } else {
	                return 11;
	            }
	        }

	        this.getRankString = function(){
                const rank = this.getRank();
	            return ({
	                1: "Royal Flush",
	                2: "Straight Flush",
	                3: "Four of a Kind",
	                4: "Full House",
	                5: "Flush",
	                6: "Straight",
	                7: "Three of a Kind",
	                8: "Two Pair",
	                9: "Jacks or Better",
	                10: isLowPair() ? "Low Pair" : "High Card",
	                11: "Invalid Hand"
	            })[rank];
	        }

	        function isRoyalFlush() {
	            const hasAce = _cards.some(c => c.isAce);
	            const highVal = max(_cards.map(c => c.val));
	            return hasAce && highVal == 12 && isStraightFlush();
	        }
	        function isStraightFlush() {
	            return isStraight() && isFlush();
	        }
	        function isFourOfAKind(){
	            return hasCounts([4,1]);
	        }
	        function isFullHouse(){
	            return hasCounts([3,2]);
	        }
	        function isFlush(){
	            return _cards.every(c => c.suit == _cards[0].suit);
	        }
	        function isStraight(){
	            if (!hasCounts([1,1,1,1,1])) return;
	            const hasAce = _cards.some(c => c.isAce);
	            const highValNonAce = max(_cards.map(c => c.isAce ? 0 : c.val));
	            const lowValNonAce = min(_cards.map(c => c.isAce ? 100 : c.val));
	            return hasAce
	                ? highValNonAce == 4 || lowValNonAce == 9
	                : highValNonAce - lowValNonAce == 4;
	        }
	        function isThreeOfAKind(){
	            return hasCounts([3,1,1]);
	        }
	        function isTwoPair(){
	            return hasCounts([2,2,1]);
	        }
	        function isJacksOrBetter(){
	            if (!hasCounts([2,1,1,1])) return;
	            const counts = (new Array(13)).fill(0);
	            _cards.forEach(c => counts[c.val]++);
	            return [0, 10,11,12,13].some(val => counts[val]>1);
	        }
            function isLowPair() {
                return hasCounts([2,1,1,1]);
            }

	        function min(arr){ return Math.min.apply(Math, arr); }
	        function max(arr){ return Math.max.apply(Math, arr); }
	        function hasCounts(arr) {
	            var counts = (new Array(13)).fill(0);
	            _cards.forEach(c => counts[c.val]++);
	            counts = counts.filter(c => !!c).sort();
	            return arr.sort().every((exp,i) => exp===counts[i]);
	        }
	    }

        function Card(cardNum) {
            this.cardNum = cardNum;
            this.val = cardNum % 13;
            this.suit = Math.floor(cardNum / 13);
            this.isAce = cardNum % 13 == 0;
        }
        Card.prototype = {
            toValString: function() {
                return (function(val){
                    if (val == 0) return 'A';
                    if (val <= 9) return `${val+1}`;
                    if (val == 10) return "J";
                    if (val == 11) return "Q";
                    if (val == 12) return "K";
                }(this.val));
            },
            toSuitString: function() {
                return (['♠','♥','♦','♣'])[this.suit];    
            },
            toClass: function() {
                return (['spade','heart','diamond','club'])[this.suit];
            },
            toString: function(asHtml) {
                const str = this.toValString() + this.toSuitString();
                return asHtml
                    ? `<span class="cardStr ${this.toClass()}">${str}</span>`
                    : str;
            }
        }

	    // - blockhash: a string of hexEncoded 256 bit number
	    // - gameId: a number or BigNumber
	    function getIHand(blockhash, gameId) {
	        const idHex = toPaddedHex(gameId, 32);
	        const hexHash = web3.sha3(blockhash + idHex, {encoding: "hex"});
	        const cardNums = getCardsFromHash(hexHash, 5);
	        return new Hand(cardNums);
	    }

	    // - blockhash: a string of hexEncoded 256 bit number
	    // - gameId: a number or BigNumber
	    // - iHand: a Hand object of the original hand, or number
	    // - drawsNum: from 0 to 31.
	    function getDHand(blockhash, gameId, iHand, drawsNum) {
	        // get 5 new cards
	        const idHex = toPaddedHex(gameId, 32);
	        const hexHash = web3.sha3(blockhash + idHex, {encoding: "hex"});
	        return drawCardsFromHash(hexHash, iHand, drawsNum);
	    }

	    // - hexHash: a string of hexEncoded 256 bit number
	    // - iHand: a Hand object of the original hand, or number
	    // - drawsNum: from 0 to 31
	    function drawCardsFromHash(hexHash, iHand, drawsNum) {
	        iHand = new Hand(iHand);
	        if (drawsNum > 31) throw new Error(`Invalid drawsNum: ${drawsNum}`);
	        if (!iHand.isValid() && drawsNum<31) throw new Error(`Cannot draw ${drawsNum} to an invalid hand.`);

	        const excludedCardNums = iHand.isValid() ? iHand.cards.map(c => c.cardNum) : [];
	        const newCards = getCardsFromHash(hexHash, 5, excludedCardNums);

	        // swap out oldCards for newCards.
	        const drawsArr = [0,0,0,0,0];
	        if (drawsNum & 1) drawsArr[0] = 1;
	        if (drawsNum & 2) drawsArr[1] = 1;
	        if (drawsNum & 4) drawsArr[2] = 1;
	        if (drawsNum & 8) drawsArr[3] = 1;
	        if (drawsNum & 16) drawsArr[4] = 1;
	        const oldCards = iHand.cards.map(c => c.cardNum);
	        const cards = drawsArr.map((useNew, i)=>{
	            return useNew ? newCards[i] : oldCards[i];
	        })

	        // return hand
	        return new Hand(cards);
	    }

	    function getCardsFromHash(hexHash, numCards, excludedCardNums) {
	        if (!excludedCardNums) excludedCardNums = [];
	        const cardNums = [];
	        while (cardNums.length < numCards) {
	            const cardNum = (new BigNumber(hexHash)).mod(52).toNumber();
	            if (excludedCardNums.indexOf(cardNum) === -1) {
	                excludedCardNums.push(cardNum);
	                cardNums.push(cardNum);
	            }
	            hexHash = web3.sha3(hexHash, {encoding: "hex"});
	        }
	        return cardNums;
	    }

	    function toPaddedHex(num, bits) {
	        num = new BigNumber(num);
	        const targetLen = Math.ceil(bits / 4);
	        const hexStr = num.toString(16);
	        if (hexStr.length > targetLen)
	            throw new Error(`Cannot convert ${num} to ${bits} bits... it's too large.`);
	        const zeroes = (new Array(targetLen-hexStr.length+1)).join("0");
	        return `${zeroes}${hexStr}`;
	    }

	    // Return an object with useful functions.
	    this.Hand = Hand;
	    this.getIHand = getIHand;
	    this.getDHand = getDHand;
	}
	return new PokerUtil();
}());