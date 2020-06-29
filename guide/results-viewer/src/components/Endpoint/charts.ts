import * as Chart from "chart.js";
import { DataPoint } from "../../model";

const colors = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395", "#994499", "#22aa99", "#aaaa11", "#6633cc", "#e67300", "#8b0707", "#651067", "#329262", "#5574a6", "#3b3eac"];

function rttDataSet (dataPoints: DataPoint[]): Chart.ChartDataSets[] {
  return ["avg", "min", "max", "std", 90, 95, 99].map((type, i) => {
    const MICROS_TO_MS = 1000;
    const borderColor = colors[i % colors.length];
    const backgroundColor = borderColor + "46";
    let label: string;
    let data: Chart.ChartPoint[];
    if (type == "avg") {
      label = "Avg";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Math.round(dp.rttHistogram.getMean()) / MICROS_TO_MS : NaN }));
    } else if (type == "min") {
      label = "Min";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Number(dp.rttHistogram.getMinNonZeroValue()) / MICROS_TO_MS : NaN }));
    } else if (type == "max") {
      label = "Max";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Number(dp.rttHistogram.getMaxValue()) / MICROS_TO_MS : NaN }));
    } else if (type == "std") {
      label = "Std Dev";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? (Math.round(dp.rttHistogram.getStdDeviation())) / MICROS_TO_MS : NaN}));
    } else if (typeof type == "number") {
      label = type + "th PCTL";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Number(dp.rttHistogram.getValueAtPercentile(type)) / MICROS_TO_MS : NaN }));
    } else {
      throw new Error("Unexpected value when generating RTT chart");
    }
    return { label, borderColor, backgroundColor, data, hidden: type === "std" };
  });
}

export class RTTChart {
  private chart: Chart;

  public constructor (el: HTMLCanvasElement, dataPoints: DataPoint[], logarithmicXScale: boolean) {
    const chartType = logarithmicXScale ? "logarithmic" : "linear";

    const datasets = rttDataSet(dataPoints);

    this.chart = new Chart.Chart(el, {
      type: "line",
      data: { datasets },
      options: {
        scales: {
          yAxes: [{
            type: chartType,
            scaleLabel: {
              display: true,
              labelString: "RTT"
            },
            ticks: {
              callback: (v) => v + "ms",
              autoSkip: true
            }
          }],
          xAxes: [{
            type: "time",
            time: {
              unit: "second"
            },
            ticks: {
              autoSkip: true,
              source: "data"
            }
          }]
        },
        tooltips: {
          callbacks: {
            label: ({yLabel}) => yLabel + "ms"
          }
        }
      },
      plugins: [{
        beforeUpdate (chart: any, _: any) {
          const config = chart.options.scales.yAxes[0];
          config.afterBuildTicks = config.type === "logarithmic" ? afterBuildTicks : undefined;
        }
      }]
    });
  }

  public updateDataSet (dataPoints: DataPoint[], logarithmicXScale: boolean) {
    const chartType = logarithmicXScale ? "logarithmic" : "linear";
    this.chart.config.options!.scales!.yAxes![0].type = chartType;
    this.chart.config.data = { datasets: rttDataSet(dataPoints) };
    this.chart.update();
  }

  public setYAxisType (type: "logarithmic" | "linear") {
    this.chart.config.options!.scales!.yAxes![0].type = type;
    this.chart.update();
  }

  public getYAxisType (): string {
    return this.chart.config.options!.scales!.yAxes![0].type!;
  }
}

export function RTT (el: HTMLCanvasElement, dataPoints: DataPoint[], logarithmicXScale: boolean) {
  const MICROS_TO_MS = 1000;
  const datasets: Chart.ChartDataSets[] = ["avg", "min", "max", "std", 90, 95, 99].map((type, i) => {
    const borderColor = colors[i % colors.length];
    const backgroundColor = borderColor + "46";
    let label: string;
    let data: Chart.ChartPoint[];
    if (type == "avg") {
      label = "Avg";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Math.round(dp.rttHistogram.getMean()) / MICROS_TO_MS : NaN }));
    } else if (type == "min") {
      label = "Min";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Number(dp.rttHistogram.getMinNonZeroValue()) / MICROS_TO_MS : NaN }));
    } else if (type == "max") {
      label = "Max";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Number(dp.rttHistogram.getMaxValue()) / MICROS_TO_MS : NaN }));
    } else if (type == "std") {
      label = "Std Dev";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? (Math.round(dp.rttHistogram.getStdDeviation())) / MICROS_TO_MS : NaN}));
    } else if (typeof type == "number") {
      label = type + "th PCTL";
      data = dataPoints.map((dp) => ({ x: dp.time, y: dp.rttHistogram.getTotalCount() ? Number(dp.rttHistogram.getValueAtPercentile(type)) / MICROS_TO_MS : NaN }));
    } else {
      throw new Error("Unexpected value when generating RTT chart");
    }
    return { label, borderColor, backgroundColor, data, hidden: type === "std" };
  });

  const chartType = logarithmicXScale ? "logarithmic" : "linear";

  const mainChart = new Chart.Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      scales: {
        yAxes: [{
          type: chartType,
          scaleLabel: {
            display: true,
            labelString: "RTT"
          },
          ticks: {
            callback: (v) => v + "ms",
            autoSkip: true
          }
        }],
        xAxes: [{
          type: "time",
          time: {
            unit: "second"
          },
          ticks: {
            autoSkip: true,
            source: "data"
          }
        }]
      },
      tooltips: {
        callbacks: {
          label: ({yLabel}) => yLabel + "ms"
        }
      }
    },
    plugins: [{
      beforeUpdate (chart: any, _: any) {
        const config = chart.options.scales.yAxes[0];
        config.afterBuildTicks = config.type === "logarithmic" ? afterBuildTicks : undefined;
      }
    }]
  });
  return mainChart;
}

class ChartDataSets {
  public dataSets: Map<string, [Map<Date, number>, Chart.ChartDataSets]> = new Map();
  public dates: Set<Date> = new Set();

  public setPoint (key: string, x: Date, y: number, datasetParams: Chart.ChartDataSets = {}) {
    this.dates.add(x);
    if (!this.dataSets.has(key)) {
      this.dataSets.set(key, [new Map(), datasetParams]);
    }
    this.dataSets.get(key)![0].set(x, y);
  }

  public getDataSets (): Chart.ChartDataSets[] {
    const ret: Chart.ChartDataSets[] = [];
    const sortedEntries = [...this.dataSets.entries()]
      .sort(([a], [b]) => {
        if (a < b) {
          return -1;
        } else if (b < a) {
          return 1;
        } else {
          return 0;
        }
      });
    for (const [label, [points, datasetParams]] of sortedEntries) {
      const data: Chart.ChartPoint[] = [];
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

export class StatusCountsChart {
  private chart: Chart;

  public constructor (el: HTMLCanvasElement, dataPoints: DataPoint[]) {
    const chartDataSets = new ChartDataSets();
    for (const dp of dataPoints) {
      const x = dp.time;
      const statusCounts = Object.entries(dp.statusCounts)
        .map(([k, v]) => <[string, number]> [k + " count", v]);
      const pairs = [...statusCounts, ...Object.entries(dp.testErrors)];
      for (const [key, count] of pairs) {
        chartDataSets.setPoint(key, x, count);
      }
      chartDataSets.setPoint("total calls", x, Number(dp.rttHistogram.getTotalCount()), { fill: false });
    }

    const datasets = chartDataSets.getDataSets();
    this.chart = new Chart.Chart(el, {
      type: "line",
      data: { datasets },
      options: {
        scales: {
          yAxes: [{
            ticks: <Chart.TickOptions> {
              precision: 0,
              autoSkip: true
            },
            type: "linear",
            scaleLabel: {
              display: true,
              labelString: "Count"
            }
          }],
          xAxes: [{
            type: "time",
            time: {
              unit: "second"
            },
            ticks: {
              autoSkip: true,
              source: "data"
            }
          }]
        },
        tooltips: {
          callbacks: {
            label: ({ yLabel, datasetIndex }) => {
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
    });
  }

  public updateDataSet (dataPoints: DataPoint[]) {
    const chartDataSets = new ChartDataSets();
    for (const dp of dataPoints) {
      const x = dp.time;
      const statusCounts = Object.entries(dp.statusCounts)
        .map(([k, v]) => <[string, number]> [k + " count", v]);
      const pairs = [...statusCounts, ...Object.entries(dp.testErrors)];
      for (const [key, count] of pairs) {
        chartDataSets.setPoint(key, x, count);
      }
      chartDataSets.setPoint("total calls", x, Number(dp.rttHistogram.getTotalCount()), { fill: false });
    }

    const datasets = chartDataSets.getDataSets();

    this.chart.config.data = { datasets };
    this.chart.update();
  }

  public setYAxisType (type: "logarithmic" | "linear") {
    this.chart.config.options!.scales!.yAxes![0].type = type;
    this.chart.update();
  }

  public getYAxisType (): string {
    return this.chart.config.options!.scales!.yAxes![0].type!;
  }
}

export function totalCalls (el: HTMLCanvasElement, dataPoints: DataPoint[]) {
  const chartDataSets = new ChartDataSets();
  for (const dp of dataPoints) {
    const x = dp.time;
    const statusCounts = Object.entries(dp.statusCounts)
      .map(([k, v]) => <[string, number]> [k + " count", v]);
    const pairs = [...statusCounts, ...Object.entries(dp.testErrors)];
    for (const [key, count] of pairs) {
      chartDataSets.setPoint(key, x, count);
    }
    chartDataSets.setPoint("total calls", x, Number(dp.rttHistogram.getTotalCount()), { fill: false });
  }
  const datasets = chartDataSets.getDataSets();
  const totalChart = new Chart.Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      scales: {
        yAxes: [{
          ticks: <Chart.TickOptions> {
            precision: 0,
            autoSkip: true
          },
          type: "linear",
          scaleLabel: {
            display: true,
            labelString: "Count"
          }
        }],
        xAxes: [{
          type: "time",
          time: {
            unit: "second"
          },
          ticks: {
            autoSkip: true,
            source: "data"
          }
        }]
      },
      tooltips: {
        callbacks: {
          label: ({ yLabel, datasetIndex }) => {
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

  Chart.defaults.global.legend!.onClick = function (e, legend) {
    const chart: Chart = (<any> this).chart;
    const datasets = chart.data.datasets!;
    let allHidden = true;
    for (let i = 0; i < datasets.length; i++) {
      const meta = chart.getDatasetMeta(i);
      if (!meta.hidden && i != legend.datasetIndex) {
        allHidden = false;
        break;
      }
    }
    if (allHidden) {
      lastLegendClick = undefined;
      for (let i = 0; i < datasets.length; i++) {
        const meta = chart.getDatasetMeta(i);
        meta.hidden = false;
      }
      chart.update();
    } else {
      lastLegendClick = [e.timeStamp, legend.datasetIndex!, chart];
      const meta = chart.getDatasetMeta(legend.datasetIndex!);
      meta.hidden = !legend.hidden;
      chart.update();
    }
  };

  window.addEventListener("dblclick", (e) => {
    if (lastLegendClick && e.timeStamp - lastLegendClick[0] < 100) {
      const [, selectedIndex, chart] = lastLegendClick;
      for (let i = 0; i < chart.data.datasets!.length; i++) {
        chart.getDatasetMeta(i).hidden = i != selectedIndex;
      }
      chart.update();
    }
    lastLegendClick = undefined;
  });

}
