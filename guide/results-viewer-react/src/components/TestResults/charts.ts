import {
  Chart,
  ChartDataset,
  ChartEvent,
  ChartTypeRegistry,
  Legend,
  LegendElement,
  LegendItem,
  LineController,
  LineElement,
  LinearScale,
  LogarithmicScale,
  PointElement,
  ScatterDataPoint,
  TimeScale,
  Title,
  Tooltip
} from "chart.js";
import { LogLevel, log } from "../../util/log";
import { DataPoint } from "./model";

// https://www.chartjs.org/docs/latest/getting-started/integration.html#bundlers-webpack-rollup-etc
Chart.register(
  LineElement,
  PointElement,
  LineController,
  LinearScale,
  LogarithmicScale,
  TimeScale,
  Legend,
  Title,
  Tooltip
);

const colors = [
  "#3366cc",
  "#dc3912",
  "#ff9900",
  "#109618",
  "#990099",
  "#0099c6",
  "#dd4477",
  "#66aa00",
  "#b82e2e",
  "#316395",
  "#994499",
  "#22aa99",
  "#aaaa11",
  "#6633cc",
  "#e67300",
  "#8b0707",
  "#651067",
  "#329262",
  "#5574a6",
  "#3b3eac"
];

export function RTT (el: HTMLCanvasElement, dataPoints: DataPoint[]): Chart {
  const MICROS_TO_MS = 1000;
  const datasets = [
    "avg",
    "min",
    "max",
    "std",
    90,
    95,
    99
  ].map((type, i) => {
    const borderColor = colors[i % colors.length];
    const backgroundColor = borderColor + "46";
    let label: string;
    // It's a ScatterDataPoint but thanks to chartjs-adapter-date-fns it will date Dates as well as numbers
    let data: (Omit<ScatterDataPoint, "x"> & { x: Date | number })[];
    if (type === "avg") {
      label = "Avg";
      data = dataPoints.map((dp) => ({
        x: dp.time,
        y: dp.rttHistogram.getTotalCount()
          ? Math.round(dp.rttHistogram.getMean()) / MICROS_TO_MS
          : NaN
      }));
    } else if (type === "min") {
      label = "Min";
      data = dataPoints.map((dp) => ({
        x: dp.time,
        y: dp.rttHistogram.getTotalCount()
          ? Number(dp.rttHistogram.getMinNonZeroValue()) / MICROS_TO_MS
          : NaN
      }));
    } else if (type === "max") {
      label = "Max";
      data = dataPoints.map((dp) => ({
        x: dp.time,
        y: dp.rttHistogram.getTotalCount()
          ? Number(dp.rttHistogram.getMaxValue()) / MICROS_TO_MS
          : NaN
      }));
    } else if (type === "std") {
      label = "Std Dev";
      data = dataPoints.map((dp) => ({
        x: dp.time,
        y: dp.rttHistogram.getTotalCount()
          ? Math.round(dp.rttHistogram.getStdDeviation()) / MICROS_TO_MS
          : NaN
      }));
    } else if (typeof type === "number") {
      label = type + "th PCTL";
      data = dataPoints.map((dp) => ({
        x: dp.time,
        y: dp.rttHistogram.getTotalCount()
          ? Number(dp.rttHistogram.getValueAtPercentile(type)) / MICROS_TO_MS
          : NaN
      }));
    } else {
      throw new Error("Unexpected value when generating RTT chart");
    }
    return {
      label,
      borderColor,
      backgroundColor,
      data,
      hidden: type === "std"
    };
  });

  let chartType: "linear" | "logarithmic" = "linear";
  dataPoints.forEach((dp) => {
    const shouldBeLogarithmic =
      dp.rttHistogram.getTotalCount() &&
      Number(dp.rttHistogram.getMaxValue()) >
        dp.rttHistogram.getMean() + 5 * dp.rttHistogram.getStdDeviation();
    if (shouldBeLogarithmic) {
      chartType = "logarithmic";
    }
  });

  // https://www.chartjs.org/docs/latest/getting-started/v3-migration.html
  const mainChart = new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      scales: {
        y: {
          type: chartType,
          title: {
            display: true,
            text: "RTT"
          },
          ticks: {
            callback: (v) => v + "ms",
            autoSkip: true
          }
        },
        x: {
          type: "time",
          time: {
            unit: "second"
          },
          ticks: {
            autoSkip: true
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: ({ formattedValue }) => formattedValue + "ms"
          }
        }
      }
    },
    plugins: [
      {
        id: "afterBuildTicksLogrithmicFix",
        beforeUpdate (chart: Chart) {
          const config = chart.options?.scales?.y;
          if (config) {
            config.afterBuildTicks = config.type === "logarithmic" ? afterBuildTicks : undefined;
          }
        }
      }
    ]
  });
  return mainChart as any as Chart;
}

class ChartDataSets {
  public dataSets: Map<
    string,
    [Map<Date, number>, ChartDataset]
  > = new Map();
  public dates: Set<Date> = new Set();

  public setPoint (
    key: string,
    x: Date,
    y: number,
    datasetParams: any = {}
  ) {
    this.dates.add(x);
    if (!this.dataSets.has(key)) {
      this.dataSets.set(key, [new Map(), datasetParams]);
    }
    this.dataSets.get(key)![0].set(x, y);
  }

  public getDataSets (): ChartDataset[] {
    const ret: ChartDataset[] = [];
    const sortedEntries = [...this.dataSets.entries()].sort(([a], [b]) => {
      if (a < b) {
        return -1;
      } else if (b < a) {
        return 1;
      } else {
        return 0;
      }
    });
    for (const [label, [points, datasetParams]] of sortedEntries) {
      const data = [];
      for (const x of this.dates) {
        const y = points.get(x) || 0;
        data.push({ x, y });
      }
      const borderColor = colors[ret.length % colors.length];
      const backgroundColor = borderColor + "46";
      const dataset = { label, data, borderColor, backgroundColor };
      ret.push(Object.assign(datasetParams, dataset));
    }
    return ret;
  }
}

export function totalCalls (el: HTMLCanvasElement, dataPoints: DataPoint[]): Chart {
  const chartDataSets = new ChartDataSets();
  for (const dp of dataPoints) {
    const x = dp.time;
    const statusCounts = Object.entries(dp.statusCounts).map(
      ([k, v]) => <[string, number]>[k + " count", v]
    );
    const pairs = [...statusCounts, ...Object.entries(dp.testErrors)];
    for (const [key, count] of pairs) {
      chartDataSets.setPoint(key, x, count);
    }
    chartDataSets.setPoint(
      "total calls",
      x,
      Number(dp.rttHistogram.getTotalCount()),
      { fill: false }
    );
  }
  const datasets = chartDataSets.getDataSets();
  // https://www.chartjs.org/docs/latest/getting-started/v3-migration.html
  const totalChart = new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      scales: {
        y: {
          type: "linear",
          ticks: {
            precision: 0,
            autoSkip: true
          },
          title: {
            display: true,
            text: "Count"
          }
        },
        x: {
          type: "time",
          time: {
            unit: "second"
          },
          ticks: {
            autoSkip: true
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: ({ datasetIndex, formattedValue: yLabel }) => {
              const { label } = datasets[datasetIndex || 0];
              const status = label ? parseInt(label.slice(0, 3), 10) : NaN;
              if (!isNaN(status)) {
                return `${yLabel} HTTP ${status}s`;
              } else if (label && label.startsWith("total")) {
                return `${yLabel} ${label.toLowerCase()}`;
              } else {
                return `${yLabel} ${label}`;
              }
            }
          }
        }
      }
    }
  });
  return totalChart;
}

// Default logartihmic graph y axis ticks overlap and do not look good.
// This function is applied to the chart config, and modifies the y axis ticks after the chart is created.
const afterBuildTicks = (chart: any) => {
  // Sets the max amount of ticks for the y-axis, may not be actual number of ticks displayed
  const maxTicks = Math.floor(Math.sqrt(chart.height));
  // Finds the max value to go to
  const maxLog = Math.log(chart.ticks[0]);
  // Gets minimum distance between two points
  const minLogSeparation = maxLog / maxTicks;

  const myTicks: number[] = [];
  let currLog = -Infinity;
  chart.ticks.reverse().forEach((tick: number) => {
    // Makes sure value is greater than 0
    const log = Math.max(0, Math.log(tick));
    // If distance between points is greater than min separation, add it to the ticks
    if (log - currLog > minLogSeparation) {
      myTicks.push(tick);
      currLog = log;
    }
  });
  // Sets chart ticks to modified ticks
  chart.ticks = myTicks;
};

// add a double-click handler to the chart legends
{
  let lastLegendClick: [number, number, Chart] | undefined;

  Chart.defaults.plugins.legend.onClick = function (
    _e: ChartEvent,
    legendItem: LegendItem,
    legend: LegendElement<keyof ChartTypeRegistry>
  ) {
    const chart: Chart = legend.chart;
    const datasets = chart.data.datasets!;
    let allHidden = true;
    if (legendItem.datasetIndex === undefined) {
      log("legendItem.datasetIndex was undefined. Please investigate", LogLevel.ERROR, legendItem);
      return;
    }
    for (let i = 0; i < datasets.length; i++) {
      const meta = chart.getDatasetMeta(i);
      if (!meta.hidden && i !== legendItem.datasetIndex) {
        allHidden = false;
        break;
      }
    }
    if (lastLegendClick && legendItem.datasetIndex === lastLegendClick[1]
      && Date.now() - lastLegendClick[0] < 250) {
      // double click
      for (let i = 0; i < datasets.length; i++) {
        const meta = chart.getDatasetMeta(i);
        meta.hidden = i !== legendItem.datasetIndex;
      }
    } else if (allHidden) {
      for (let i = 0; i < datasets.length; i++) {
        const meta = chart.getDatasetMeta(i);
        meta.hidden = false;
      }
    } else {
      const meta = chart.getDatasetMeta(legendItem.datasetIndex);
      meta.hidden = !legendItem.hidden;
    }
    chart.update();
    // timeStamp was removed from ChartEvent, use Date.now() instead
    lastLegendClick = [Date.now(), legendItem.datasetIndex, chart];
  };
}
