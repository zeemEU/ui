pragma solidity ^0.4.0;
//@dontRegenerate
contract IPennyAuctionController {
  function totalFees() public constant returns(uint);
  function totalPrizes() public constant returns(uint);
  function totalBids() public constant returns(uint);
  function maxOpenAuctions() public constant returns(uint);
  function maxInitialPrize() public constant returns(uint);
  function openAuctions(uint _i) public constant returns(address _auction);
  function closedAuctions(uint _i) public constant returns(address _auction);
  
  function getNumActionableAuctions() public constant returns (uint _numActionableAuctions);
  function getAvailableFees() public constant returns (uint _feesAvailable);
  function getNumOpenAuctions() constant returns (uint _len);
  function getNumClosedAuctions() constant returns (uint _len);

  function setSettings(uint _maxOpenAuctions, uint _maxInitialPrize);

  function startNewAuction(uint _initialPrize,
	    					           uint _bidPrice,
	    					           uint _bidTimeS,
	    					           uint _bidFeePct,
        				           uint _auctionTimeS) payable
      returns (bool _success, address _auction);

  function checkOpenAuctions() returns (uint _numAuctionsCompleted, uint _feesRedeemed);
}