Loader.require("pac")
.then(function(pac){
    if (!BankrollableUtil) throw new Error("This requires BankrollableUtil to be loaded.");

    ethUtil.getCurrentState().then(() => {
        _refreshAll();
    });

    function _refreshAll(){
        Promise.all([
            _refreshHealth(),
            _refreshGames(),
            // _refreshTasks(),
            // _refreshRewards(),
        ]).then(()=>{
            // tm.getEvents("Created").then(arr => {
            //  return arr[0].blockNumber;
            // }).then(creationBlockNum => {
            //  _initEventLog(creationBlockNum);
            //  Promise.all([
            //      ethUtil.getBlock(creationBlockNum),
            //      _niceWeb3.ethUtil.getAverageBlockTime(),
            //  ]).then(arr => {
            //      _initRewards(arr[0], arr[1]);
            //  });
            // });
        });
    }

    function _refreshHealth() {
        const $e = $(".cell.health");
        const $loading = $e.find(".loading").show();
        const $error = $e.find(".error").hide();
        const $doneLoading = $e.find(".done-loading").hide();

        return Promise.obj({
            $health: BankrollableUtil.$getHealth(pac)
        }).then(doRefresh).then(()=>{
            $loading.hide();
            $doneLoading.show();
        },e => {
            console.warn(e);
            $loading.hide();
            $error.show();
            $error.find(".error-msg").text(e.message);
        });

        function doRefresh(obj) {
            $e.find(".health-ctnr").append(obj.$health);
        }
    }

    function _refreshGames() {
        const $e = $(".cell.games");
        const $loading = $e.find(".loading").show();
        const $error = $e.find(".error").hide();
        const $doneLoading = $e.find(".done-loading").hide();

        function getDefinedGames(){
            return pac.numDefinedAuctions().then(num => {
                const promises = [];
                for (var i=0; i<num; i++) {
                    let id = i;
                    promises.push(pac.definedAuctions([id]).then(arr => {
                        const instance = new BigNumber(arr[0])==0 ? null : PennyAuction.at(arr[0]);
                        return Promise.obj({
                            isStartable: pac.getIsStartable([id]),
                            isEndable: instance ? instance.isEnded() : Promise.resolve(false),
                            currentWinner: instance ? instance.currentWinner() : Promise.resolve(null),
                            prize: instance ? instance.prize() : Promise.resolve(null),
                            numBids: instance ? instance.numBids() : Promise.resolve(null),
                            blocksLeft: instance ? instance.getBlocksRemaining() : Promise.resolve(null)
                        }).then(obj => {
                            return {
                                id: id,
                                instance: instance,
                                isEnabled: arr[1],
                                summary: arr[2],
                                initialPrize: arr[3],
                                bidPrice: arr[4],
                                bidIncr: arr[5],
                                bidAddBlocks: arr[6],
                                initialBlocks: arr[7],
                                isStartable: obj.isStartable,
                                isEnded: obj.isEnded,
                                currentWinner: obj.currentWinner,
                                prize: obj.prize,
                                numBids: obj.numBids,
                                blocksLeft: obj.blocksLeft
                            };
                        });
                    }));
                }
                return Promise.all(promises);
            });
        }
        return Promise.obj({
            numActive: pac.numActiveAuctions(),
            numEnded: pac.numEndedAuctions(),
            definedGames: getDefinedGames()
        }).then(doRefresh).then(()=>{
            $loading.hide();
            $doneLoading.show();
        },e => {
            console.warn(e);
            $loading.hide();
            $error.show();
            $error.find(".error-msg").text(e.message);
        });

        function doRefresh(obj) {
            $e.find(".num-active").text(obj.numActive);
            $e.find(".num-ended").text(obj.numEnded);
            $e.find(".num-defined").text(obj.definedGames.length);

            // Display defined games.
            (function(){
                const $tbody = $e.find(".defined-games tbody");
                if (obj.definedGames.length == 0) {
                    $tbody.append("<tr><td colspan=9>There are no defined games</td></tr>");
                } else {
                    obj.definedGames.forEach(game => {
                        const status = game.instance == null
                            ? game.isStartable ? "startable" : "not-startable"
                            : game.isEndable ? "endable" : "active";
                        const $link = game.instance == null ? "None" : Loader.linkOf(game.instance.address);
                        const $row = $("<tr></tr>").addClass(status);
                        $row.append($("<td></td>").text(game.id));
                        $row.append($("<td></td>").append($link));
                        $row.append($("<td></td>").text(game.summary));
                        $row.append($("<td></td>").text(game.isEnabled));
                        $row.append($("<td></td>").text(util.toEthStrFixed(game.initialPrize)));
                        $row.append($("<td></td>").text(util.toEthStrFixed(game.bidPrice)));
                        $row.append($("<td></td>").text(util.toEthStrFixed(game.bidIncr)));
                        $row.append($("<td></td>").text(game.bidAddBlocks));
                        $row.append($("<td></td>").text(game.initialBlocks));
                        $row.appendTo($tbody);
                    });
                }
            }());
            
            // Display active games
            (function(){
                const $tbody = $e.find(".active-games tbody");
                if (obj.definedGames.length == 0) {
                    $tbody.append("<tr><td colspan=5>There are no active games</td></tr>");
                } else {
                    obj.definedGames.forEach(game => {
                        if (game.instance == null) return;
                        const $row = $("<tr></tr>");
                        $row.append($("<td></td>").text(game.id));
                        $row.append($("<td></td>").text(util.toEthStrFixed(game.prize)));
                        $row.append($("<td></td>").append(Loader.linkOf(game.currentWinner)));
                        $row.append($("<td></td>").text(game.numBids));
                        $row.append($("<td></td>").text(game.blocksLeft));
                        $row.appendTo($tbody);
                    });
                }
            }());

            
        }
    }
});