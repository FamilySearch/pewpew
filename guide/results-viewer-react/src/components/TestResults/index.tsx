import { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { LogLevel, formatError, log } from "../../util/log";
import { MinMaxTime, comprehensiveSort, minMaxTime, parseResultsData } from "./utils";
// Dynamic import for charts to reduce bundle size
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Chart } from "chart.js";
import { Danger } from "../Alert";
import styled from "styled-components";

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

const CANVASBOX = styled.div`
  position: relative;
  width: calc(55vw - 100px);
`;

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
  let summary: string = "";
  if (summaryTagFilter) {
    summary = `Showing only endpoints with a tag of "${summaryTagFilter}"`;
    if (summaryTagValueFilter) {
      summary += ` and a value containing "${summaryTagValueFilter}"`;
    }
  } else {
    summary = "Including all endpoints";
  }
  return summary;
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
  let summary: string = "";
  if (filteredData && filteredData.length > 0) {
    const allDataPoints = [];
    for (const [, dataPoints] of filteredData) {
      allDataPoints.push(...dataPoints);
    }
    const dataPoints = mergeAllDataPoints(...allDataPoints);
    summary = getSummaryDisplay({ summaryTagFilter, summaryTagValueFilter });
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
const MICROS_TO_MS = 1000;

export const TestResults = React.memo(({ resultsText }: TestResultProps) => {

  const [state, setState] = useState(DEFAULT_STATE);

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
          <h1>Request Count by Endpoint</h1>
          <OverviewChart displayData={displayData} />
          <h1>Request Count by Host</h1>
          <HostChart displayData={displayData} />
          <h1>Request Count by Agent</h1>
          <AgentChart displayData={displayData} />
          <h1>Endpoint Data</h1>
          {displayData.map(([bucketId, dataPoints]) => {
            return (
              <Endpoint key={JSON.stringify(bucketId)} bucketId={bucketId} dataPoints={dataPoints} />
            );
          })}
        </TIMETAKEN>
      ) : (
        <h4>{state.defaultMessage}</h4>
      )}
    </React.Fragment>
  );
});

const total = (dataPoints: DataPoint[]) => {
  if (dataPoints.length === 0) { return undefined; }
  let totalRTT;
  try {
  const first: DataPoint = dataPoints[0];
  totalRTT = first.rttHistogram.clone();
  const statusCounts: DataPoint["statusCounts"] = Object.assign(
    {},
    first.statusCounts
  );
  const otherErrors = Object.assign({}, first.testErrors);
  let requestTimeouts = first.requestTimeouts;

  for (let i = 1; i < dataPoints.length; i++) {
    const dp = dataPoints[i];
    totalRTT.add(dp.rttHistogram);
    for (const [status, count] of Object.entries(dp.statusCounts)) {
      statusCounts[status] = count + (statusCounts[status] || 0);
    }
    for (const [msg, count] of Object.entries(dp.testErrors)) {
      otherErrors[msg] = count + (otherErrors[msg] || 0);
    }
    requestTimeouts += dp.requestTimeouts;
  }

  const statusAmount: [string, number, number?][] = Object.entries(
    statusCounts
  ).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
  for (const stat of statusAmount) {
    stat.push(stat[1] / Number(totalRTT.getTotalCount()));
  }

  statusAmount.push(["Sum", Number(totalRTT.getTotalCount()), 1]);

  const otherErrorsArray = Object.entries(otherErrors);

  if (requestTimeouts > 0) {
    otherErrorsArray.push(["Timeout", requestTimeouts]);
  }

  return {
    otherErrors: otherErrorsArray,
    stats: [
      ["p50", Number(totalRTT.getValueAtPercentile(50)) / MICROS_TO_MS],
      ["p95", Number(totalRTT.getValueAtPercentile(95)) / MICROS_TO_MS],
      ["Avg", Math.round(totalRTT.getMean()) / MICROS_TO_MS],
      [
        "Min",
        Math.min(
          Number(totalRTT.getMaxValue()) / MICROS_TO_MS,
          Number(totalRTT.getMinNonZeroValue()) / MICROS_TO_MS
        )
      ],
      ["Max", Number(totalRTT.getMaxValue()) / MICROS_TO_MS],
      ["p90", Number(totalRTT.getValueAtPercentile(90)) / MICROS_TO_MS],
      ["p99", Number(totalRTT.getValueAtPercentile(99)) / MICROS_TO_MS]
    ],
    statusCounts: statusAmount
  };
  } finally {
    // Free memory
    if (totalRTT) {
      totalRTT.free();
    }
  }
};

const OVERVIEWCANVAS = styled.div`
  position: relative;
  width: 85%;
  max-width: 1000px;
  margin: 2em auto;
`;

interface OverviewChartProps {
  displayData: ParsedFileEntry[];
}

const OverviewChart = ({ displayData }: OverviewChartProps) => {
  const [overviewChart, setOverviewChart] = useState<Chart>();

  const overviewCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (overviewChart) {
        overviewChart.destroy();
      }

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

      const endpointData: [string, DataPoint[]][] = Array.from(groupedMap.entries());

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
  }, [displayData]);

  return (
    <OVERVIEWCANVAS>
      <canvas ref={overviewCanvas} />
    </OVERVIEWCANVAS>
  );
};

const HostChart = ({ displayData }: OverviewChartProps) => {
  const [hostChart, setHostChart] = useState<Chart>();

  const hostCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (hostChart) {
        hostChart.destroy();
      }

      // Group endpoints by hostname extracted from URL
      const groupedMap = new Map<string, DataPoint[]>();

      for (const [bucketId, dataPoints] of displayData) {
        // Extract hostname from URL
        let hostname = bucketId.url;
        try {
          const urlObj = new URL(bucketId.url);
          hostname = urlObj.hostname;
        } catch (e) {
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

const AgentChart = ({ displayData }: OverviewChartProps) => {
  const [agentChart, setAgentChart] = useState<Chart>();

  const agentCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (agentChart) {
        agentChart.destroy();
      }

      // Group endpoints by agent/machine
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

const Endpoint = ({ bucketId, dataPoints }: EndpointProps) => {
  const [rttButtonDisplay, setRttButtonDisplay] = useState("");
  const [totalButtonDisplay, setTotalButtonDisplay] = useState("");

  const [rttChart, setRttChart] = useState<Chart>();
  const [totalChart, setTotalChart] = useState<Chart>();

  const totalResults = total(dataPoints);

  const toggleChart = (chart: Chart) => {
    const chartConfig = chart.config.options?.scales?.y;
    if (chartConfig?.type === "linear") {
      chartConfig.type = "logarithmic" as any;
    } else if (chartConfig?.type === "logarithmic") {
      chartConfig.type = "linear" as any;
    }
    setRttButtonDisplay(rttChart
      ? rttChart.config.options?.scales?.y?.type === "linear"
        ? "logarithmic"
        : "linear"
      : ""
    );
    setTotalButtonDisplay(totalChart
      ? totalChart.config.options?.scales?.y?.type === "linear"
        ? "logarithmic"
        : "linear"
      : ""
    );
    chart.update();
  };

  const rttCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (rttChart) {
        // We need to clean up the old one before creating a new one
        rttChart.destroy();
      }
      // Dynamic import to reduce bundle size - handle async inside
      import("./charts").then(({ RTT }) => {
        const currentChart = RTT(node, dataPoints);
        setRttChart(currentChart);
        setRttButtonDisplay(currentChart.config.options?.scales?.y?.type === "linear"
          ? "logarithmic"
          : "linear"
        );
      });
    }
  }, [dataPoints]);

  const totalCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (totalChart) {
        // We need to clean up the old one before creating a new one
        totalChart.destroy();
      }
      // Dynamic import to reduce bundle size - handle async inside
      import("./charts").then(({ totalCalls }) => {
        const currentChart = totalCalls(node, dataPoints);
        setTotalChart(currentChart);
        setTotalButtonDisplay("logarithmic");
      });
    }
  }, [dataPoints]);

  return (
    <React.Fragment>
      <ENDPOINT>
        <H3>
          {bucketId.method} {bucketId.url}
        </H3>
        <UL>
          {Object.entries(bucketId).map(([key, value], idx) => {

            if (key !== "method" && key !== "url") {
              return (
                <li key={idx}>
                  {key} - {value}
                </li>
              );
            }
            return undefined; // fixes typescript error: Not all code paths return a value.
          })}
        </UL>
        <ENDPOINTDIV1>
          <h3>Endpoint Summary</h3>
          {totalResults && <FLEXROW>
            <RTTTABLE>
              <h5>RTT Stats</h5>
              <TABLE>
                <tbody>
                  {totalResults.stats.map(([label, stat], idx) => {
                    return (
                      <TR key={idx}>
                        <TD>{label}</TD>
                        <TD>{stat.toLocaleString()}ms</TD>
                      </TR>
                    );
                  })}
                </tbody>
              </TABLE>
            </RTTTABLE>
            <ENDPOINTDIV1>
              <h5>HTTP Status Counts and Errors</h5>
              <TABLE>
                <tbody>
                  {totalResults.statusCounts.map(
                    ([status, count, percent], idx) => {
                      return (
                        <TR key={idx}>
                          <TD>{status}</TD>
                          <TD>{count.toLocaleString()}</TD>
                          <TD>
                            {percent
                              ? (percent * 100).toFixed(1) + "%"
                              : undefined}
                          </TD>
                        </TR>
                      );
                    }
                  )}
                </tbody>
              </TABLE>
              {totalResults.otherErrors.length > 0 ? (
                <div>
                  <h5>Other Errors</h5>
                  <TABLE>
                    <tbody>
                      {totalResults.otherErrors.map(([msg, count], idx) => {
                        return (
                          <TR key={idx}>
                            <TD title={msg}>{msg}</TD>
                            <TD>{count}</TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </TABLE>
                </div>
              ) : (
                  undefined
                )}
            </ENDPOINTDIV1>
          </FLEXROW>}
        </ENDPOINTDIV1>
        <FLEXROW>
        <RTTDIV>
          <h3>Response Time (p50, p95)</h3>
          <button onClick={() => toggleChart(rttChart!)}>
            Switch to {rttButtonDisplay}
          </button>
          <ENDPOINTDIV2>
            <CANVASBOX>
              <canvas ref={rttCanvas} />
            </CANVASBOX>
          </ENDPOINTDIV2>
        </RTTDIV>
        <ENDPOINTDIV1>
          <h3>Request Count by Status</h3>
          <button onClick={() => toggleChart(totalChart!)}>
            Switch to {totalButtonDisplay}
          </button>
          <ENDPOINTDIV2>
            <CANVASBOX>
              <canvas ref={totalCanvas} />
            </CANVASBOX>
          </ENDPOINTDIV2>
        </ENDPOINTDIV1>
      </FLEXROW>
      </ENDPOINT>
    </React.Fragment>
  );
};

export default TestResults;
