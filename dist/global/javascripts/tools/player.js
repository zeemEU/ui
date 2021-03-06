Loader.require("monarchy", "dice", "vp")
.then(function(monarchy, dice, vp){
    var _curAccount;
    const _resetCallbacks = [];

    // initialize the button and address input
    const $button = $(".top button").click(_resetAll);
    const $addressInput = util.$getAddressInput(val => {
        if (!val) $button.attr("disabled", "disabled");
        else $button.removeAttr("disabled");
    });
    $addressInput.appendTo($(".top .address-ctnr"));

    // initialize the values based on hash
    (function(){
        const hash = (window.location.hash || "#").slice(1);
        if (hash.length) {
            $addressInput.setValue(hash);
            _resetAll();
        }
    }());


    // do this just once
    ethUtil.getCurrentState().then(() => {
        // use current account if none provided
        if (!$addressInput.getValue()) {
            $addressInput.setValue(ethUtil.getCurrentAccount());
        }

        // get start blocks for controllers, init event viewers, and reset them.
        Promise.obj({
            monarchyStart: monarchy.getEvents("Created").then(evs => evs[0].blockNumber),
            diceStart: dice.getEvents("Created").then(evs => evs[0].blockNumber),
            vpStart: vp.getEvents("Created").then(evs => evs[0].blockNumber)
        }).then(obj => {
            _initMonarchy(obj.monarchyStart);
            _initDice(obj.diceStart);
            _initVp(obj.vpStart);
        }).then(_resetAll);
    });

    function _resetAll() {
        // disable all things if no account
        _curAccount = $addressInput.getValue();
        const $fieldsets = $("fieldset.account-chosen");
        const $whichAccounts = $(".bubble.which-account").hide();
        const $noAccounts = $(".bubble.no-account").hide();
        if (_curAccount) {
            window.location.hash = `#${_curAccount}`;
            $fieldsets.removeAttr("disabled");
            $whichAccounts.show().find(".player").text(_curAccount);
        } else {
            window.location.hash = ``;
            $fieldsets.attr("disabled", "disabled");
            $noAccounts.show();
        }

        // reset all of the event logs
        _resetCallbacks.forEach(callback => {
            callback(_curAccount);
        });
    }

    function _initMonarchy(startBlock) {
        if (!MonarchyUtil) throw new Error(`MonarchyUtil is required.`);

        const $e = $(".cell.monarchy")
        const $ctnr = $e.find(".log-viewer-ctnr");

        const events = buildEvents();   // event filters reference "account"
        var lv = util.getLogViewer({
            events: events,
            order: "newest",
            minBlock: startBlock,
            valueFn: (event) => {
                return MonarchyUtil.$getEventSummary(event, true, true);
            }
        });
        lv.$e.appendTo($ctnr);

        _resetCallbacks.push(() => lv.reset(true));

        // get all overthrow, refund, and sendprize events for _curAccount
        function buildEvents() {
            // This hack relies on LogViewer calling .toString() on all filters.
            const account = {
                toString: function(){ return _curAccount; }
            };

            return [{
                name: "OverthrowOccurred",
                filter: {newMonarch: account},
                label: "Overthrow",
                selected: true
            },{
                name: "OverthrowRefundSuccess",
                filter: {recipient: account},
                label: "Overthrow Refunded",
                selected: true
            },{
                name: "OverthrowRefundFailure",
                filter: {recipient: account},
                label: "Overthrow Refunded",
                selected: true
            },{
                name: "SendPrizeSuccess",
                filter: {recipient: account},
                label: "Sent Prize",
                selected: true
            },{
                name: "SendPrizeFailure",
                filter: {recipient: account},
                label: "Sent Prize",
                selected: true
            }].map(obj => {
                obj.instance = MonarchyGame;
                return obj;
            });
        }
    }

    function _initDice(startBlock) {
        if (!DiceUtil) throw new Error(`DiceUtil is required.`);

        const $e = $(".cell.instadice")
        const $ctnr = $e.find(".log-viewer-ctnr");

        const events = buildEvents();   // event filters reference "account"
        var lv = util.getLogViewer({
            events: events,
            order: "newest",
            minBlock: startBlock,
            valueFn: (event) => {
                return DiceUtil.$getEventSummary(event);
            }
        });
        lv.$e.appendTo($ctnr);

        _resetCallbacks.push(() => lv.reset(true));

        // get all overthrow, refund, and sendprize events for _curAccount
        function buildEvents() {
            // This hack relies on LogViewer calling .toString() on all filters.
            const account = {
                toString: function(){ return _curAccount; }
            };

            return [{
                name: "RollWagered",
                filter: {user: account},
                label: "Rolled",
                selected: true
            },{
                name: "RollRefunded",
                filter: {user: account},
                label: "Roll Refunded",
                selected: false 
            },{
                name: "RollFinalized",
                filter: {user: account},
                label: "Roll Finalized",
                selected: false 
            }].map(obj => {
                obj.instance = InstaDice;
                return obj;
            });
        }
    }

    function _initVp(startBlock) {
        const ghv = new PokerUtil.GameHistoryViewer(vp, 5760);
        ghv.setUser(_curAccount);
        ghv.setMinBlock(startBlock);
        ghv.$e.appendTo($(".cell.videopoker .log-viewer-ctnr"));
        _resetCallbacks.push(() => {
            ghv.setUser(_curAccount);
            ghv.reset(true);
        });
    }
    
});