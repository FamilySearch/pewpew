import { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { LogLevel, formatError, log } from "../../util/log";
import { RTT, totalCalls } from "./charts";
import React, { useCallback, useEffect, useState } from "react";
import { Chart } from "chart.js";
import { Danger } from "../Alert";
import styled from "styled-components";

const TIMETAKEN = styled.div`
  text-align: left;
`;

const ENDPOINT = styled.div`
  margin-bottom: 1em;
  padding: 0;
`;

const H3 = styled.h3`
  text-align: left;
  word-break: break-all;
`;

const ENDPOINTDIV1 = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const RTTDIV = styled(ENDPOINTDIV1)`
  margin-bottom: 2em;
`;

const FLEXROW = styled.div`
  display: flex;
  flex-direction: row;
`;

const ENDPOINTDIV2 = styled(FLEXROW)`
  align-items: center;
`;

const RTTTABLE = styled(ENDPOINTDIV1)`
  max-width: 400px;
  margin-right: 15px;
`;

const CANVASBOX = styled.div`
  position: relative;
  width: calc(55vw - 100px);
`;

const UL = styled.ul`
  list-style: none;
`;

const TABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: grey;
`;

const TD = styled.td`
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

const TR = styled.tr`
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

export interface MinMaxTime {
  startTime?: string;
  endTime?: string;
  deltaTime?: string;
}

export interface EndpointProps {
  bucketId: BucketId;
  dataPoints: DataPoint[];
}

const dateToString = (dateTime: Date, timeOnly: boolean) => {
  let stringDate = dateTime.toLocaleTimeString("en-us", { hour12: false });
  if (!timeOnly) {
    stringDate += ` ${dateTime.getDate()}-${dateTime.toLocaleString("en-us", {
      month: "short"
    })}-${dateTime.getFullYear()}`;
  }
  return stringDate;
};

const minMaxTime = (testResults: any) => {
  const testTimes: MinMaxTime = {
    startTime: undefined,
    endTime: undefined,
    deltaTime: undefined
  };

  let startTime2 = Infinity;
  let endTime2 = -Infinity;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_, dataPoints] of testResults) {
    for (const point of dataPoints) {
      if (point.startTime) {
        startTime2 = Math.min(startTime2, point.startTime);
        break;
      }
    }

    for (let i = dataPoints.length - 1; i >= 0; i--) {
      const point = dataPoints[i];
      if (point.endTime) {
        endTime2 = Math.max(endTime2, point.endTime);
        break;
      }
    }
  }

  const second: number = 1;
  const minute: number = 60;
  const hour: number = minute * 60;
  const day: number = hour * 24;
  let deltaTimeInSeconds: number = (endTime2 - startTime2) / 1000;

  const startTime3: Date = new Date(startTime2);
  const endTime3: Date = new Date(endTime2);
  const includeDateWithStart = startTime3.toLocaleDateString() === endTime3.toLocaleDateString();
  testTimes.startTime = dateToString(startTime3, includeDateWithStart);
  testTimes.endTime = dateToString(endTime3, false);

  const timeUnits: [number, string][] = [
    [day, "day"],
    [hour, "hour"],
    [minute, "minute"],
    [second, "second"]
  ];
  const prettyDurationBuilder = [];
  for (const [unit, name] of timeUnits) {
    const count = Math.floor(deltaTimeInSeconds / unit);
    if (count > 0) {
      deltaTimeInSeconds -= count * unit;
      prettyDurationBuilder.push(`${count} ${name}${count > 1 ? "s" : ""}`);
    }
  }

  testTimes.deltaTime = prettyDurationBuilder.join(", ");

  return testTimes;
};

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
};

const mergeAllDataPoints = (...dataPoints: DataPoint[]): DataPoint[] => {
  const combinedData: Map<number, DataPoint> = new Map();

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
    return resultsData;
  }
  if (resultsData && resultsData.length > 0) {
    const filteredEntries: ParsedFileEntry[] = [];
    for (const [tags, dataPoints] of resultsData) {
      if (summaryTagFilter && tags[summaryTagFilter] && tags[summaryTagFilter].includes(summaryTagValueFilter)
        || !summaryTagFilter) {
        filteredEntries.push([tags, dataPoints]);
      }
    }
    return filteredEntries.length > 0 ? filteredEntries : undefined;
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

export const TestResults = ({ resultsText }: TestResultProps) => {
  const defaultMessage = "Select Results File";
  const defaultState: TestResultState = {
    defaultMessage,
    summaryTagFilter: "",
    summaryTagValueFilter: "",
    resultsData: undefined,
    filteredData: undefined,
    summaryData: undefined,
    minMaxTime: undefined,
    error: undefined
  };

  const [state, setState] = useState(defaultState);

  const updateState = (newState: Partial<TestResultState>) =>
    setState((oldState: TestResultState) => ({ ...oldState, ...newState }));

  const updateResultsData = async (resultsText: string): Promise<void> => {
    updateState({
      defaultMessage: "Results Loading..."
    });
    try {
      // if there are multiple jsons (new format), split them up and parse them separately
      const results = resultsText.replace(/}{/g, "}\n{")
        .split("\n")
        .map((s) => JSON.parse(s));
      const model = await import("./model");
      let resultsData: ParsedFileEntry[];
      // Free the old ones
      freeHistograms(state.resultsData, state.summaryData);
      const testStartKeys = ["test", "bin", "bucketSize"];
      const isOnlyTestStart: boolean = results.length === 1
        && Object.keys(results[0]).length === testStartKeys.length
        && testStartKeys.every((key) => key in results[0]);
      log("isOnlyTestStart", LogLevel.DEBUG, { isOnlyTestStart, results, testStartKeys });
      if (results.length === 1 && !isOnlyTestStart) {
        // old stats format
        resultsData = model.processJson(results[0]);
      } else {
        // new stats format
        resultsData = model.processNewJson(results);
      }
      const startEndTime: MinMaxTime = minMaxTime(resultsData);
      const { summaryTagFilter, summaryTagValueFilter } = state;
      const filteredData = getFilteredEndpoints({ resultsData: state.resultsData, summaryTagFilter, summaryTagValueFilter });
      const summaryData = getSummaryData({ filteredData: filteredData || resultsData, summaryTagFilter, summaryTagValueFilter });

      log("updateResultsData", LogLevel.DEBUG, { filteredData: filteredData?.length, resultsData: resultsData?.length, summaryData });
      updateState({
        defaultMessage,
        resultsData,
        filteredData,
        summaryData,
        error: undefined,
        minMaxTime: startEndTime
      });
    } catch (error) {
      log("Error parsing Data", LogLevel.ERROR, error);
      updateState({
        defaultMessage,
        error: formatError(error)
      });
    }
  };

  const onSummaryTagFilterChange = (event: React.ChangeEvent<HTMLInputElement>, stateName: "summaryTagFilter" | "summaryTagValueFilter") => {
    const newValue = event.target.value;
    const summaryTagFilter = stateName === "summaryTagFilter" ? newValue : state.summaryTagFilter;
    const summaryTagValueFilter = stateName === "summaryTagValueFilter" ? newValue : state.summaryTagValueFilter;
    const filteredData = getFilteredEndpoints({ resultsData: state.resultsData, summaryTagFilter, summaryTagValueFilter });

    const oldFilteredData = state.filteredData;
    log("onSummaryTagFilterChange filteredData", LogLevel.DEBUG, { filteredData: filteredData?.length || -1, oldFilteredData: oldFilteredData?.length || -1 });
    // Check if it changed
    if ((filteredData === undefined && oldFilteredData === undefined)
      || ((filteredData !== undefined && oldFilteredData !== undefined)
      && filteredData.length === oldFilteredData.length
      && filteredData.every(([tags]: ParsedFileEntry, index: number) =>
        JSON.stringify(tags) === JSON.stringify(oldFilteredData[index][0])))
    ) {
      // It hasn't changed
      // Update the summary filter display
      const { summaryData } = state;
      const summary = getSummaryDisplay({ summaryTagFilter, summaryTagValueFilter });
      if (summaryData && summaryData[0].method !== summary) {
        summaryData[0] = { ...(summaryData[0]), method: summary };
      }
      updateState({ [stateName]: newValue });
      log("filteredData hasn't changed", LogLevel.DEBUG);
      return;
    }
    log("filteredData changed", LogLevel.DEBUG, { oldFilteredData, filteredData });

    // Free the old data (only the summary)
    freeHistograms(undefined, state.summaryData);
    const summaryData = getSummaryData({ filteredData, summaryTagFilter, summaryTagValueFilter });
    updateState({
      [stateName]: newValue,
      filteredData,
      summaryData
    });
  };

  useEffect(() => {
    import("chartjs-adapter-date-fns")
    .catch((error) => log("Could not load chartjs-adapter-date-fns import", LogLevel.ERROR, error));
  }, []);

  useEffect(() => {
    updateResultsData(resultsText);
  }, [resultsText]);

  const displayData = state.filteredData || state.resultsData;
  log("displayData", LogLevel.DEBUG, { displayData: displayData?.length, filteredData: state.filteredData?.length, resultsData: state.resultsData?.length });
  // If we're showing all endpoints, fix the summary tags
  const summaryTags: BucketId = state.summaryData && state.filteredData
    ? state.summaryData[0]
    : { method: getSummaryDisplay({ summaryTagFilter: "", summaryTagValueFilter: "" }), url: "" };
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
          <h1>Overview charts</h1>
          <p>Filter which endpoints are included in the summary:</p>
          <label htmlFor="summaryTagFilter">
            <span>Tag name</span>
            <input id="summaryTagFilter" type="text" value={state.summaryTagFilter} placeholder="url"
              onChange={(e) => onSummaryTagFilterChange(e, "summaryTagFilter")}
            />
          </label>
          <label htmlFor="summaryTagValueFilter">
            <span>contains</span>
            <input id="summaryTagValueFilter" type="text" value={state.summaryTagValueFilter} placeholder="familysearch"
              onChange={(e) => onSummaryTagFilterChange(e, "summaryTagValueFilter")}
            />
          </label>
          {state.summaryData
            ? <Endpoint key={"summary"} bucketId={summaryTags} dataPoints={state.summaryData[1]} />
            : <p>No summary data to display</p>
          }
          <h1>Endpoint Data</h1>
          {displayData.map(([bucketId, dataPoints]) => {
            return (
              <Endpoint key={JSON.stringify(bucketId)} bucketId={bucketId} dataPoints={dataPoints} />
            );
          })}
        </TIMETAKEN>
      ) : (
        <p>{state.defaultMessage}</p>
      )}
    </React.Fragment>
  );
};

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

  const statusAmount: Array<[string, number, number?]> = Object.entries(
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
  const MICROS_TO_MS = 1000;

  return {
    otherErrors: otherErrorsArray,
    stats: [
      ["Avg", Math.round(totalRTT.getMean()) / MICROS_TO_MS],
      [
        "Min",
        Math.min(
          Number(totalRTT.getMaxValue()) / MICROS_TO_MS,
          Number(totalRTT.getMinNonZeroValue()) / MICROS_TO_MS
        )
      ],
      ["Max", Number(totalRTT.getMaxValue()) / MICROS_TO_MS],
      ["Std Dev", totalRTT.getStdDeviation() / MICROS_TO_MS],
      ["90th PCTL", Number(totalRTT.getValueAtPercentile(90)) / MICROS_TO_MS],
      ["95th PCTL", Number(totalRTT.getValueAtPercentile(95)) / MICROS_TO_MS],
      ["99th PCTL", Number(totalRTT.getValueAtPercentile(99)) / MICROS_TO_MS]
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

  const rttCanvas = useCallback((node: HTMLCanvasElement) => {
    if (node) {
      if (rttChart) {
        // We need to clean up the old one before creating a new one
        rttChart.destroy();
      }
      const currentChart = RTT(node, dataPoints);
      setRttChart(currentChart);
      setRttButtonDisplay(currentChart.config.options?.scales?.y?.type === "linear"
        ? "logarithmic"
        : "linear"
      );
    }
  }, [dataPoints]);

  const totalCanvas = useCallback((node: HTMLCanvasElement) => {
    if (node) {
      if (totalChart) {
        // We need to clean up the old one before creating a new one
        totalChart.destroy();
      }
      const currentChart = totalCalls(node, dataPoints);
      setTotalChart(currentChart);
      setTotalButtonDisplay("logarithmic");
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
          <h3>RTT Stats</h3>
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
          <h3>HTTP Status Counts and Errors</h3>
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
