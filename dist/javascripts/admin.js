Loader.require("reg", "tr", "mc", "pac", "dice")
.then(function(reg, tr, mc, pac, dice){
	updateAll();

	function updateAll(){
		updateTr();
		updateMc();
		updatePac();
		updateDice();
	}

	function updateTr() {
		if (!tr) return alert("tr not loaded.");
		$("#TrToday").text( ((+new Date())/(1000*60*60*24)).toFixed(2) );
		util.bindToElement(tr.getAdmin(), $("#TrAdmin"));
		util.bindToElement(tr.dayDailyFundLimitChanged(), $("#TrDailyFundLimitLastChanged"));
		util.bindToInput(tr.dailyFundLimit().then(ethUtil.toEth), $("#TrDailyFundLimit"));
	}

	$("#TrChangeDailyFundLimit").click(function(){
		if (!tr) return alert("tr not loaded.");
		const newLimit = ethUtil.toWei($("#TrDailyFundLimit").val());
		tr.setDailyFundLimit({_newValue: newLimit})
			.then(function(){
				alert("Value updated.");
				updateTr();
			}).catch(function(){
				alert("Unsuccessful - are you the admin?");
			});
	});


	function updateMc() {
		if (!mc) return alert("mc not loaded.");
		util.bindToElement(mc.getAdmin(), $("#McAdmin"));
		util.bindToInput(mc.paStartReward().then(ethUtil.toEth), $("#McPaStartReward"));
		util.bindToInput(mc.paEndReward().then(ethUtil.toEth), $("#McPaEndReward"));
		util.bindToInput(mc.paFeeCollectRewardDenom(), $("#McPaRewardDenom"));
	}
	$("#McChangePaRewards").click(function(){
		if (!mc) return alert("mc not loaded.");
		const paStartReward = ethUtil.toWei($("#McPaStartReward").val());
		const paEndReward = ethUtil.toWei($("#McPaEndReward").val());
		const paRewardDenom = $("#McPaRewardDenom").val();
		mc.setPennyAuctionRewards({
			_paStartReward: paStartReward,
			_paEndReward: paEndReward,
			_paFeeCollectRewardDenom: paRewardDenom
		}).then(function(){
			alert("Values updated.");
			updateMc();
		}).catch(function(){
			alert("Unsuccessful - are you the admin?");
		});
	})


	function updatePac() {
		if (!pac) return alert("pac not loaded.");
		util.bindToElement(pac.getAdmin(), $("#PacAdmin"));
		pac.numDefinedAuctions().then(function(num){
			$("#PacNumDefinedAuctions").text(num);

			const $ctnr = $("#PacDefinedAuctions").empty();
			const $template = $(".pacDefinedAuctionTemplate");
			for (var i=0; i<=num; i++){
				let index = i;
				let $defined = $template
					.clone()
					.removeClass("pacDefinedAuctionTemplate")
					.addClass("pacDefinedAuction")
					.appendTo($ctnr)
					.show();

				$defined.find(".index").text(index);
				pac.definedAuctions([index]).then((res)=>{
					$defined.find(".values").show();
					$defined.find(".auction").text(res[0]);
					$defined.find(".enabled").text(res[1] ? "ENABLED" : "DISABLED");
					$defined.find(".summary").val(res[2]);
					$defined.find(".initialPrize").val(ethUtil.toEth(res[3]));
					$defined.find(".bidPrice").val(ethUtil.toEth(res[4]));
					$defined.find(".bidIncr").val(ethUtil.toEth(res[5]));
					$defined.find(".bidAddBlocks").val(res[6]);
					$defined.find(".initialBlocks").val(res[7]);
					$defined.find(".change").click(function(){
						editDefinedAuction(index);
					})
					$defined.find(".enable").click(function(){
						enableDefinedAuction(index);
					});
					$defined.find(".disable").click(function(){
						disableDefinedAuction(index);
					});
				});
			};
		});
	}
	function editDefinedAuction(index){
		if (!pac) return alert("Pac not loaded.");

		const $e = $("#PacDefinedAuctions").find(".pacDefinedAuction").eq(index);
		if ($e.find(".index").text()!=index)
			throw new Error("Got the wrong one!");
		var obj = {
			_index: index,
			_summary: $e.find(".summary").val(),
			_initialPrize: ethUtil.toWei($e.find(".initialPrize").val()),
			_bidPrice: ethUtil.toWei($e.find(".bidPrice").val()),
			_bidIncr: ethUtil.toWei($e.find(".bidIncr").val()),
			_bidAddBlocks: $e.find(".bidAddBlocks").val(),
			_initialBlocks: $e.find(".initialBlocks").val()
		};
		pac.editDefinedAuction(obj).then(function(){
			alert(`Defined auction ${index} updated!`);
			updatePac();
		}).catch(e=>{
			alert(`Failed to edit auction ${index}!`);
		});
	}
	function enableDefinedAuction(index){
		if (!pac) return alert("Pac not loaded");
		pac.enableDefinedAuction({_index: index}).then(()=>{
			alert(`Defined auction ${index} is now enabled.`);
			updatePac();
		}).catch(e=>{
			alert(`Failed to enable auction ${index}.`);
		})
	}
	function disableDefinedAuction(index){
		if (!pac) return alert("Pac not loaded");
		debugger;
		pac.disableDefinedAuction({_index: index}).then(()=>{
			alert(`Defined auction ${index} is now enabled.`);
			updatePac();
		}).catch(e=>{
			alert(`Failed to enable auction ${index}.`);
		})
	}

	/*
DiceNumUnresolved
	*/
	function updateDice() {
		if (!dice) return alert("dice not loaded.");
		util.bindToElement(ethUtil.getBalance(dice.address).then(ethUtil.toEthStr), $("#DiceBalance"));
		util.bindToElement(dice.getNumUnresolvedRolls(), $("#DiceNumUnresolved"));
		util.bindToElement(dice.getProfits().then(ethUtil.toEthStr), $("#DiceSendProfits"));
		util.bindToElement(dice.bankroll().then(ethUtil.toEthStr), $("#DiceBankroll"));
		util.bindToElement(dice.minBankroll().then(ethUtil.toEthStr), $("#DiceMinBankroll"));
		util.bindToElement(dice.getAdmin(), $("#DiceAdmin"));
		util.bindToInput(dice.feeBips(), $("#DiceFeeBips"));
		util.bindToInput(dice.minBet().then(ethUtil.toEth), $("#DiceMinBet"));
		util.bindToInput(dice.maxBet().then(ethUtil.toEth), $("#DiceMaxBet"));
		util.bindToInput(dice.minNumber(), $("#DiceMinNumber"));
		util.bindToInput(dice.maxNumber(), $("#DiceMaxNumber"));
		
		dice.curId().then((id)=>{
			return dice.rolls([id])
		}).then(roll=>{
			const result = roll[5];
			const isResolved = !result.equals(0);
			isResolved
				? $("#btnDiceResolveLatest").attr("disabled","disabled")
				: $("#btnDiceResolveLatest").removeAttr("disabled");
		});
	}
	$("#DiceChangeSettings").click(function(){
		if (!dice) return alert("dice not loaded.");
		const feeBips = $("#DiceFeeBips").val();
		const minBet = ethUtil.toWei($("#DiceMinBet").val());
		const maxBet = ethUtil.toWei($("#DiceMaxBet").val());
		const minNumber = $("#DiceMinNumber").val();
		const maxNumber = $("#DiceMaxNumber").val();
		dice.changeSettings({
			_minBet: minBet,
			_maxBet: maxBet,
			_minNumber: minNumber,
			_maxNumber: maxNumber,
			_feeBips: feeBips
		}).then(function(){
			alert("Values updated.");
			updateDice();
		}).catch(function(){
			alert("Unsuccessful - are you the admin?");
		});
	});
	$("#btnDiceSendProfits").click(function(){
		dice.sendProfits([]).then(function(){
			alert("Profits sent.");
			updateDice();
		}).catch(function(){
			alert("Unsuccessful - are you the admin?");
		})
	})
	$("#btnDiceRemoveBankroll").click(function(){
		const num = ethUtil.toWei($("#DiceRemoveBankroll").val());
		dice.removeBankroll([num]).then(function(){
			alert("Bankroll removed.");
			updateDice();
		}).catch(function(){
			alert("Unsuccessful - are you the admin?");
		})
	});
	$("#btnDiceAddBankroll").click(function(){
		const num = ethUtil.toWei($("#DiceAddBankroll").val());
		dice.addBankroll([], {value: num}).then(function(){
			alert("Bankroll added.");
			updateDice();
		}).catch(function(){
			alert("Unsuccessful.");
		})
	});
	$("#btnDiceResolveMany").click(function(){
		const num = new BigNumber($("#DiceResolveRolls").val());
		dice.resolveUnresolvedRolls([num]).then(function(){
			alert("Resolved.");
			updateDice();
		}).catch(function(){
			alert("Unsuccessful.");	
		});
	});
	$("#btnDiceResolveLatest").click(function(){
		dice.curId().then(rollId=>{
			return dice.payoutRoll([rollId])
		}).then(()=>{
			alert("Roll resolved.");
			updateDice();
		});
	})
});