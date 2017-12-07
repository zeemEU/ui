var Registry = artifacts.require("Registry");
var PennyAuctionFactory = artifacts.require("PennyAuctionFactory");
var PennyAuction = artifacts.require("PennyAuction");

const createDefaultTxTester = require("../js/tx-tester/tx-tester.js")
    .createDefaultTxTester.bind(null, web3, assert, it);
const BigNumber = web3.toBigNumber(0).constructor;

const INITIAL_PRIZE  = new BigNumber(.05e18);
const BID_PRICE      = new BigNumber(.001e18);
const BID_ADD_BLOCKS = new BigNumber(2);
const BID_FEE_PCT    = new BigNumber(60);
const INITIAL_BLOCKS = new BigNumber(5);
const AUCTION_DEF = [INITIAL_PRIZE, BID_PRICE, BID_ADD_BLOCKS, BID_FEE_PCT, INITIAL_BLOCKS];

const accounts = web3.eth.accounts;

describe('PennyAuctionFactory', async function(){
    const registry = await Registry.new();
    const dummyTreasury = accounts[1];
    const dummyPac = accounts[2];
    const notPac = accounts[3];
    await registry.register("TREASURY", dummyTreasury);
    await registry.register("PENNY_AUCTION_CONTROLLER", dummyPac);
    var paf;
    
    before("Can be created", async function(){
        paf = await PennyAuctionFactory.new(registry.address);
        const addresses = {
            registry: registry.address,
            dummyTreasury: dummyTreasury,
            dummyPac: dummyPac,
            notPac: notPac,
            paf: paf.address
        };
        createDefaultTxTester().plugins.nameAddresses(addresses);
        console.log("addresses", addresses);
    });

    it("should point to the dummyPac and dummyTreasury", async function(){
        createDefaultTxTester()
            .assertStateAsString(paf, "getPennyAuctionController", dummyPac)
            .assertStateAsString(paf, "getTreasury", dummyTreasury);
    });

    describe(".createAuction()", async function(){
        it("should fail when called by randos", function(){
            const settings = {from: notPac, gas: 2000000, value: INITIAL_PRIZE};
            const callParams = [paf, "createAuction"].concat(AUCTION_DEF, settings);
            return createDefaultTxTester()
                .doTx(callParams)
                .assertInvalidOpCode()
                .start();
        });

        it("should fail when not passed any ETH", function(){
            const settings = {from: dummyPac, gas: 2000000}; 
            const callParams = [paf, "createAuction"].concat(AUCTION_DEF, settings);
            return createDefaultTxTester()
                .doTx(callParams)
                .assertInvalidOpCode()
                .start();
        });

        it("should fail when passed too little", function(){
            const settings = {from: dummyPac, gas: 2000000, value: 1}; 
            const callParams = [paf, "createAuction"].concat(AUCTION_DEF, settings);
            return createDefaultTxTester()
                .doTx(callParams)
                .assertInvalidOpCode()
                .start();
        });

        it("should fail when passed too much", function(){
            const settings = {from: dummyPac, gas: 2000000, value: INITIAL_PRIZE.plus(1)};
            const callParams = [paf, "createAuction"].concat(AUCTION_DEF, settings);
            return createDefaultTxTester()
                .doTx(callParams)
                .assertInvalidOpCode()
                .start();
        });

        it("should fail when passed invalid auction param", function(){
           return createDefaultTxTester()
                .doTx(() => paf.createAuction(
                                -1, 
                                BID_PRICE,
                                BID_ADD_BLOCKS,
                                BID_FEE_PCT,
                                INITIAL_BLOCKS,
                                {from: dummyPac, gas: 2000000, value: INITIAL_PRIZE}
                            ))
                .assertInvalidOpCode()
                .start(); 
        })

        it("works when called by PennyAuctionController", async function(){
            const settings = {from: dummyPac, gas: 2000000, value: INITIAL_PRIZE};
            const callParams = [paf, "createAuction"].concat(AUCTION_DEF, settings);
            const txRes = await createDefaultTxTester()
                .doTx(callParams)
                .assertSuccess()
                .assertOnlyLog("AuctionCreated", {
                    time: null,
                    addr: null,
                    initialPrize: INITIAL_PRIZE,
                    bidPrice: BID_PRICE,
                    bidAddBlocks: BID_ADD_BLOCKS,
                    bidFeePct: BID_FEE_PCT,
                    initialBlocks: INITIAL_BLOCKS
                })
                .getTxResult()
                .start();

            const auction = PennyAuction.at(txRes.logs[0].args.addr);
            const block = txRes.receipt.blockNumber;
            createDefaultTxTester().plugins.nameAddresses({auction: auction}, false);
            console.log(`Created auction @ ${auction.address}`);

            await createDefaultTxTester()
                .assertStateAsString(auction, "collector", dummyTreasury)
                .assertStateAsString(auction, "initialPrize", INITIAL_PRIZE)
                .assertStateAsString(auction, "bidPrice", BID_PRICE)
                .assertStateAsString(auction, "bidAddBlocks", BID_ADD_BLOCKS)
                .assertStateAsString(auction, "bidFeePct", BID_FEE_PCT)
                .assertStateAsString(auction, "blockEnded", INITIAL_BLOCKS.plus(block))
                .start();
        });
    });
});