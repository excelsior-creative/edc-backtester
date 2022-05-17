const dataForge = require("data-forge")
require("data-forge-fs") // For loading files.
require("data-forge-indicators") // For the moving average indicator.
const { plot } = require("plot")
require("@plotex/render-image")
const { backtest, analyze, computeEquityCurve, computeDrawdown } = require("grademark")
var Table = require("easy-table")
const fs = require("fs")
const moment = require("moment")

const EMA_SHORT = 12
const EMA_LONG = 26
const SIGNAL = 9
const MIN_HISTOGRAM_LENGTH = 3
const LOOKBACK_WINDOW = EMA_LONG

// this is all the 3L/3S pairs available on kucoin
let pairs = [
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
pairs = pairs.map((pair: string) => {
  return pair + "3L-USDT"
}).concat(
  pairs.map((pair: string) => {
    return pair + "3S-USDT"
  })
).sort();

const periods = ["1min", "3min", "5min", "15min", "30min", "1hour", "2hour", "4hour", "8hour"]

async function main() {

  let combinationNumber = 0;
  let iterationNumber = 0;

  for (const pair of pairs) {
    for (const period of periods) {

      combinationNumber++;

      const iterationName = `${pair}-${period}`;
      const fileName =
        `C:\\Users\\bjohn\\Documents\\GitHub\\3commas-management-utilities\\output\\2022-05-17\\${iterationName}-10500.csv`

      console.log(`${combinationNumber} - ${iterationName}`);

      // ensure directory exists
      const dir = __dirname + `/output/${new Date().toISOString().split('T')[0]}/`;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }

      let inputSeries = (await dataForge.readFile(fileName).parseCSV())
        .parseDates("date", "YYYY/MM/DD hh:mm:ss")
        .parseFloats(["open", "high", "low", "close", "volume"])
        .setIndex("date") // Index so we can later merge on date.
        .renameSeries({ date: "time" })
        .bake()

      const macd = inputSeries.deflate((row) => row.close).macd(EMA_SHORT, EMA_LONG, SIGNAL)
      inputSeries = inputSeries.withSeries("macd", macd)

      const strategy = {
        lookbackPeriod: LOOKBACK_WINDOW,
        entryRule: (enterPosition, args) => {
          if (
            args.lookback.content.values[0] &&
            args.lookback.content.values[0].macd &&
            args.lookback.content.values[0].macd.histogram &&
            args.bar.macd.histogram &&
            parseFloat(args.lookback.content.values[0].macd.histogram) < 0 &&
            parseFloat(args.bar.macd.histogram) > 0
          ) {
            // require a certain number of bars to be positive to avoid jitter
            let histogramLength = 0
            for (let i = 0; i < LOOKBACK_WINDOW; i++) {
              if (args.lookback.content.values[i].macd.histogram < 0) {
                histogramLength++
              } else {
                break
              }
            }
            if (histogramLength > MIN_HISTOGRAM_LENGTH) {
              enterPosition()
            }
          }
        },

        exitRule: (exitPosition, args) => {
          // close on any bearish crossover
          if (
            parseFloat(args.lookback.content.values[0].histogram) > 0 &&
            parseFloat(args.bar.histogram) < 0
          ) {
            exitPosition() // Sell when price is above average.
          }
        },

        stopLoss: (args) => {
          return args.entryPrice * (1 / 100) // Stop out on 1% loss
        },
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

      const startingCapital = 10000
      const analysis = analyze(startingCapital, trades)

      const analysisTable = new Table()

      for (const key of Object.keys(analysis)) {
        analysisTable.cell("Metric", key)
        analysisTable.cell("Value", analysis[key])
        analysisTable.newRow()
      }

      const analysisOutput = analysisTable.toString()
      console.log(analysisOutput)
      const analysisOutputFilePath = `${dir}${iterationName}-analysis.txt`
      fs.writeFileSync(analysisOutputFilePath, analysisOutput)
      console.log(">> " + analysisOutputFilePath)

      console.log("Plotting...")

      // Visualize the equity curve and drawdown chart for your backtest:
      const equityCurve = computeEquityCurve(startingCapital, trades)
      const equityCurveOutputFilePath = `${dir}${iterationName}-equity.png`
      await plot(equityCurve, { chartType: "area", y: { label: "Equity $" } }).renderImage(
        equityCurveOutputFilePath
      )
      console.log(">> " + equityCurveOutputFilePath)

      const equityCurvePctOutputFilePath = `${dir}${iterationName}-equity-curve-pct.png`
      const equityPct = equityCurve.map((v) => ((v - startingCapital) / startingCapital) * 100)
      await plot(equityPct, { chartType: "area", y: { label: "Equity %" } }).renderImage(
        equityCurvePctOutputFilePath
      )
      console.log(">> " + equityCurvePctOutputFilePath)

      const drawdown = computeDrawdown(startingCapital, trades)
      const drawdownOutputFilePath = `${dir}${iterationName}-drawdown.png`
      await plot(drawdown, { chartType: "area", y: { label: "Drawdown $" } }).renderImage(
        drawdownOutputFilePath
      )
      console.log(">> " + drawdownOutputFilePath)

      const drawdownPctOutputFilePath = `${dir}${iterationName}-drawdown-pct.png`
      const drawdownPct = drawdown.map((v) => (v / startingCapital) * 100)
      await plot(drawdownPct, { chartType: "area", y: { label: "Drawdown %" } }).renderImage(
        drawdownPctOutputFilePath
      )
      console.log(">> " + drawdownPctOutputFilePath)
    }
  }
}

main()
  .then(() => console.log("Finished"))
  .catch((err) => {
    console.error("An error occurred.")
    console.error((err && err.stack) || err)
  })
