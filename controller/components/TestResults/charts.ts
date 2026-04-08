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
import { LogLevel, log } from "../../src/log";
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

// Splunk-style color palette (matching the polished dashboard theme)
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

// Error chart color palette (orange/pink theme for error graphs)
export const errorColors = [
  "#ff6b6b", // Coral Red
  "#ff8c42", // Orange
  "#ffa07a", // Light Salmon
  "#ff7f50", // Coral
  "#ff4500", // Orange Red
  "#ff69b4", // Hot Pink
  "#ff6347", // Tomato
  "#ff8c94", // Light Coral Pink
  "#ffab91", // Peach
  "#ff9a76", // Salmon
  "#ff7eb3", // Pink
  "#ff9966", // Atomic Tangerine
  "#ff6f91", // Carnation Pink
  "#ff8f5e", // Burnt Sienna
  "#ff7aa2", // Blush Pink
  "#ffa160", // Sandy Brown
  "#ff8cb4", // Cherry Blossom
  "#ff9c7d", // Apricot
  "#ff79a8", // Flamingo
  "#ffb380"  // Macaroni
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
            callback: (v: any) => v + "ms",
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
      ([k, v]) => [k + " count", v] as [string, number]
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

// Quad Panel Charts for polished dashboard
export function medianDurationChart (el: HTMLCanvasElement, allEndpoints: [string, DataPoint[]][]): Chart {
  const MICROS_TO_MS = 1000;
  const datasets = allEndpoints.map(([endpointLabel, dataPoints], index) => {
    const data = dataPoints.map(dp => ({
      x: dp.time,
      y: dp.rttHistogram.getTotalCount()
        ? Number(dp.rttHistogram.getValueAtPercentile(50)) / MICROS_TO_MS
        : NaN
    }));

    const borderColor = colors[index % colors.length];

    return {
      label: endpointLabel,
      data,
      borderColor,
      backgroundColor: borderColor + "80",
      fill: false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHoverBorderWidth: 2
    };
  });

  return new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y: {
          type: "linear",
          beginAtZero: true,
          ticks: {
            callback: (v: any) => v + "ms",
            autoSkip: true,
            maxTicksLimit: 6,
            font: { size: 12 }
          }
        },
        x: {
          type: "time",
          time: {
            unit: "minute",
            displayFormats: {
              minute: "HH:mm"
            }
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
            stepSize: 15,
            font: { size: 12 }
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          position: "nearest",
          yAlign: "top",
          xAlign: "center",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          padding: { top: 12, bottom: 12, left: 14, right: 14 },
          titleFont: { size: 13, weight: "bold" },
          bodyFont: { size: 13 },
          bodySpacing: 8,
          titleSpacing: 6,
          titleMarginBottom: 8,
          caretPadding: 10,
          callbacks: {
            title: (items: any) => {
              if (items.length > 0) {
                const date = new Date(items[0].parsed.x);
                return date.toLocaleString();
              }
              return "";
            },
            label: (context: any) => {
              const value = context.parsed.y.toFixed(2);
              return `${context.dataset.label}: ${value}ms (median)`;
            }
          }
        }
      }
    }
  }) as any as Chart;
}

export function worst5PercentChart (el: HTMLCanvasElement, allEndpoints: [string, DataPoint[]][]): Chart {
  const MICROS_TO_MS = 1000;
  const datasets = allEndpoints.map(([endpointLabel, dataPoints], index) => {
    const data = dataPoints.map(dp => ({
      x: dp.time,
      y: dp.rttHistogram.getTotalCount()
        ? Number(dp.rttHistogram.getValueAtPercentile(95)) / MICROS_TO_MS
        : NaN
    }));

    const borderColor = colors[index % colors.length];

    return {
      label: endpointLabel,
      data,
      borderColor,
      backgroundColor: borderColor + "80",
      fill: false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHoverBorderWidth: 2
    };
  });

  return new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y: {
          type: "linear",
          beginAtZero: true,
          ticks: {
            callback: (v: any) => v + "ms",
            autoSkip: true,
            maxTicksLimit: 6,
            font: { size: 12 }
          }
        },
        x: {
          type: "time",
          time: {
            unit: "minute",
            displayFormats: {
              minute: "HH:mm"
            }
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
            stepSize: 15,
            font: { size: 12 }
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          position: "nearest",
          yAlign: "top",
          xAlign: "center",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          padding: { top: 12, bottom: 12, left: 14, right: 14 },
          titleFont: { size: 13, weight: "bold" },
          bodyFont: { size: 13 },
          bodySpacing: 8,
          titleSpacing: 6,
          titleMarginBottom: 8,
          caretPadding: 10,
          callbacks: {
            title: (items: any) => {
              if (items.length > 0) {
                const date = new Date(items[0].parsed.x);
                return date.toLocaleString();
              }
              return "";
            },
            label: (context: any) => {
              const value = context.parsed.y.toFixed(2);
              return `${context.dataset.label}: ${value}ms (p95)`;
            }
          }
        }
      }
    }
  }) as any as Chart;
}

export function error5xxChart (el: HTMLCanvasElement, allEndpoints: [string, DataPoint[]][]): Chart {
  // Build datasets - one for each status code + endpoint combination
  const datasets: any[] = [];
  let colorIndex = 0;

  for (const [endpointLabel, dataPoints] of allEndpoints) {
    // Collect all unique 5xx status codes for this endpoint
    const statusCodesSet = new Set<string>();
    for (const dp of dataPoints) {
      for (const status of Object.keys(dp.statusCounts)) {
        if (status.startsWith("5")) {
          statusCodesSet.add(status);
        }
      }
    }

    // Create a dataset for each status code
    for (const statusCode of Array.from(statusCodesSet).sort()) {
      const data = dataPoints.map(dp => {
        const count = dp.statusCounts[statusCode] || 0;
        return { x: dp.time, y: count };
      });

      const borderColor = errorColors[colorIndex % errorColors.length];

      datasets.push({
        label: `${statusCode} ${endpointLabel}`,
        data,
        borderColor,
        backgroundColor: borderColor + "DD",
        fill: "origin",
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBorderWidth: 2
      });

      colorIndex++;
    }
  }

  return new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y: {
          type: "linear",
          stacked: true,
          beginAtZero: true,
          ticks: {
            precision: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            font: { size: 12 }
          }
        },
        x: {
          type: "time",
          time: {
            unit: "minute",
            displayFormats: {
              minute: "HH:mm"
            }
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
            stepSize: 15,
            font: { size: 12 }
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          position: "nearest",
          yAlign: "top",
          xAlign: "center",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          padding: { top: 12, bottom: 12, left: 14, right: 14 },
          titleFont: { size: 13, weight: "bold" },
          bodyFont: { size: 13 },
          bodySpacing: 8,
          titleSpacing: 6,
          titleMarginBottom: 8,
          caretPadding: 10,
          callbacks: {
            title: (items: any) => {
              if (items.length > 0) {
                const date = new Date(items[0].parsed.x);
                return date.toLocaleString();
              }
              return "";
            },
            label: (context: any) => {
              return `${context.dataset.label}: ${context.parsed.y}`;
            }
          }
        }
      }
    }
  }) as any as Chart;
}

export function allErrorsChart (el: HTMLCanvasElement, allEndpoints: [string, DataPoint[]][]): Chart {
  // Build datasets - one for each status code + endpoint combination
  const datasets: any[] = [];
  let colorIndex = 0;

  for (const [endpointLabel, dataPoints] of allEndpoints) {
    // Collect all unique non-200 status codes for this endpoint
    const statusCodesSet = new Set<string>();
    for (const dp of dataPoints) {
      for (const status of Object.keys(dp.statusCounts)) {
        if (status !== "200") {
          statusCodesSet.add(status);
        }
      }
    }

    // Create a dataset for each status code
    for (const statusCode of Array.from(statusCodesSet).sort()) {
      const data = dataPoints.map(dp => {
        const count = dp.statusCounts[statusCode] || 0;
        return { x: dp.time, y: count };
      });

      const borderColor = errorColors[colorIndex % errorColors.length];

      datasets.push({
        label: `${statusCode} ${endpointLabel}`,
        data,
        borderColor,
        backgroundColor: borderColor + "DD",
        fill: "origin",
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBorderWidth: 2
      });

      colorIndex++;
    }
  }

  return new Chart(el, {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y: {
          type: "linear",
          stacked: true,
          beginAtZero: true,
          ticks: {
            precision: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            font: { size: 12 }
          }
        },
        x: {
          type: "time",
          time: {
            unit: "minute",
            displayFormats: {
              minute: "HH:mm"
            }
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
            stepSize: 15,
            font: { size: 12 }
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          position: "nearest",
          yAlign: "top",
          xAlign: "center",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          padding: { top: 12, bottom: 12, left: 14, right: 14 },
          titleFont: { size: 13, weight: "bold" },
          bodyFont: { size: 13 },
          bodySpacing: 8,
          titleSpacing: 6,
          titleMarginBottom: 8,
          caretPadding: 10,
          callbacks: {
            title: (items: any) => {
              if (items.length > 0) {
                const date = new Date(items[0].parsed.x);
                return date.toLocaleString();
              }
              return "";
            },
            label: (context: any) => {
              return `${context.dataset.label}: ${context.parsed.y}`;
            }
          }
        }
      }
    }
  }) as any as Chart;
}

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
      log("legendItem.datasetIndex was undefined. Please investigate", LogLevel.WARN, legendItem);
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
