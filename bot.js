process.env.TZ = 'Asia/Hong_Kong' 
require('log-timestamp')(function() { return 'date="' + new Date().toLocaleTimeString() + '" message="%s"' });;
const nodemailer = require('nodemailer');
const { request, gql } = require ('graphql-request');

const { ethers, Wallet, Contract } = require("ethers");
var cron = require('node-cron');
var fs = require('fs')

const borrowerJson = require('./borrower.json');

const provider = new ethers.providers.JsonRpcProvider("https://api.avax-test.network/ext/bc/C/rpc");
const mnemonic = "essence record chronic ancient wrong rain toss alcohol stage curtain erosion mercy";
const walletMnemonic = Wallet.fromMnemonic(mnemonic);
const wallet = walletMnemonic.connect(provider)

const FujiVaultAVAX = require('./abi/fujidao/FujiVaultAVAX.json');
const addressFujiVaultAVAX = "0xE72cA9163148C6a7d101b21c942584689eD83F05";
const abiFujiVaultAVAX = FujiVaultAVAX.abi;
var myFujiVaultETHBTC = new Contract(addressFujiVaultAVAX, abiFujiVaultAVAX, provider);

const FujiOracle = require('./abi/fujidao/FujiOracle.json');
const addressFujiOracle = "0x707c7C644a733E71E97C54Ee0F9686468d74b9B4";
const abiFujiOracle = FujiOracle.abi;
var myFujiOracle = new Contract(addressFujiOracle, abiFujiOracle, provider);

const FliquidatorAVAX = require('./abi/fujidao/FliquidatorAVAX.json');
const addressFliquidatorAVAX = "0xcc6fFef32ab12BaB4ebcd8520573c5fa07C2d663";
const abiFliquidatorAVAX = FliquidatorAVAX.abi;
var myFliquidatorAVAX = new Contract(addressFliquidatorAVAX, abiFliquidatorAVAX, provider);
//test
const abiTopUpKeeperHelper = require('./abi/backd/TopUpKeeperHelper.json');
const addressTopUpKeeperHelper = "0xD7395a12c0b56458E157253B70A08535331972de";
var myTopUpKeeperHelper = new Contract(addressTopUpKeeperHelper, abiTopUpKeeperHelper, provider);

const abiTopupAction = require('./abi/backd/topupAction.json');
const addressTopupAction = "0x26B831D2Bf4C41D6C942784aDD61D4414a777a63";
var myTopupAction = new Contract(addressTopupAction, abiTopupAction, provider);

const abiErc20 = require('./abi/Hong.json');

const USDT = "0x02823f9B469960Bb3b1de0B3746D4b95B7E35543";
const WBTC = "0x9C1DCacB57ADa1E9e2D3a8280B7cfC7EB936186F";
const WETH = "0x9668f5f55f2712Dd2dfa316256609b516292D554";

var myBTC = new Contract(WBTC, abiErc20, provider);

var borrowerListener = async () => {
    console.log("borrowerListener Start")
    try {
        myFujiVaultETHBTC.on("Borrow", (address, borrowAsset, amount, event) => {
            console.log(`${address} borrow ${(amount)} of asset ${borrowAsset}`);
            fs.readFile('borrower.json', function (err, data) {
                var json = JSON.parse(data);
                if (json.indexOf(address) < 0) {
                    json.push(address);

                    fs.writeFile("borrower.json", JSON.stringify(json), (err) => {
                        if (err) {
                            throw err;
                        }

                        console.log('The new borrower address has been saved!');
                    })
                } else {
                    console.log("borrower already exist.");
                }
            })
        });
    } catch (error) {
        // console.error("error %s", error);
        // mailTransporter.sendMail({
        //     from: 'info@loanshark.tech',
        //     to: 'info@loanshark.tech',
        //     subject: 'Borrower Bot Error',
        //     text: 'Borrower Bot Error with error ' + error
        // }, function (err, data) {
        //     if (err) {
        //         console.log('Error Occurs');
        //     } else {
        //         console.log('Email sent successfully');
        //     }
        // });
    }
};

var liquidationJob = async () => {
    console.log("liquidationJob Start")
    var addressesToBeLiqudated = [];
    var userHealthRatioToBeLiqudated = [];
    var userDebtBalanceToBeLiqudated = [];
    var userDepositBalanceToBeLiqudated = [];
    try {
        let argsPriceOfEth = [
            USDT,
            WETH,
            2
        ];
        var priceOfEth = await myFujiOracle.getPriceOf(...argsPriceOfEth);

        let argsPriceOfBtc = [
            USDT,
            WBTC,
            2
        ]
        var priceOfBtc = await myFujiOracle.getPriceOf(...argsPriceOfBtc);

        const arr = Object.values(borrowerJson);
        for (var i in arr) {
            var address = arr[i];
            var userDebtBalance = ethers.utils.formatUnits(await myFujiVaultETHBTC.userDebtBalance(address), "gwei") * 10;
            var userDepositBalance = ethers.utils.formatUnits(await myFujiVaultETHBTC.userDepositBalance(address), "ether");
            var collatF = await myFujiVaultETHBTC.collatF();
            var LTV = collatF.b/collatF.a;
            var userHealthRatio = (userDepositBalance * priceOfEth / 100) * LTV / (userDebtBalance * priceOfBtc / 100);

            if (userHealthRatio < 1) {
                addressesToBeLiqudated.push(address);
                userHealthRatioToBeLiqudated.push(userHealthRatio);
                userDebtBalanceToBeLiqudated.push(userDebtBalance);
                userDepositBalanceToBeLiqudated.push(userDepositBalance);
            }
        }

        if (addressesToBeLiqudated.length > 0) {
            const contractWithSignerAA = myBTC.connect(wallet);
            var txAA = await contractWithSignerAA.approve(addressFliquidatorAVAX, 1000000000000);

            const contractWithSigner = myFliquidatorAVAX.connect(wallet);
            var tx = await contractWithSigner.batchLiquidate(addressesToBeLiqudated, addressFujiVaultAVAX);
            tx.wait().then( (receipt) => {
                console.log("tx: " + JSON.stringify(tx));
             
                addressesToBeLiqudated.forEach(function(address, index) {
                    var userHealthRatioAfter = userHealthRatioToBeLiqudated[index];
                    var userDebtBalanceAfter = userDebtBalanceToBeLiqudated[index];
                    var userDepositBalanceAfter = userDepositBalanceToBeLiqudated[index];
                    var date = new Date();
                    const query = gql`
                    mutation {
                        createPost( 
                          data: {
                                  title: "Liquidation",
                                  account: "${address}",
                                  content: "${tx.hash}",
                                  borrowingPosition: "ETH/BTC", 
                                  healthFactor: "${userHealthRatioAfter}",
                                  actionType: "Liquidation",
                                  amount: "${userDebtBalanceAfter} BTC",
                                  value: "$${userDebtBalanceAfter * priceOfBtc / 100}",
                                  newHealthFactor: "N/A",
                                  publishDate: "${date.toISOString()}"
                              }
                        ) {
                          id
                        }
                      }
                    `
                
                    request('https://backend.loanshark.tech/api/graphql/', query).then(
                        (data) => console.log(data)
                    )
                });
            });
        }

    } catch (error) {
        // console.error("error %s", error);
        // mailTransporter.sendMail({
        //     from: 'info@loanshark.tech',
        //     to: 'info@loanshark.tech',
        //     subject: 'Liqudation Bot Error',
        //     text: 'Liqudation Bot Error with error ' + error
        // }, function (err, data) {
        //     if (err) {
        //         console.log('Error Occurs');
        //     } else {
        //         console.log('Email sent successfully');
        //     }
        // });
    }
};



var protectionBot = async () => {
    console.log("protectionBot Start")
        let args = [
            0,
            1000
        ];
        var executableTopups = await myTopUpKeeperHelper.getExecutableTopups(...args);
        for (var i in executableTopups[0]) {  
            var address = executableTopups[0][i][0];
            var protocol = executableTopups[0][i][2];

                console.log("top-up action starts: " + JSON.stringify(address));

                try {
                    let argsPriceOfEth = [
                        USDT,
                        WETH,
                        2
                    ];
                    var priceOfEth = await myFujiOracle.getPriceOf(...argsPriceOfEth);
            
                    let argsPriceOfBtc = [
                        USDT,
                        WBTC,
                        2
                    ]
                    var priceOfBtc = await myFujiOracle.getPriceOf(...argsPriceOfBtc);

                    var userDebtBalance = ethers.utils.formatUnits(await myFujiVaultETHBTC.userDebtBalance(address), "gwei") * 10;
                    var userDepositBalance = ethers.utils.formatUnits(await myFujiVaultETHBTC.userDepositBalance(address), "ether");
                    var collatF = await myFujiVaultETHBTC.collatF();
                    var LTV = collatF.b/collatF.a;
                    var userHealthRatio = (userDepositBalance * priceOfEth / 100) * LTV / (userDebtBalance * priceOfBtc / 100);

                    const contractWithSigner = myTopupAction.connect(wallet);

                    let argsExecute = [
                        address,
                        address + "000000000000000000000000",
                        "0xe71fa402007FAD17dA769D1bBEfA6d0790fCe2c7",
                        protocol,
                        "13000000000000000000"
                    ];
                    var tx = await contractWithSigner.execute(...argsExecute);
                    tx.wait().then(function (receipt) {
                        console.log("tx: " + JSON.stringify(tx));

                        function one() {
                            return new Promise(resolve => {
                                var newDebt = myFujiVaultETHBTC.userDebtBalance(address);
                                resolve(newDebt);
                            });
                        }
                        function two() {
                            return new Promise(resolve => {
                                var newDeposit = myFujiVaultETHBTC.userDepositBalance(address);
                                resolve(newDeposit);
                            });
                        }
                        function three() {
                            return new Promise(resolve => {
                                var newCollatF = myFujiVaultETHBTC.collatF();
                                resolve(newCollatF);
                            });
                        }
                
                        one().then((newDebt) => { two().then((newDeposit) => { three().then((newCollatF) => { 
                            var newUserDebtBalance = ethers.utils.formatUnits(newDebt, "gwei") * 10;
                            var newUserDepositBalance = ethers.utils.formatUnits(newDeposit, "ether");
                            var newLTV = newCollatF.b/newCollatF.a;
                            var newUserHealthRatio = (newUserDepositBalance * priceOfEth / 100) * newLTV / (newUserDebtBalance * priceOfBtc / 100);
                            var date = new Date();

                            var actionType = protocol == "0x66756a6964616f00000000000000000000000000000000000000000000000000" ? "Protection by Auto Repay" : "Protection by Auto Top-up";
                            var amount = protocol == "0x66756a6964616f00000000000000000000000000000000000000000000000000" ? userDebtBalance - newUserDebtBalance : newUserDepositBalance - userDepositBalance;
                            var value = protocol == "0x66756a6964616f00000000000000000000000000000000000000000000000000" ? amount * priceOfBtc : amount * priceOfEth;
                            var token = protocol == "0x66756a6964616f00000000000000000000000000000000000000000000000000" ? "BTC" : "ETH";
                            
                            console.log(protocol);
                            console.log(actionType);
                            console.log(amount);
                            console.log(value);
                            console.log(token);
                            const query = gql`
                                mutation {
                                    createPost( 
                                    data: {
                                            title: "Protection ${newUserDebtBalance}",
                                            account: "${address}",
                                            content: "${tx.hash}",
                                            borrowingPosition: "ETH/BTC", 
                                            healthFactor: "${userHealthRatio}",
                                            actionType: "${actionType}",
                                            amount: "${amount} ${token}",
                                            value: "$${value / 100}",
                                            newHealthFactor: "${newUserHealthRatio}",
                                            publishDate: "${date.toISOString()}"
                                        }
                                    ) {
                                    id
                                    }
                                }
                            `
                        
                            request('https://backend.loanshark.tech/api/graphql/', query).then(
                                (data) => console.log(data)
                            )


                        }) }) }) 
                    });
                } catch (error) {
                    // console.error("error %s", error);
                    // mailTransporter.sendMail({
                    //     from: 'info@loanshark.tech',
                    //     to: 'info@loanshark.tech',
                    //     subject: 'Protection Bot Error',
                    //     text: 'Protection Bot Error with error ' + error
                    // }, function (err, data) {
                    //     if (err) {
                    //         console.log('Error Occurs');
                    //     } else {
                    //         console.log('Email sent successfully');
                    //     }
                    // });
                }
        }
};

cron.schedule('* * * * *', () => {
    liquidationJob();
    protectionBot();
});
borrowerListener(); 