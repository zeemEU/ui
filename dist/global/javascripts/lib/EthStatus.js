(function(){
    function EthStatus(ethUtil, niceWeb3) {
        const _ethUtil = ethUtil;
        const _niceWeb3 = niceWeb3;
        const _self = this;
        const _$e = $(`
            <div class="EthStatus">
                <div class="icon">
                    <img src="/global/images/ethereum.png" height="30"/>
                    <div class="notifications">3</div>
                </div>
                <div class="content">
                    <div class="network">
                        <div class="left">
                            <div class="connected"></div>   
                            <div class="name"></div>
                        </div>
                        <div class="right">
                            <span class="block"></span>
                            <span class="blockTimeAgo"></span>
                        </div>
                    </div>
                    <div class="notConnected">
                        <div class="head">Not Connected</div>
                        <div class="body">
                            PennyEther is unable to reach an Ethereum provider. You may have lost your
                            internet connection, or your provider is temporarily down.
                        </div>
                    </div>
                    <div class="account">
                        <div class="address"></div>
                        <div class="balance"></div>
                    </div>
                    <div class="noAccount">
                        <div class="web3" style="display: none;">
                            <div class="head">Please Unlock Account</div>
                            <div class="body">
                                It looks like your browser has web3 enabled, but there is no Ethereum account available.
                                Please unlock an account, and you're good to go!
                            </div>
                        </div>
                        <div class="noWeb3" style="display: none;">
                            <div class="head">Get an Ethereum Account!</div>
                            <div class="body">
                                To play on PennyEther, please install the 
                                <a href="https://metamask.io/" target="_blank">MetaMask browser extension</a>,
                                or use a web3 enabled browser such as <a href="https://brave.com/" target="_blank">Brave</a>
                                or <a href="https://github.com/ethereum/mist/releases" target="_blank">Mist</a>.
                            </div>
                        </div>
                    </div>
                    <div class="pendingTxs">
                        <div class="head">PennyEther Transactions
                            <span class="clear" style="display: none;">(clear)</span>
                        </div>
                        <div class="no-txs">You have no pending transactions.</div>
                        <div class="txs"></div>
                    </div>
                </div>
                <div class="tx template" style="display: none;">
                    <div class="table">
                        <div class="left">
                            <div class="status" data-tippy-trigger="mouseenter"></div>
                        </div>
                        <div class="right">
                            <div class="contractName"></div>
                            <div class="fnName" data-tippy-trigger="mouseenter" data-tippy-animation="scale"></div>
                            <div class="fnArgs" data-tippy-trigger="mouseenter" data-tippy-animation="scale">()</div>
                            <div class="opts tipped" data-tippy-trigger="mouseenter" data-tippy-animation="scale">opts</div>
                        </div>
                    </div>
                    <div style="display: none;">
                        <div class="statusTipCtnr">
                            <div class="statusTip">
                                <div class="title"></div>
                                <div class="error" style="display: none;"></div>
                                <div class="summary" style="display: none;"></div>
                            </div>
                        </div>
                        <div class="argsTip"></div>
                        <div class="optsTip"></div>
                    </div>
                </div>
            </div>
        `);
        // state stuff
        const _$icon = _$e.find(".icon").click(()=>_$e.toggleClass("open"));
        const _$block = _$e.find(".network .block");
        const _$blockTimeAgo = _$e.find(".network .blockTimeAgo");
        const _$networkConnected = _$e.find(".network .connected");
        const _$networkName = _$e.find(".network .name");
        const _$notConnected = _$e.find(".notConnected").show();
        const _$noAccount = _$e.find(".noAccount").hide();
        window.hasWeb3
            ? _$noAccount.find(".web3").show()
            : _$noAccount.find(".noWeb3").show();
        const _$acctCtnr = _$e.find(".account");
        const _$acctAddr = _$e.find(".account .address");
        const _$acctBal = _$e.find(".account .balance");
        // txs stuff
        const _$pendingTxs = _$e.find(".pendingTxs");
        const _$notifications = _$e.find(".notifications").hide();
        const _$txTemplate = _$e.find(".tx.template");
        const _$txs = _$e.find(".txs");
        const _$noTxs = _$e.find(".no-txs");
        const _$clearPending = _$e.find(".clear").click(function(){
            _$clearPending.hide();
            _$txs.empty();
            _$noTxs.show();
            _$notifications.hide();
        }).hide();

        // Keep track of latest block. Init to empty block.
        var _curState = {latestBlock: {}};
        var _timeOfLatestBlock = 0;
        var _openOnDisconnect = false;

        // on state change, maybe update block - always refresh all.
        _ethUtil.onStateChanged(newState => {
            if (!newState.latestBlock || !_curState.latestBlock) {
                _timeOfLatestBlock = new Date();
            } else {
                if (newState.latestBlock.number !== _curState.latestBlock.number) {
                    _timeOfLatestBlock = new Date();            
                }
            }
            _curState = newState;
            _refreshAll();
        });
        // on niceWeb3 call, display TX
        _niceWeb3.setCallHook(_onCall);

        function _refreshAll(){
            _refreshNetwork();
            _refreshAccount();
            _refreshBlock();
        }

        function _refreshNetwork(){
            const isConnected = _curState.isConnected;
            const networkId = _curState.networkId;
            const networkName = ({
                1: "MainNet",
                2: "Morden",
                3: "Ropsten",
                4: "Rinkeby",
                42: "Kovan"
            })[networkId] || `(Unknown Network)`;
            
            _$networkConnected
                .removeClass("true")
                .removeClass("false")
                .addClass(isConnected ? "true" : "false");
            if (isConnected){
                _$networkName.text(networkName);
                _$notConnected.hide();
            } else {
                _$networkName.text("Not Connected");
                _$notConnected.show();
            }
            _$e.removeClass("no-connection off");
            if (!_curState.account) _$e.addClass("off");
            if (!isConnected) {
                _$e.addClass("no-connection");
                _$pendingTxs.hide();
                _$noAccount.hide();
                if (_openOnDisconnect) _self.open();
            }
        }

        function _refreshAccount(){
            if (!_curState.isConnected) {
                _$acctCtnr.hide();
                return;
            }

            _$acctCtnr.show();
            const acctAddr = _curState.account;
            if (!acctAddr) {
                _$acctCtnr.addClass("none");
                _$acctAddr.text("⚠ No Ethereum Account");
                _$pendingTxs.hide();
                _$noAccount.show();
                return;
            } else {
                _$pendingTxs.show();
                _$noAccount.hide();

                const $link = nav.$getPlayerLink(acctAddr, true);
                _$acctCtnr.removeClass("none");
                _$acctAddr.empty().append("Account: ").append($link);
                _$acctBal.text("...");
                _ethUtil.getBalance(acctAddr).then((res)=>{
                    if (res===null) {
                        _$acctBal.text("<error>");
                    } else {
                        _$acctBal.text(res.div(1e18).toFixed(4) + " ETH");
                    }
                });
            }
        }

        function _refreshBlock(){
            const latestBlock = _curState.latestBlock;
            const isConnected = _curState.isConnected;
            if (!latestBlock || !isConnected) {
                _$block.text("").hide();
            } else {
                const str = `#${latestBlock.number}`;
                const $link = _ethUtil.$getLink(str, latestBlock.number, "block");
                _$block.show().empty().append($link);
            }
            _refreshBlockTimeAgo();
        }

        function _refreshBlockTimeAgo(){
            if (!_curState.isConnected || !_curState.latestBlock){
                _$blockTimeAgo.hide();
                return;
            }
            const secondsAgo = Math.round(((+new Date) - _timeOfLatestBlock)/1000);
            _$blockTimeAgo.show().text(`(${secondsAgo}s ago)`);
        }

        // todo:
        //  - add tips for:
        //      - fnComment
        //      - args 
        //      - opts
        //      - events
        //  - stylize
        function _onCall(p) {
            if (p.metadata.isConstant) {
                p.catch(e=>{
                    console.log(`Call failed: ${p.metadata.callName}`, p.metadata, e);
                });
                return;
            }

            // remove extra Tx, if there is one
            const LIMIT = 10;
            _$txs.children().eq(LIMIT - 1).remove();

            // states: signing, tx-id-error, pending, tx-error
            const $e = _$txTemplate.clone().show().prependTo(_$txs);
            const $table = $e.find(".table");
                const $contractName = $table.find(".contractName");
                const $fnName = $table.find(".fnName");
                const $fnArgs = $table.find(".fnArgs");
                const $opts = $table.find(".opts");
            const $status = $e.find(".status");
            const $statusTip = $e.find(".statusTipCtnr");
                const $statusTitle = $statusTip.find(".title");
                const $statusError = $statusTip.find(".error");
                const $statusSummary = $statusTip.find(".summary");
            const $argsTip = $e.find(".argsTip");
            const $optsTip = $e.find(".optsTip");
            const argsObj = p.metadata.inputsObj;
            const opts = p.metadata.opts;

            // show _pendingTxs()
            const count = _$txs.children().length;
            _$clearPending.show();
            _$noTxs.hide();
            _$notifications.removeClass("new").show().text(count);
            setTimeout(()=>{ _$notifications.addClass("new"); }, 50);

            // fill out name and args
            $contractName.text(p.metadata.contractName);
            $fnName.text(p.metadata.fnName)
            if (p.metadata.abiDef.comment){
                $fnName.attr("title", p.metadata.abiDef.comment).addClass("tipped");
                tippy($fnName[0]);
            }
            if (Object.keys(argsObj).length > 0) {
                Object.keys(argsObj).forEach((name)=>{
                    var argAsStr = `${argsObj[name]}`;
                    if (argAsStr.length > 25) argAsStr = argAsStr.slice(0,25) + "...";
                    const $e = $("<div></div>").text(`${name}: ${argAsStr}`);
                    $argsTip.append($e);
                });
                $fnArgs.text("(...)").addClass("tipped");
                tippy($fnArgs[0], {html: $argsTip[0]});
            }

            // Show options stuff
            $opts.text("[opts]")
            Object.keys(opts).forEach((name)=>{
                const $e = $("<div></div>");
                if (name=="value")
                    $e.text(`${name}: ${util.toEthStr(new BigNumber(opts[name]))}`);
                if (name=="gas")
                    $e.text(`${name}: ${new BigNumber(opts[name]||0)}`);
                if (name=="gasPrice")
                    $e.text(`${name}: ${(new BigNumber(opts[name]||0)).div(1e9)} GWei`);
                if (name=="to" || name=="from")
                    $e.append(`${name}: `).append(util.$getShortAddrLink(opts[name]));
                if (name=="data")
                    $e.append(`${name}: ${opts[name].slice(0,10)}...`);
                $optsTip.append($e);
            });
            tippy($opts[0], {html: $optsTip[0]});   
            tippy($status[0], {html: $statusTip[0]});

            $e.addClass("signing")
            $status.text("Signing");
            $statusTitle.text("Waiting for your transaction to be submitted.");
            p.getTxHash.then((txHash)=>{
                const $link = util.$getTxLink("Pending", txHash);
                $status.empty().append($link);
                $statusTitle.text("Your transaction is being mined.");
                $e.removeClass("signing").addClass("pending");
            },(e)=>{
                $status.empty().append("Signing Error");    // todo: tooltip
                $statusTitle.html(`Your provider threw an error:`);
                $statusError.text(e.message.split("\n")[0]).show();
                $e.removeClass("signing").addClass("tx-id-error");
            });
            p.then((res)=>{
                onMined(res, false);
            }, (e)=>{
                // this errored out in getTx instead.
                if (!e.result) return;
                onMined(e, true);
            });

            // update resultStatus
            function onMined(resOrError, isError) {
                const res = isError ? resOrError.result : resOrError;
                const err = isError ? resOrError : null;
                const txId = res.receipt.transactionHash;
                const block = res.receipt.blockNumber;
                const gasUsed = res.receipt.gasUsed;
                const $link = util.$getTxLink(`Confirmed`, txId);
                const events = res.events;

                $status.empty().append($link);
                $e.removeClass("waiting pending");
                if (isError) {
                    $statusTitle.text(`Your transaction was mined, but resulted in an error:`);
                    $statusError.text(err.message).show();
                    $e.addClass("tx-error");
                } else {
                    $statusTitle.text(`Your transaction was mined.`);
                    $e.addClass("tx-success");
                }
                // show summary
                $statusSummary.show().text(`Mined on block ${block}, used ${gasUsed} gas.`);
                if (events.length) {
                    const eventsStr = events.map((e)=>e.name).join(", ");
                    const $events = $("<div></div>").text(`${events.length} events: ${eventsStr}`);
                    $statusSummary.append($events);
                }
            }

            // open EthStatus, flash item
            $e.addClass("new");
        }

        this.$e = _$e;
        this.open = function(){ _$e.addClass("open"); }
        this.close = function(){ _$e.removeClass("open"); }
        this.setOpenOnDisconnect = function(val){ _openOnDisconnect = val; }

        _init();
        function _init(){
            (function _poll() {
                _refreshBlockTimeAgo();
                setTimeout(_poll, 1000);
            }());
        }
    }
    window.EthStatus = EthStatus;
}());