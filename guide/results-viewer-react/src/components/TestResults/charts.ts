import {
  Chart,
  ChartDataset,
  ChartEvent,
  ChartTypeRegistry,
  Filler,
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
  Filler,
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

// Splunk-style color palette (matching your dashboard theme)
const colors = [
  "#6a7bb4", // Purple/Blue (like Splunk GET)
  "#c94277", // Pink/Magenta (like Splunk POST)
  "#d9915b", // Orange/Gold (like Splunk Agent)
  "#4d9f9a", // Teal/Cyan (like Splunk Host)
  "#b8904b", // Brown/Gold
  "#7e5ba3", // Deep Purple
  "#d16881", // Coral Pink
  "#8fbc8f", // Green
  "#6495ed", // Cornflower Blue
  "#cd853f", // Peru
  "#ba55d3", // Medium Orchid
  "#20b2aa", // Light Sea Green
  "#ff7f50", // Coral
  "#9370db", // Medium Purple
  "#3cb371", // Medium Sea Green
  "#ff6347", // Tomato
  "#4682b4", // Steel Blue
  "#daa520", // Goldenrod
  "#dc143c", // Crimson
  "#008b8b"  // Dark Cyan
];

export function RTT (el: HTMLCanvasElement, dataPoints: DataPoint[]): Chart {
  const MICROS_TO_MS = 1000;
  const datasets = [
    50,
    95
  ].map((type, i) => {
    const borderColor = colors[i % colors.length];
    const backgroundColor = borderColor + "DD"; // High opacity for visible shading
    let label: string;
    // It's a ScatterDataPoint but thanks to chartjs-adapter-date-fns it will date Dates as well as numbers
    let data: (Omit<ScatterDataPoint, "x"> & { x: Date | number })[];

    if (typeof type === "number") {
      label = "p" + type;
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
      fill: "origin", // Each fills from origin (overlapping, not stacked)
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      order: i
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
      interaction: {
        mode: "nearest",
        intersect: false,
        axis: "x"
      },
      scales: {
        y: {
          type: chartType,
          beginAtZero: true,
          stacked: false,
          title: {
            display: false
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
          title: {
            display: false
          },
          ticks: {
            autoSkip: true
          }
        }
      },
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          mode: "nearest",
          intersect: false,
          callbacks: {
            label: (context) => `${context.dataset.label}: ${context.formattedValue}ms`
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
  public dataSets = new Map<
    string,
    [Map<Date, number>, ChartDataset]
  >();
  public dates = new Set<Date>();

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
      const backgroundColor = borderColor + "CC"; // More opaque shading
      const dataset = { label, data, borderColor, backgroundColor };
      ret.push(Object.assign(datasetParams, dataset));
    }
    return ret;
  }
}

export function requestCountByEndpoint (el: HTMLCanvasElement, allEndpoints: [string, DataPoint[]][]): Chart {
  // Build datasets - each endpoint gets its own area chart (NOT stacked)
  const datasets = allEndpoints.map(([endpointLabel, dataPoints], index) => {
    log(`Processing endpoint: ${endpointLabel}`, LogLevel.DEBUG, { dataPointCount: dataPoints.length });

    const data = dataPoints.map(dp => {
      const count = Number(dp.rttHistogram.getTotalCount());
      log(`  ${endpointLabel} at ${dp.time.toISOString()}: ${count} requests`, LogLevel.DEBUG);
      return {
        x: dp.time,
        y: count
      };
    });

    const borderColor = colors[index % colors.length];
    const backgroundColor = borderColor + "DD"; // High opacity for visible shading

    return {
      label: endpointLabel,
      data,
      borderColor,
      backgroundColor,
      fill: "origin", // Fill from y=0 for stacking
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      order: index // Draw order
    };
  });

  log("Final datasets for overview chart", LogLevel.DEBUG, {
    count: datasets.length,
    datasets: datasets.map(ds => ({
      label: ds.label,
      dataPoints: ds.data.length,
      firstPoint: ds.data[0],
      lastPoint: ds.data[ds.data.length - 1]
    }))
  });

  const totalChart = new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y: {
          type: "linear",
          stacked: true, // STACKED - areas stack on top of each other
          beginAtZero: true,
          ticks: {
            precision: 0,
            autoSkip: true
          },
          title: {
            display: false
          }
        },
        x: {
          type: "time",
          time: {
            unit: "minute"
          },
          title: {
            display: false
          },
          ticks: {
            autoSkip: true
          }
        }
      },
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (context) => {
              // Show the raw value (not the stacked total)
              const rawValue = context.parsed.y;
              return `${context.dataset.label}: ${rawValue.toLocaleString()}`;
            }
          }
        }
      }
    }
  });
  return totalChart as any as Chart;
}

export function totalCalls (el: HTMLCanvasElement, dataPoints: DataPoint[]): Chart {
  const chartDataSets = new ChartDataSets();
  for (const dp of dataPoints) {
    const x = dp.time;
    const statusCounts = Object.entries(dp.statusCounts).map(
      ([k, v]) => [k + " count", v] as [string, number]
    );
    const pairs = [...statusCounts, ...Object.entries(dp.testErrors)];
    for (const [key, count] of pairs) {
      chartDataSets.setPoint(key, x, count, {
        fill: "origin", // Each fills from origin (overlapping)
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0
      });
    }
    chartDataSets.setPoint(
      "total calls",
      x,
      Number(dp.rttHistogram.getTotalCount()),
      {
        fill: "origin",
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0
      }
    );
  }
  const datasets = chartDataSets.getDataSets();
  // https://www.chartjs.org/docs/latest/getting-started/v3-migration.html
  const totalChart = new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      interaction: {
        mode: "nearest",
        intersect: false,
        axis: "x"
      },
      scales: {
        y: {
          type: "linear",
          stacked: false, // Overlapping, not stacked
          beginAtZero: true,
          ticks: {
            precision: 0,
            autoSkip: true
          },
          title: {
            display: false
          }
        },
        x: {
          type: "time",
          time: {
            unit: "second"
          },
          title: {
            display: false
          },
          ticks: {
            autoSkip: true
          }
        }
      },
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          mode: "nearest",
          intersect: false,
          callbacks: {
            label: (context) => {
              const { label } = context.dataset;
              const status = label ? parseInt(label.slice(0, 3), 10) : NaN;
              if (!isNaN(status)) {
                return `${label}: ${context.formattedValue} HTTP ${status}s`;
              } else if (label && label.startsWith("total")) {
                return `${context.formattedValue} ${label.toLowerCase()}`;
              } else {
                return `${label}: ${context.formattedValue}`;
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
    const newLog = Math.max(0, Math.log(tick));
    // If distance between points is greater than min separation, add it to the ticks
    if (newLog - currLog > minLogSeparation) {
      myTicks.push(tick);
      currLog = newLog;
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
