const dataForge = require("data-forge")
require("data-forge-fs") // For loading files.
require("data-forge-indicators") // For the moving average indicator.
const { plot } = require("plot")
require("@plotex/render-image")
const { backtest, analyze, computeEquityCurve, computeDrawdown } = require("grademark")
var Table = require("easy-table")
const fs = require("fs")
const moment = require("moment")
const converter = require('json-2-csv');
import * as _ from 'lodash';
const csv = require('csvtojson')
const ti = require('technicalindicators');

const FAST_PERIOD = 12;
const SLOW_PERIOD = 26;
const SIGNAL_PERIOD = 9;
const MIN_HISTOGRAM_LENGTH = 3;
const STOPLOSS_PERCENTAGE = 1;
const LOOKBACK_PERIOD = 26;

// this is all the 3L/3S pairs available on kucoin
let PAIRS = [
  "NEAR",
  "SOL",
  "BTC",
  "FTM",
  "AVAX",
  "GALAX",
  "ADA",
  "ETH",
  "AXS",
  "MANA",
  "MATIC",
  "ATOM",
  "XRP",
  "DOT",
  "SAND",
  "SUCHI",
  "AAVE",
  "VET",
  "LINK",
  "DOGE",
  "LTC",
  "BNB",
  "EOS",
  "BCH",
  "UNI",
];
PAIRS = PAIRS.map((pair: string) => {
  return pair + "3L-USDT"
}).concat(
  PAIRS.map((pair: string) => {
    return pair + "3S-USDT"
  })
).sort();

const PERIODS = ["5min", "15min", "30min", "1hour", "2hour"].sort();
const RUN_DATE = '2022-05-19';
let previousValues: any = [];

async function main() {

  let combinationNumber = 0;
  let iterationNumber = 0;
  const results: any = [];

  // ensure directory exists
  const dir = __dirname + `/output/${new Date().toISOString().split('T')[0]}/`;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  for (const pair of PAIRS) {
    for (const period of PERIODS) {

      combinationNumber++;

      // if (combinationNumber > 1) {
      //   break;
      // }

      const iterationName = `${pair}-${period}`;
      const fileName =
        `C:\\Users\\bjohn\\Documents\\GitHub\\3commas-management-utilities\\output\\${RUN_DATE}\\${iterationName}-10500.csv`

      console.log(`${combinationNumber} - ${iterationName}`);

      if (!fs.existsSync(fileName)) {
        console.log(`Skipping: ${iterationName}`);
        continue;
      }

      // // remove duplicates from input file and resave
      // let jsonArray = await csv().fromFile(fileName);
      // jsonArray = jsonArray.filter((value, index, self) =>
      //   index === self.findIndex((t) => (
      //     t.timestamp === value.timestamp
      //   ))
      // );

      // const inputRows = await dataForge.readFile(fileName).parseCSV();
      // let inputSeries = (inputRows)
      //   .parseDates("date", "YYYY/MM/DD hh:mm:ss A")
      //   .parseFloats(["open", "high", "low", "close", "volume"])
      //   .setIndex("date") // Index so we can later merge on date.
      //   .renameSeries({ date: "time" })
      //   .bake()


      // let inputSeries = dataForge.readFileSync(fileName)
      //   .parseCSV()
      //   .parseDates("date", "YYYY/MM/DD hh:mm:ss A")
      //   .parseFloats(["open", "high", "low", "close", "volume"])
      //   .setIndex("date") // Index so we can later merge on date.
      //   .renameSeries({ date: "time" });

      let inputSeries = dataForge.readFileSync(fileName)
        .parseCSV()
        .parseDates("date", "D/MM/YYYY")
        .parseFloats(["open", "high", "low", "close", "volume"])
        .setIndex("date")
        .renameSeries({ date: "time" });

      // const closingPrices = inputRows.content.values.rows.map(r => parseFloat(r[3]));
      const macd = inputSeries
        .deflate((row) => row.close)
        .macd(FAST_PERIOD, SLOW_PERIOD, SIGNAL_PERIOD)

      inputSeries = inputSeries
        .withSeries("macd", macd)   // Integrate moving average into data, indexed on date.
        .skip(30)                           // Skip blank sma entries.

      // // Add whatever indicators and signals you want to your data.
      const movingAverage = inputSeries
        .deflate(bar => bar.close)          // Extract closing price series.
        .sma(30);                           // 30 day moving average.

      inputSeries = inputSeries
        .withSeries("sma", movingAverage)   // Integrate moving average into data, indexed on date.
        .skip(30)                           // Skip blank sma entries.

      // const closingPrices = inputSeries.deflate(bar => parseFloat(bar.close));
      // let macdResult = new ti.MACD({
      //   values: closingPrices,
      //   fastPeriod: FAST_PERIOD,
      //   slowPeriod: SLOW_PERIOD,
      //   signalPeriod: SIGNAL_PERIOD,
      //   SimpleMAOscillator: false,
      //   SimpleMASignal: false
      // }).result;
      // inputSeries = inputSeries.withSeries("macd", macdResult).skip(26);

      // chop off the beginning and the end to avoid anomolies

      // This is a very simple and very naive mean reversion strategy:
      // const strategy = {
      //   entryRule: (enterPosition, args) => {
      //     if (args.bar.close < args.bar.sma) { // Buy when price is below average.
      //       enterPosition();
      //     }
      //   },

      //   exitRule: (exitPosition, args) => {
      //     if (args.bar.close > args.bar.sma) {
      //       exitPosition(); // Sell when price is above average.
      //     }
      //   },

      //   stopLoss: args => { // Intrabar stop loss.
      //     return args.entryPrice * (5 / 100); // Stop out on 5% loss from entry price.
      //   },
      // };

      const strategy = {
        lookbackPeriod: LOOKBACK_PERIOD,
        entryRule: (enterPosition, args) => {

          const previousValues = args.lookback.content.values.filter(p => parseFloat(p.timestamp) < parseFloat(args.bar.timestamp));
          const previousValue = previousValues[previousValues.length - 1];

          // console.log(`Checking: Current ${args.bar.time}: ${args.bar.timestamp} with Previous ${previousValue.time}: ${previousValue.timestamp}`);

          if (
            previousValue &&
            previousValue.histogram &&
            args.bar.histogram &&
            parseFloat(previousValue.histogram) <= 0 &&
            parseFloat(args.bar.histogram) > 0
          ) {
            // require a certain number of bars to be positive to avoid jitter
            // let histogramLength = 0
            // for (let i = 0; i < LOOKBACK_PERIOD; i++) {
            //   if (args.lookback.content.values[i].histogram < 0) {
            //     histogramLength++
            //   } else {
            //     break
            //   }
            // }
            // if (histogramLength > MIN_HISTOGRAM_LENGTH) {
            //   enterPosition()
            // }

            // console.log('Entering position at: ' + args.bar.close);

            enterPosition()
          }

          // previousValues.push(args.bar);
          // if (previousValues.length > LOOKBACK_PERIOD) {
          //   previousValues = previousValues.slice(1);
          // }
        },

        exitRule: (exitPosition, args) => {

          const previousValues = args.lookback.content.values.filter(p => parseFloat(p.timestamp) < parseFloat(args.bar.timestamp));
          const previousValue = previousValues[previousValues.length - 1];

          // close on any bearish crossover
          if (
            previousValue &&
            previousValue.histogram &&
            args.bar.histogram &&
            parseFloat(previousValue.histogram) >= 0 &&
            parseFloat(args.bar.histogram) < 0
          ) {

            // console.log('Exiting position at: ' + args.bar.close);
            exitPosition() // Sell when price is above average.
          }
        },

        // stopLoss: (args) => {
        //   return args.entryPrice * (STOPLOSS_PERCENTAGE / 100) // Stop out on 1% loss
        // },
      }

      // Backtest your strategy, then compute and print metrics:
      const trades = backtest(strategy, inputSeries)
      console.log("The backtest conducted " + trades.length + " trades!")

      new dataForge.DataFrame(trades)
        .transformSeries({
          entryTime: (d) => moment(d).format("YYYY/MM/DD"),
          exitTime: (d) => moment(d).format("YYYY/MM/DD"),
        })
        .asCSV()
        .writeFileSync(`${dir}/${iterationName}-trades.csv`)

      const startingCapital = 10000;
      const analysis: any = {
        pair: pair,
        period: period,
        ...analyze(startingCapital, trades)
      };

      console.log(`Completed ${trades.length} trades ${Math.round(analysis.profitPct)}%`)

      results.push(analysis);

      const analysisTable = new Table()

      for (const key of Object.keys(analysis)) {
        analysisTable.cell("Metric", key)
        analysisTable.cell("Value", analysis[key])
        analysisTable.newRow()
      }

      const analysisOutput = analysisTable.toString()
      console.log(analysisOutput)

      // const analysisOutputFilePath = `${dir}${iterationName}-analysis.txt`
      // fs.writeFileSync(analysisOutputFilePath, analysisOutput)
      // console.log(">> " + analysisOutputFilePath)

      // console.log("Plotting...")

      // // Visualize the equity curve and drawdown chart for your backtest:
      // const equityCurve = computeEquityCurve(startingCapital, trades)
      // const equityCurveOutputFilePath = `${dir}${iterationName}-equity.png`
      // await plot(equityCurve, { chartType: "area", y: { label: "Equity $" } }).renderImage(
      //   equityCurveOutputFilePath
      // )
      // console.log(">> " + equityCurveOutputFilePath)

      // const equityCurvePctOutputFilePath = `${dir}${iterationName}-equity-curve-pct.png`
      // const equityPct = equityCurve.map((v) => ((v - startingCapital) / startingCapital) * 100)
      // await plot(equityPct, { chartType: "area", y: { label: "Equity %" } }).renderImage(
      //   equityCurvePctOutputFilePath
      // )
      // console.log(">> " + equityCurvePctOutputFilePath)

      // const drawdown = computeDrawdown(startingCapital, trades)
      // const drawdownOutputFilePath = `${dir}${iterationName}-drawdown.png`
      // await plot(drawdown, { chartType: "area", y: { label: "Drawdown $" } }).renderImage(
      //   drawdownOutputFilePath
      // )
      // console.log(">> " + drawdownOutputFilePath)

      // const drawdownPctOutputFilePath = `${dir}${iterationName}-drawdown-pct.png`
      // const drawdownPct = drawdown.map((v) => (v / startingCapital) * 100)
      // await plot(drawdownPct, { chartType: "area", y: { label: "Drawdown %" } }).renderImage(
      //   drawdownPctOutputFilePath
      // )
      // console.log(">> " + drawdownPctOutputFilePath)
    }
  }

  // export results to csv
  const analysisOutputFilePath = `${dir}_analysis.csv`

  // write to csv
  await new Promise((resolve, reject) => {
    converter.json2csv(results, (err: any, fileData: any, options: any) => {
      if (err) throw err;

      fs.writeFile(analysisOutputFilePath, fileData, 'utf8', function (err: any) {
        if (err) {
          console.log(err);
          resolve(false)
        } else {
          console.log('Saved file: ' + analysisOutputFilePath);
          resolve(true);
        }
      });
    });
  });
}

main()
  .then(() => console.log("Finished"))
  .catch((err) => {
    console.error("An error occurred.")
    console.error((err && err.stack) || err)
  })
