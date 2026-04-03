import { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { LogLevel, formatError, log } from "../../util/log";
import { MinMaxTime, comprehensiveSort, minMaxTime, parseResultsData } from "./utils";
// Dynamic import for charts to reduce bundle size
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Chart } from "chart.js";
import { Danger } from "../Alert";
import styled from "styled-components";
import * as XLSX from "xlsx";

const TIMETAKEN = styled.div`
  text-align: left;
`;

export const ENDPOINT = styled.div`
  margin-bottom: 1em;
  padding: 0;
`;

export const H3 = styled.h3`
  text-align: left;
  word-break: break-all;
`;

export const ENDPOINTDIV1 = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

export const RTTDIV = styled(ENDPOINTDIV1)`
  margin-bottom: 2em;
`;

export const FLEXROW = styled.div`
  display: flex;
  flex-direction: row;
`;

export const ENDPOINTDIV2 = styled(FLEXROW)`
  align-items: center;
`;

export const RTTTABLE = styled(ENDPOINTDIV1)`
  max-width: 400px;
  margin-right: 15px;
`;

// const CANVASBOX = styled.div`
//   position: relative;
//   width: calc(55vw - 100px);
// `;

export const UL = styled.ul`
  list-style: none;
`;

export const TABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: grey;
`;

export const TD = styled.td`
  max-width: 150px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  padding: 5px;
  &:not(:first-child) {
    padding-left: 2em;
  };
  &:last-child {
    text-align: right;
  };
`;

export const TR = styled.tr`
  &:nth-child(even) {
    background: #474747;
  };
`;

export interface TestResultProps {
  resultsText: string;
}

export interface TestResultState {
  defaultMessage: string;
  /** Filters the results Data by a tag equalling this value. I.e. 'method', 'url', '_id' */
  summaryTagFilter: string;
  /** Filters the results Data by a summaryTagFilter's value containing this value */
  summaryTagValueFilter: string;
  /** All endpoints from the results file */
  resultsData: ParsedFileEntry[] | undefined;
  /** Filtered list based on the values from summaryTagFilter and summaryTagValueFilter */
  filteredData: ParsedFileEntry[] | undefined;
  /** Overall merged stats from all filteredData */
  summaryData: ParsedFileEntry | undefined;
  minMaxTime: MinMaxTime | undefined;
  error: string | undefined;
}


export interface EndpointProps {
  bucketId: BucketId;
  dataPoints: DataPoint[];
}


const freeHistograms = (resultsData: ParsedFileEntry[] | undefined, summaryData: ParsedFileEntry | undefined) => {
  const oldData: ParsedFileEntry[] = [
    ...(resultsData || []),
    ...(summaryData ? [summaryData] : [])
  ];
  log("freeHistograms", LogLevel.DEBUG, { resultsData: resultsData?.length || -1, summaryData: summaryData !== undefined ? 1 : 0 });
  for (const [bucketId, dataPoints] of oldData) {
    let counter = 0;
    for (const dataPoint of dataPoints) {
      try {
        log(`Freeing histogram ${JSON.stringify(bucketId)}: ${counter++}`, LogLevel.DEBUG);
        dataPoint.rttHistogram.free();
      } catch (error) {
        log(`Freeing histogram ${JSON.stringify(bucketId)} failed: ${counter}`, LogLevel.WARN, error);
      }
    }
  }
  log("freeHistograms finished", LogLevel.DEBUG, { resultsData: resultsData?.length || -1, summaryData: summaryData !== undefined ? 1 : 0 });
};

const mergeAllDataPoints = (...dataPoints: DataPoint[]): DataPoint[] => {
  const combinedData = new Map<number, DataPoint>();

  for (const dp of dataPoints) {
    const dp2 = combinedData.get(Number(dp.time));
    if (dp2) {
      dp2.mergeInto(dp);
    } else {
      combinedData.set(Number(dp.time), dp.clone());
    }
  }

  return [...combinedData.values()].sort((a, b) => Number(a.time) - Number(b.time));
};

const getFilteredEndpoints = ({
  resultsData,
  summaryTagFilter,
  summaryTagValueFilter
}: {
  resultsData: ParsedFileEntry[] | undefined,
  summaryTagFilter: string,
  summaryTagValueFilter: string
}): ParsedFileEntry[] | undefined => {
  if (!summaryTagFilter) {
    log("getFilteredEndpoints no filter", LogLevel.DEBUG, { summaryTagFilter });
    return undefined;
  }
  if (resultsData && resultsData.length > 0) {
    const filteredEntries: ParsedFileEntry[] = [];
    for (const [tags, dataPoints] of resultsData) {
      if (summaryTagFilter && tags[summaryTagFilter] && tags[summaryTagFilter].includes(summaryTagValueFilter)
        || !summaryTagFilter) {
        filteredEntries.push([tags, dataPoints]);
      }
    }
    return filteredEntries.length > 0 ? comprehensiveSort(filteredEntries) : undefined;
  }
  return undefined;
};

const getSummaryDisplay = ({
  summaryTagFilter,
  summaryTagValueFilter
}: {
  summaryTagFilter: string,
  summaryTagValueFilter: string
}): string => {
  if (summaryTagFilter) {
    let summary = `Showing only endpoints with a tag of "${summaryTagFilter}"`;
    if (summaryTagValueFilter) {
      summary += ` and a value containing "${summaryTagValueFilter}"`;
    }
    return summary;
  }
  return "Including all endpoints";
};

const getSummaryData = ({
  filteredData,
  summaryTagFilter,
  summaryTagValueFilter
}: {
  filteredData: ParsedFileEntry[] | undefined,
  summaryTagFilter: string,
  summaryTagValueFilter: string
}): ParsedFileEntry | undefined => {
  let summaryData: ParsedFileEntry | undefined;
  if (filteredData && filteredData.length > 0) {
    const allDataPoints = [];
    for (const [, dataPoints] of filteredData) {
      allDataPoints.push(...dataPoints);
    }
    const dataPoints = mergeAllDataPoints(...allDataPoints);
    const summary = getSummaryDisplay({ summaryTagFilter, summaryTagValueFilter });
    const tags = { method: summary, url: "" };
    summaryData = [tags, dataPoints];
  }
  return summaryData;
};

// Constants moved outside component to avoid recreation on every render
const DEFAULT_MESSAGE = "Select Results File";
const DEFAULT_STATE: TestResultState = {
  defaultMessage: DEFAULT_MESSAGE,
  summaryTagFilter: "",
  summaryTagValueFilter: "",
  resultsData: undefined,
  filteredData: undefined,
  summaryData: undefined,
  minMaxTime: undefined,
  error: undefined
};
// const MICROS_TO_MS = 1000;

export const TestResults = React.memo(({ resultsText }: TestResultProps) => {

  const [state, setState] = useState(DEFAULT_STATE);
  const [mergeEndpoints, setMergeEndpoints] = useState(false);

  const updateState = (newState: Partial<TestResultState>) =>
    setState((oldState: TestResultState) => ({ ...oldState, ...newState }));

  const updateResultsData = async (text: string): Promise<void> => {
    updateState({
      defaultMessage: "Results Loading..."
    });
    try {
      // Use shared parsing utility (includes sorting)
      const resultsData = await parseResultsData(text);
      setState((oldState: TestResultState) => {
        // Free the old ones
      freeHistograms(oldState.resultsData, oldState.summaryData);

      const startEndTime: MinMaxTime = minMaxTime(resultsData);
      const { summaryTagFilter, summaryTagValueFilter } = oldState;
      const filteredData = getFilteredEndpoints({ resultsData, summaryTagFilter, summaryTagValueFilter });
      const summaryData = getSummaryData({ filteredData: filteredData || resultsData, summaryTagFilter, summaryTagValueFilter });

      log("updateResultsData", LogLevel.DEBUG, { filteredData: filteredData?.length, resultsData: resultsData?.length, summaryData });
      return {
        ...oldState,
        defaultMessage: DEFAULT_MESSAGE,
        resultsData, // Already sorted by parseResultsData
        filteredData,
        summaryData,
        error: undefined,
        minMaxTime: startEndTime
        };
      });
    } catch (error) {
      log("Error parsing Data", LogLevel.ERROR, error);
      updateState({
        defaultMessage: DEFAULT_MESSAGE,
        error: formatError(error)
      });
    }
  };

  // Commented out for Splunk-style view - can be restored if filtering is needed
  // const onSummaryTagFilterChange = (event: React.ChangeEvent<HTMLInputElement>, stateName: "summaryTagFilter" | "summaryTagValueFilter") => {
  //   const newValue = event.target.value;
  //   const summaryTagFilter = stateName === "summaryTagFilter" ? newValue : state.summaryTagFilter;
  //   const summaryTagValueFilter = stateName === "summaryTagValueFilter" ? newValue : state.summaryTagValueFilter;
  //   const filteredData = getFilteredEndpoints({ resultsData: state.resultsData, summaryTagFilter, summaryTagValueFilter });

  //   const oldFilteredData = state.filteredData;
  //   log("onSummaryTagFilterChange filteredData", LogLevel.DEBUG, { filteredData: filteredData?.length || -1, oldFilteredData: oldFilteredData?.length || -1 });
  //   // Check if it changed
  //   if ((filteredData === undefined && oldFilteredData === undefined)
  //     || ((filteredData !== undefined && oldFilteredData !== undefined)
  //     && filteredData.length === oldFilteredData.length
  //     && filteredData.every(([tags]: ParsedFileEntry, index: number) =>
  //       JSON.stringify(tags) === JSON.stringify(oldFilteredData[index][0])))
  //   ) {
  //     // It hasn't changed
  //     // Update the summary filter display
  //     const { summaryData } = state;
  //     const summary = getSummaryDisplay({ summaryTagFilter, summaryTagValueFilter });
  //     if (summaryData && summaryData[0].method !== summary) {
  //       summaryData[0] = { ...(summaryData[0]), method: summary };
  //     }
  //     updateState({ [stateName]: newValue });
  //     log("filteredData hasn't changed", LogLevel.DEBUG);
  //     return;
  //   }
  //   log("filteredData changed", LogLevel.DEBUG, { oldFilteredData, filteredData });

  //   setState((oldState: TestResultState) => {
  //     // Free the old data (only the summary)
  //     freeHistograms(undefined, oldState.summaryData);
  //     const summaryData = getSummaryData({ filteredData: filteredData || oldState.resultsData, summaryTagFilter, summaryTagValueFilter });
  //     return {
  //       ...oldState,
  //       [stateName]: newValue,
  //       filteredData,
  //       summaryData
  //     };
  //   });
  // };

  useEffect(() => {
    import("chartjs-adapter-date-fns")
    .catch((error) => log("Could not load chartjs-adapter-date-fns import", LogLevel.ERROR, error));
  }, []);

  useEffect(() => {
    updateResultsData(resultsText);
  }, [resultsText]);

  // Memoized display data to avoid unnecessary recalculations
  const displayData = useMemo(() => {
    return state.filteredData || state.resultsData;
  }, [state.filteredData, state.resultsData]);

  // Commented out for Splunk-style view
  // Memoized summary tags calculation
  // const summaryTags: BucketId = useMemo(() => {
  //   return state.summaryData && state.filteredData
  //     ? state.summaryData[0]
  //     : { method: getSummaryDisplay({ summaryTagFilter: "", summaryTagValueFilter: "" }), url: "" };
  // }, [state.summaryData, state.filteredData]);

  log("displayData", LogLevel.DEBUG, { displayData: displayData?.length, filteredData: state.filteredData?.length, resultsData: state.resultsData?.length });
  return (
    <React.Fragment>
      {state.error && <Danger>{state.error}</Danger>}
      {displayData !== undefined ? (
        <TIMETAKEN>
          <h1>Time Taken</h1>
          <p>
            {state.minMaxTime?.startTime} to {state.minMaxTime?.endTime}
          </p>
          <p>Total time: {state.minMaxTime?.deltaTime}</p>

          <TOGGLECONTAINER>
            <input
              type="checkbox"
              id="merge-endpoints"
              checked={mergeEndpoints}
              onChange={(e) => setMergeEndpoints(e.target.checked)}
            />
            <label htmlFor="merge-endpoints">
              Merge endpoints with different tags
            </label>
          </TOGGLECONTAINER>

          <h1>Request Count by Endpoint</h1>
          <OverviewChart displayData={displayData} mergeEndpoints={mergeEndpoints} />
          <h1>Request Count by Host</h1>
          <HostChart displayData={displayData} />
          <h1>Request Count by Agent</h1>
          <AgentChart displayData={displayData} />

          <h1>Performance & Error Metrics</h1>
          <QUADGRID>
            <QUADPANEL>
              <h3>Median Duration by Path</h3>
              <MedianDurationChart displayData={displayData} mergeEndpoints={mergeEndpoints} />
            </QUADPANEL>
            <QUADPANEL>
              <h3>Worst 5% Duration by Path</h3>
              <Worst5PercentChart displayData={displayData} mergeEndpoints={mergeEndpoints} />
            </QUADPANEL>
            <QUADPANEL>
              <h3>5xx Error Count by Path</h3>
              <Error5xxChart displayData={displayData} mergeEndpoints={mergeEndpoints} />
            </QUADPANEL>
            <QUADPANEL>
              <h3>All Errors</h3>
              <AllErrorsChart displayData={displayData} mergeEndpoints={mergeEndpoints} />
            </QUADPANEL>
          </QUADGRID>

          <h1>Final Results</h1>
          <FinalResultsTable displayData={displayData} />
        </TIMETAKEN>
      ) : (
        <h4>{state.defaultMessage}</h4>
      )}
    </React.Fragment>
  );
});

// const total = (dataPoints: DataPoint[]) => {
//   if (dataPoints.length === 0) { return undefined; }
//   let totalRTT;
//   try {
//   const first: DataPoint = dataPoints[0];
//   totalRTT = first.rttHistogram.clone();
//   const statusCounts: DataPoint["statusCounts"] = Object.assign(
//     {},
//     first.statusCounts
//   );
//   const otherErrors = Object.assign({}, first.testErrors);
//   let requestTimeouts = first.requestTimeouts;

//   for (let i = 1; i < dataPoints.length; i++) {
//     const dp = dataPoints[i];
//     totalRTT.add(dp.rttHistogram);
//     for (const [status, count] of Object.entries(dp.statusCounts)) {
//       statusCounts[status] = count + (statusCounts[status] || 0);
//     }
//     for (const [msg, count] of Object.entries(dp.testErrors)) {
//       otherErrors[msg] = count + (otherErrors[msg] || 0);
//     }
//     requestTimeouts += dp.requestTimeouts;
//   }

//   const statusAmount: [string, number, number?][] = Object.entries(
//     statusCounts
//   ).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
//   for (const stat of statusAmount) {
//     stat.push(stat[1] / Number(totalRTT.getTotalCount()));
//   }

//   statusAmount.push(["Sum", Number(totalRTT.getTotalCount()), 1]);

//   const otherErrorsArray = Object.entries(otherErrors);

//   if (requestTimeouts > 0) {
//     otherErrorsArray.push(["Timeout", requestTimeouts]);
//   }

//   return {
//     otherErrors: otherErrorsArray,
//     stats: [
//       ["p50", Number(totalRTT.getValueAtPercentile(50)) / MICROS_TO_MS],
//       ["p95", Number(totalRTT.getValueAtPercentile(95)) / MICROS_TO_MS],
//       ["Avg", Math.round(totalRTT.getMean()) / MICROS_TO_MS],
//       [
//         "Min",
//         Math.min(
//           Number(totalRTT.getMaxValue()) / MICROS_TO_MS,
//           Number(totalRTT.getMinNonZeroValue()) / MICROS_TO_MS
//         )
//       ],
//       ["Max", Number(totalRTT.getMaxValue()) / MICROS_TO_MS],
//       ["p90", Number(totalRTT.getValueAtPercentile(90)) / MICROS_TO_MS],
//       ["p99", Number(totalRTT.getValueAtPercentile(99)) / MICROS_TO_MS]
//     ],
//     statusCounts: statusAmount
//   };
//   } finally {
//     // Free memory
//     if (totalRTT) {
//       totalRTT.free();
//     }
//   }
// };

const OVERVIEWCANVAS = styled.div`
  position: relative;
  width: 85%;
  max-width: 1000px;
  margin: 2em auto;

  canvas {
    max-height: 300px !important;
  }
`;

const QUADGRID = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 2em;
  width: 95%;
  max-width: 1400px;
  margin: 2em auto;
`;

const QUADPANEL = styled.div`
  position: relative;
  background-color: #2a2a2a;
  border-radius: 4px;
  padding: 1em;
  display: flex;
  flex-direction: column;

  h3 {
    color: white;
    font-size: 0.9em;
    margin: 0 0 1em 0;
    text-align: left;
  }

  canvas {
    width: 100% !important;
    height: 270px !important;
  }
`;

const CUSTOMLEGEND = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 1em;
  padding-top: 1em;
  border-top: 1px solid #444;
  justify-content: center;
`;

const LEGENDITEM = styled.div<{ $hidden?: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.5em;
  cursor: pointer;
  opacity: ${props => props.$hidden ? 0.3 : 1};
  user-select: none;
  font-size: 11px;
  color: #999;

  &:hover {
    opacity: ${props => props.$hidden ? 0.5 : 0.8};
  }

  span.color-box {
    width: 20px;
    height: 12px;
    border-radius: 2px;
  }
`;

const TOGGLECONTAINER = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin: 1em 0 2em 0;
  padding: 1em;
  background-color: #2a2a2a;
  border-radius: 4px;
  width: fit-content;

  label {
    color: white;
    cursor: pointer;
    user-select: none;
  }

  input[type="checkbox"] {
    cursor: pointer;
    width: 18px;
    height: 18px;
  }
`;

interface OverviewChartProps {
  displayData: ParsedFileEntry[];
  mergeEndpoints: boolean;
}

interface TableProps {
  displayData: ParsedFileEntry[];
}

const OverviewChart = ({ displayData, mergeEndpoints }: OverviewChartProps) => {
  const [overviewChart, setOverviewChart] = useState<Chart>();

  const overviewCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (overviewChart) {
        overviewChart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
        // Group endpoints by method+url, merging data points at same timestamps
        const groupedMap = new Map<string, DataPoint[]>();

        for (const [bucketId, dataPoints] of displayData) {
          const label = `${bucketId.method} ${bucketId.url}`;
          log(`Endpoint found: ${label}`, LogLevel.DEBUG, {
            bucketId,
            dataPointCount: dataPoints.length
          });

          if (groupedMap.has(label)) {
            // Merge data points with existing entry (combining counts at same timestamps)
            const existing = groupedMap.get(label)!;
            const merged = mergeAllDataPoints(...existing, ...dataPoints);
            groupedMap.set(label, merged);
            log(`  -> Merged with existing ${label}`, LogLevel.DEBUG);
          } else {
            groupedMap.set(label, dataPoints);
          }
        }

        endpointData = Array.from(groupedMap.entries());
      } else {
        // Use raw data without merging
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      log("Overview chart endpoints (after grouping)", LogLevel.DEBUG, {
        originalCount: displayData.length,
        groupedCount: endpointData.length,
        labels: endpointData.map(([label]) => label)
      });

      import("./charts").then(({ requestCountByEndpoint }) => {
        const currentChart = requestCountByEndpoint(node, endpointData);
        setOverviewChart(currentChart);
      });
    }
  }, [displayData, mergeEndpoints]);

  return (
    <OVERVIEWCANVAS>
      <canvas ref={overviewCanvas} />
    </OVERVIEWCANVAS>
  );
};

const HostChart = ({ displayData }: TableProps) => {
  const [hostChart, setHostChart] = useState<Chart>();

  const hostCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (hostChart) {
        hostChart.destroy();
      }

      // Always group endpoints by hostname extracted from URL (always merged)
      const groupedMap = new Map<string, DataPoint[]>();

      for (const [bucketId, dataPoints] of displayData) {
        // Extract hostname from URL
        let hostname = bucketId.url;
        try {
          const urlObj = new URL(bucketId.url);
          hostname = urlObj.hostname;
        } catch {
          // If URL parsing fails, use the URL as-is
        }

        log(`Host found: ${hostname}`, LogLevel.DEBUG, {
          originalUrl: bucketId.url,
          dataPointCount: dataPoints.length
        });

        if (groupedMap.has(hostname)) {
          // Merge data points with existing entry
          const existing = groupedMap.get(hostname)!;
          const merged = mergeAllDataPoints(...existing, ...dataPoints);
          groupedMap.set(hostname, merged);
          log(`  -> Merged with existing ${hostname}`, LogLevel.DEBUG);
        } else {
          groupedMap.set(hostname, dataPoints);
        }
      }

      const hostData: [string, DataPoint[]][] = Array.from(groupedMap.entries());

      log("Host chart (after grouping)", LogLevel.DEBUG, {
        originalCount: displayData.length,
        groupedCount: hostData.length,
        hosts: hostData.map(([label]) => label)
      });

      import("./charts").then(({ requestCountByEndpoint, hostColors }) => {
        const currentChart = requestCountByEndpoint(node, hostData, hostColors);
        setHostChart(currentChart);
      });
    }
  }, [displayData]);

  return (
    <OVERVIEWCANVAS>
      <canvas ref={hostCanvas} />
    </OVERVIEWCANVAS>
  );
};

const AgentChart = ({ displayData }: TableProps) => {
  const [agentChart, setAgentChart] = useState<Chart>();

  const agentCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (agentChart) {
        agentChart.destroy();
      }

      // Always group endpoints by agent/machine (always merged)
      const groupedMap = new Map<string, DataPoint[]>();

      for (const [bucketId, dataPoints] of displayData) {
        // Look for agent information in tags (common fields: agent, host, machine, source)
        let agent = "Unknown Agent";

        // Check for agent-related fields in bucketId tags
        if (bucketId.agent) {
          agent = bucketId.agent;
        } else if (bucketId.host) {
          agent = bucketId.host;
        } else if (bucketId.machine) {
          agent = bucketId.machine;
        } else if (bucketId.source) {
          agent = bucketId.source;
        } else {
          // If no agent field, use "All Agents" as a fallback
          agent = "All Agents";
        }

        log(`Agent found: ${agent}`, LogLevel.DEBUG, {
          bucketId,
          dataPointCount: dataPoints.length
        });

        if (groupedMap.has(agent)) {
          // Merge data points with existing entry
          const existing = groupedMap.get(agent)!;
          const merged = mergeAllDataPoints(...existing, ...dataPoints);
          groupedMap.set(agent, merged);
          log(`  -> Merged with existing ${agent}`, LogLevel.DEBUG);
        } else {
          groupedMap.set(agent, dataPoints);
        }
      }

      const agentData: [string, DataPoint[]][] = Array.from(groupedMap.entries());

      log("Agent chart (after grouping)", LogLevel.DEBUG, {
        originalCount: displayData.length,
        groupedCount: agentData.length,
        agents: agentData.map(([label]) => label)
      });

      import("./charts").then(({ requestCountByEndpoint, agentColors }) => {
        const currentChart = requestCountByEndpoint(node, agentData, agentColors);
        setAgentChart(currentChart);
      });
    }
  }, [displayData]);

  return (
    <OVERVIEWCANVAS>
      <canvas ref={agentCanvas} />
    </OVERVIEWCANVAS>
  );
};

// Quad Panel Charts
const MedianDurationChart = ({ displayData, mergeEndpoints }: OverviewChartProps) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
        // Group by method+url and show p50 (median) response time
        const groupedMap = new Map<string, DataPoint[]>();

        for (const [bucketId, dataPoints] of displayData) {
          const label = `${bucketId.method} ${bucketId.url}`;
          if (groupedMap.has(label)) {
            const existing = groupedMap.get(label)!;
            const merged = mergeAllDataPoints(...existing, ...dataPoints);
            groupedMap.set(label, merged);
          } else {
            groupedMap.set(label, dataPoints);
          }
        }

        endpointData = Array.from(groupedMap.entries());
      } else {
        // Use raw data without merging
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("./charts").then(({ medianDurationChart }) => {
        const currentChart = medianDurationChart(node, endpointData);
        setChart(currentChart);
        setHiddenDatasets(new Set());
      });
    }
  }, [displayData, mergeEndpoints]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();

      setHiddenDatasets(prev => {
        const newSet = new Set(prev);
        if (meta.hidden) {
          newSet.add(index);
        } else {
          newSet.delete(index);
        }
        return newSet;
      });
    }
  };

  return (
    <>
      <canvas ref={canvasRef} />
      {chart && chart.data.datasets && (
        <CUSTOMLEGEND>
          {chart.data.datasets.map((dataset, index) => (
            <LEGENDITEM
              key={index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => toggleDataset(index)}
            >
              <span
                className="color-box"
                style={{ backgroundColor: dataset.borderColor as string }}
              />
              <span>{dataset.label}</span>
            </LEGENDITEM>
          ))}
        </CUSTOMLEGEND>
      )}
    </>
  );
};

const Worst5PercentChart = ({ displayData, mergeEndpoints }: OverviewChartProps) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
        // Group by method+url and show p95 (worst 5%) response time
        const groupedMap = new Map<string, DataPoint[]>();

        for (const [bucketId, dataPoints] of displayData) {
          const label = `${bucketId.method} ${bucketId.url}`;
          if (groupedMap.has(label)) {
            const existing = groupedMap.get(label)!;
            const merged = mergeAllDataPoints(...existing, ...dataPoints);
            groupedMap.set(label, merged);
          } else {
            groupedMap.set(label, dataPoints);
          }
        }

        endpointData = Array.from(groupedMap.entries());
      } else {
        // Use raw data without merging
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("./charts").then(({ worst5PercentChart }) => {
        const currentChart = worst5PercentChart(node, endpointData);
        setChart(currentChart);
        setHiddenDatasets(new Set());
      });
    }
  }, [displayData, mergeEndpoints]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();

      setHiddenDatasets(prev => {
        const newSet = new Set(prev);
        if (meta.hidden) {
          newSet.add(index);
        } else {
          newSet.delete(index);
        }
        return newSet;
      });
    }
  };

  return (
    <>
      <canvas ref={canvasRef} />
      {chart && chart.data.datasets && (
        <CUSTOMLEGEND>
          {chart.data.datasets.map((dataset, index) => (
            <LEGENDITEM
              key={index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => toggleDataset(index)}
            >
              <span
                className="color-box"
                style={{ backgroundColor: dataset.borderColor as string }}
              />
              <span>{dataset.label}</span>
            </LEGENDITEM>
          ))}
        </CUSTOMLEGEND>
      )}
    </>
  );
};

const Error5xxChart = ({ displayData, mergeEndpoints }: OverviewChartProps) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
        // Group by method+url and show 5xx error counts
        const groupedMap = new Map<string, DataPoint[]>();

        for (const [bucketId, dataPoints] of displayData) {
          const label = `${bucketId.method} ${bucketId.url}`;
          if (groupedMap.has(label)) {
            const existing = groupedMap.get(label)!;
            const merged = mergeAllDataPoints(...existing, ...dataPoints);
            groupedMap.set(label, merged);
          } else {
            groupedMap.set(label, dataPoints);
          }
        }

        endpointData = Array.from(groupedMap.entries());
      } else {
        // Use raw data without merging
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("./charts").then(({ error5xxChart }) => {
        const currentChart = error5xxChart(node, endpointData);
        setChart(currentChart);
        setHiddenDatasets(new Set());
      });
    }
  }, [displayData, mergeEndpoints]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();

      setHiddenDatasets(prev => {
        const newSet = new Set(prev);
        if (meta.hidden) {
          newSet.add(index);
        } else {
          newSet.delete(index);
        }
        return newSet;
      });
    }
  };

  return (
    <>
      <canvas ref={canvasRef} />
      {chart && chart.data.datasets && (
        <CUSTOMLEGEND>
          {chart.data.datasets.map((dataset, index) => (
            <LEGENDITEM
              key={index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => toggleDataset(index)}
            >
              <span
                className="color-box"
                style={{ backgroundColor: dataset.borderColor as string }}
              />
              <span>{dataset.label}</span>
            </LEGENDITEM>
          ))}
        </CUSTOMLEGEND>
      )}
    </>
  );
};

const AllErrorsChart = ({ displayData, mergeEndpoints }: OverviewChartProps) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
        // Group by method+url and show all non-200 status codes
        const groupedMap = new Map<string, DataPoint[]>();

        for (const [bucketId, dataPoints] of displayData) {
          const label = `${bucketId.method} ${bucketId.url}`;
          if (groupedMap.has(label)) {
            const existing = groupedMap.get(label)!;
            const merged = mergeAllDataPoints(...existing, ...dataPoints);
            groupedMap.set(label, merged);
          } else {
            groupedMap.set(label, dataPoints);
          }
        }

        endpointData = Array.from(groupedMap.entries());
      } else {
        // Use raw data without merging
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("./charts").then(({ allErrorsChart }) => {
        const currentChart = allErrorsChart(node, endpointData);
        setChart(currentChart);
        setHiddenDatasets(new Set());
      });
    }
  }, [displayData, mergeEndpoints]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();

      setHiddenDatasets(prev => {
        const newSet = new Set(prev);
        if (meta.hidden) {
          newSet.add(index);
        } else {
          newSet.delete(index);
        }
        return newSet;
      });
    }
  };

  return (
    <>
      <canvas ref={canvasRef} />
      {chart && chart.data.datasets && (
        <CUSTOMLEGEND>
          {chart.data.datasets.map((dataset, index) => (
            <LEGENDITEM
              key={index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => toggleDataset(index)}
            >
              <span
                className="color-box"
                style={{ backgroundColor: dataset.borderColor as string }}
              />
              <span>{dataset.label}</span>
            </LEGENDITEM>
          ))}
        </CUSTOMLEGEND>
      )}
    </>
  );
};

// Table styled components
const TABLECONTAINER = styled.div`
  width: 100%;
  overflow-x: auto;
  margin: 2em 0;
`;

const DATATABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: #2a2a2a;
  width: 100%;
  border-collapse: collapse;
`;

const TH = styled.th`
  padding: 8px 12px;
  text-align: left;
  background-color: #1a1a1a;
  border-bottom: 2px solid #444;
  font-weight: bold;
  white-space: normal;
  word-break: break-word;
  position: sticky;
  top: 0;
  z-index: 10;
`;

const DATATD = styled.td`
  padding: 6px 12px;
  border-bottom: 1px solid #444;
  white-space: normal;
  word-break: break-word;
  max-width: 200px;
  line-height: 1.4;
  vertical-align: top;
`;

const DATATR = styled.tr`
  &:nth-child(even) {
    background: #333;
  }
  &:hover {
    background: #404040;
  }
`;

const DOWNLOADBUTTON = styled.button`
  background-color: #4CAF50;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  margin-bottom: 1em;
  transition: background-color 0.3s;

  &:hover {
    background-color: #45a049;
  }

  &:active {
    background-color: #3d8b40;
  }
`;

// Final Results Table Component
const FinalResultsTable = ({ displayData }: TableProps) => {
  const tableData = useMemo(() => {
    const results: any[] = [];

    for (const [bucketId, dataPoints] of displayData) {
      if (dataPoints.length === 0) {continue;}

      // Aggregate all datapoints for this endpoint
      const first = dataPoints[0];
      const totalRTT = first.rttHistogram.clone();
      const statusCounts: Record<string, number> = { ...first.statusCounts };

      for (let i = 1; i < dataPoints.length; i++) {
        const dp = dataPoints[i];
        totalRTT.add(dp.rttHistogram);
        for (const [status, count] of Object.entries(dp.statusCounts)) {
          statusCounts[status] = count + (statusCounts[status] || 0);
        }
      }

      // Calculate statistics
      const callCount = totalRTT.getTotalCount();
      const p50 = callCount ? Number(totalRTT.getValueAtPercentile(50)) / 1000 : 0;
      const p95 = callCount ? Number(totalRTT.getValueAtPercentile(95)) / 1000 : 0;
      const p99 = callCount ? Number(totalRTT.getValueAtPercentile(99)) / 1000 : 0;
      const min = callCount ? Number(totalRTT.getMinNonZeroValue()) / 1000 : 0;
      const max = callCount ? Number(totalRTT.getMaxValue()) / 1000 : 0;
      const stddev = callCount ? Number(totalRTT.getStdDeviation()) / 1000 : 0;

      // Build status count array
      const statusCountsArray: any[] = [];
      for (const [status, count] of Object.entries(statusCounts)) {
        statusCountsArray.push({ status: parseInt(status), count });
      }
      statusCountsArray.sort((a, b) => a.status - b.status);

      // Extract URL parts
      let hostname = "";
      let path = "";
      let queryString = "";
      try {
        const urlObj = new URL(bucketId.url);
        hostname = urlObj.hostname;
        path = urlObj.pathname;
        queryString = urlObj.search.slice(1); // Remove leading '?'
      } catch {
        hostname = bucketId.url;
        path = "";
      }

      results.push({
        method: bucketId.method,
        hostname,
        path,
        queryString,
        tags: JSON.stringify(bucketId),
        statusCounts: statusCountsArray,
        callCount,
        p50,
        p95,
        p99,
        min,
        max,
        stddev,
        time: dataPoints[dataPoints.length - 1].time // Last timestamp
      });
    }

    return results;
  }, [displayData]);

  const exportToExcel = useCallback(() => {
    // Prepare data for Excel export
    const excelData = tableData.map(row => ({
      Method: row.method,
      Hostname: row.hostname,
      Path: row.path,
      QueryString: row.queryString,
      Tags: row.tags,
      StatusCounts: row.statusCounts.map((sc: any) => `${sc.status}: ${sc.count}`).join(", "),
      CallCount: row.callCount,
      P50: row.p50.toFixed(2),
      P95: row.p95.toFixed(2),
      P99: row.p99.toFixed(2),
      Min: row.min.toFixed(2),
      Max: row.max.toFixed(2),
      StdDev: row.stddev.toFixed(2),
      Time: new Date(row.time).toLocaleString()
    }));

    // Create worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Final Results");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `performance-results-${timestamp}.xlsx`;

    // Download file
    XLSX.writeFile(workbook, filename);
  }, [tableData]);

  return (
    <>
      <DOWNLOADBUTTON onClick={exportToExcel}>
        Download as Excel
      </DOWNLOADBUTTON>
      <TABLECONTAINER>
        <DATATABLE>
        <thead>
          <tr>
            <TH>method</TH>
            <TH>hostname</TH>
            <TH>path</TH>
            <TH>queryString</TH>
            <TH>tags</TH>
            <TH>statusCount</TH>
            <TH>callCount</TH>
            <TH>p50</TH>
            <TH>p95</TH>
            <TH>p99</TH>
            <TH>min</TH>
            <TH>max</TH>
            <TH>stddev</TH>
            <TH>_time</TH>
          </tr>
        </thead>
        <tbody>
          {tableData.map((row, idx) => (
            <DATATR key={idx}>
              <DATATD>{row.method}</DATATD>
              <DATATD title={row.hostname}>{row.hostname}</DATATD>
              <DATATD title={row.path}>{row.path}</DATATD>
              <DATATD>{row.queryString}</DATATD>
              <DATATD title={row.tags}>{row.tags}</DATATD>
              <DATATD>
                {row.statusCounts.map((sc: any, i: number) => (
                  <div key={i}>{sc.status}: {sc.count.toLocaleString()}</div>
                ))}
              </DATATD>
              <DATATD>{row.callCount.toLocaleString()}</DATATD>
              <DATATD>{row.p50.toFixed(2)}</DATATD>
              <DATATD>{row.p95.toFixed(2)}</DATATD>
              <DATATD>{row.p99.toFixed(2)}</DATATD>
              <DATATD>{row.min.toFixed(2)}</DATATD>
              <DATATD>{row.max.toFixed(2)}</DATATD>
              <DATATD>{row.stddev.toFixed(2)}</DATATD>
              <DATATD>{row.time.toLocaleString()}</DATATD>
            </DATATR>
          ))}
        </tbody>
      </DATATABLE>
    </TABLECONTAINER>
    </>
  );
};

// const Endpoint = ({ bucketId, dataPoints }: EndpointProps) => {
//   const [rttButtonDisplay, setRttButtonDisplay] = useState("");
//   const [totalButtonDisplay, setTotalButtonDisplay] = useState("");

//   const [rttChart, setRttChart] = useState<Chart>();
//   const [totalChart, setTotalChart] = useState<Chart>();

//   const totalResults = total(dataPoints);

//   const toggleChart = (chart: Chart) => {
//     const chartConfig = chart.config.options?.scales?.y;
//     if (chartConfig?.type === "linear") {
//       chartConfig.type = "logarithmic" as any;
//     } else if (chartConfig?.type === "logarithmic") {
//       chartConfig.type = "linear" as any;
//     }
//     setRttButtonDisplay(rttChart
//       ? rttChart.config.options?.scales?.y?.type === "linear"
//         ? "logarithmic"
//         : "linear"
//       : ""
//     );
//     setTotalButtonDisplay(totalChart
//       ? totalChart.config.options?.scales?.y?.type === "linear"
//         ? "logarithmic"
//         : "linear"
//       : ""
//     );
//     chart.update();
//   };

//   const rttCanvas = useCallback((node: HTMLCanvasElement | null) => {
//     if (node) {
//       if (rttChart) {
//         // We need to clean up the old one before creating a new one
//         rttChart.destroy();
//       }
//       // Dynamic import to reduce bundle size - handle async inside
//       import("./charts").then(({ RTT }) => {
//         const currentChart = RTT(node, dataPoints);
//         setRttChart(currentChart);
//         setRttButtonDisplay(currentChart.config.options?.scales?.y?.type === "linear"
//           ? "logarithmic"
//           : "linear"
//         );
//       });
//     }
//   }, [dataPoints]);

//   const totalCanvas = useCallback((node: HTMLCanvasElement | null) => {
//     if (node) {
//       if (totalChart) {
//         // We need to clean up the old one before creating a new one
//         totalChart.destroy();
//       }
//       // Dynamic import to reduce bundle size - handle async inside
//       import("./charts").then(({ totalCalls }) => {
//         const currentChart = totalCalls(node, dataPoints);
//         setTotalChart(currentChart);
//         setTotalButtonDisplay("logarithmic");
//       });
//     }
//   }, [dataPoints]);

//   return (
//     <React.Fragment>
//       <ENDPOINT>
//         <H3>
//           {bucketId.method} {bucketId.url}
//         </H3>
//         <UL>
//           {Object.entries(bucketId).map(([key, value], idx) => {

//             if (key !== "method" && key !== "url") {
//               return (
//                 <li key={idx}>
//                   {key} - {value}
//                 </li>
//               );
//             }
//             return undefined; // fixes typescript error: Not all code paths return a value.
//           })}
//         </UL>
//         <ENDPOINTDIV1>
//           <h3>Endpoint Summary</h3>
//           {totalResults && <FLEXROW>
//             <RTTTABLE>
//               <h5>RTT Stats</h5>
//               <TABLE>
//                 <tbody>
//                   {totalResults.stats.map(([label, stat], idx) => {
//                     return (
//                       <TR key={idx}>
//                         <TD>{label}</TD>
//                         <TD>{stat.toLocaleString()}ms</TD>
//                       </TR>
//                     );
//                   })}
//                 </tbody>
//               </TABLE>
//             </RTTTABLE>
//             <ENDPOINTDIV1>
//               <h5>HTTP Status Counts and Errors</h5>
//               <TABLE>
//                 <tbody>
//                   {totalResults.statusCounts.map(
//                     ([status, count, percent], idx) => {
//                       return (
//                         <TR key={idx}>
//                           <TD>{status}</TD>
//                           <TD>{count.toLocaleString()}</TD>
//                           <TD>
//                             {percent
//                               ? (percent * 100).toFixed(1) + "%"
//                               : undefined}
//                           </TD>
//                         </TR>
//                       );
//                     }
//                   )}
//                 </tbody>
//               </TABLE>
//               {totalResults.otherErrors.length > 0 ? (
//                 <div>
//                   <h5>Other Errors</h5>
//                   <TABLE>
//                     <tbody>
//                       {totalResults.otherErrors.map(([msg, count], idx) => {
//                         return (
//                           <TR key={idx}>
//                             <TD title={msg}>{msg}</TD>
//                             <TD>{count}</TD>
//                           </TR>
//                         );
//                       })}
//                     </tbody>
//                   </TABLE>
//                 </div>
//               ) : (
//                   undefined
//                 )}
//             </ENDPOINTDIV1>
//           </FLEXROW>}
//         </ENDPOINTDIV1>
//         <FLEXROW>
//         <RTTDIV>
//           <h3>Response Time (p50, p95)</h3>
//           <button onClick={() => toggleChart(rttChart!)}>
//             Switch to {rttButtonDisplay}
//           </button>
//           <ENDPOINTDIV2>
//             <CANVASBOX>
//               <canvas ref={rttCanvas} />
//             </CANVASBOX>
//           </ENDPOINTDIV2>
//         </RTTDIV>
//         <ENDPOINTDIV1>
//           <h3>Request Count by Status</h3>
//           <button onClick={() => toggleChart(totalChart!)}>
//             Switch to {totalButtonDisplay}
//           </button>
//           <ENDPOINTDIV2>
//             <CANVASBOX>
//               <canvas ref={totalCanvas} />
//             </CANVASBOX>
//           </ENDPOINTDIV2>
//         </ENDPOINTDIV1>
//       </FLEXROW>
//       </ENDPOINT>
//     </React.Fragment>
//   );
// };

export default TestResults;
