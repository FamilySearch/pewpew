import { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { LogLevel, formatError, log } from "../../util/log";
import { RTT, totalCalls } from "./charts";
import React, { useCallback, useEffect, useState } from "react";
import { Chart } from "chart.js";
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

const RTTDIV = styled.div`
  margin-bottom: 2em;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const ENDPOINTDIV1 = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const ENDPOINTDIV2 = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
`;

const FLEXROW = styled.div`
  display: flex;
  flex-direction: row;
`;

const RTTTABLE = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 400px;
  margin-right: 15px;
`;

const CANVASBOX = styled.div`
  position: relative;
  width: calc(100vw - 100px);
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
  resultsData?: ParsedFileEntry[];
  minMaxTime?: MinMaxTime;
  error?: string;
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
  // eslint-disable-next-line eqeqeq
  const includeDateWithStart = startTime3.toLocaleDateString() == endTime3.toLocaleDateString();
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

export const TestResults = ({ resultsText }: TestResultProps) => {
  const defaultState: TestResultState = {
    resultsData: undefined,
    minMaxTime: undefined,
    error: undefined
  };

  const [state, setState] = useState(defaultState);

  const updateState = (newState: Partial<TestResultState>) =>
    setState((oldState: TestResultState) => ({ ...oldState, ...newState }));

  useEffect(() => {
    updateResultsData(resultsText);
  }, [resultsText]);

  const updateResultsData = async (resultsText: string): Promise<void> => {
    try {
      // if there are multiple jsons (new format), split them up and parse them separately
      const results = resultsText.replace(/}{/g, "}\n{")
        .split("\n")
        .map((s) => JSON.parse(s));
      const model = await import("./model");
      let resultsData: ParsedFileEntry[];
      // Free the old ones
      for (const [bucketId, dataPoints] of state.resultsData || []) {
        let counter = 0;
        for (const dataPoint of dataPoints) {
          log(`Freeing histogram ${JSON.stringify(bucketId)}: ${counter++}`, LogLevel.DEBUG);
          dataPoint.rttHistogram.free();
        }
      }
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

      updateState({
        resultsData,
        error: undefined,
        minMaxTime: startEndTime
      });
    } catch (error) {
      log("Error parsing Data", LogLevel.ERROR, error);
      updateState({
        error: formatError(error)
      });
    }
  };

  return (
    <React.Fragment>
      {state.resultsData !== undefined ? (
        <TIMETAKEN>
          <h1>Time Taken</h1>
          <p>
            {state.minMaxTime?.startTime} to {state.minMaxTime?.endTime}
          </p>
          <p>Total time: {state.minMaxTime?.deltaTime}</p>
          <h1>Results</h1>
          {state.resultsData.map(([bucketId, dataPoints], idx) => {
            return (
              <Endpoint key={idx} bucketId={bucketId} dataPoints={dataPoints} />
            );
          })}
        </TIMETAKEN>
      ) : (
          <h4>{state.error}</h4>
        )}
    </React.Fragment>
  );
};

const total = (dataPoints: DataPoint[]) => {
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
  }, [dataPoints.length]);

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
  }, [dataPoints.length]);

  return (
    <React.Fragment>
      <ENDPOINT>
        <H3>
          {bucketId.method} {bucketId.url}
        </H3>
        <UL>
          {Object.entries(bucketId).map(([key, value], idx) => {
            // eslint-disable-next-line eqeqeq
            if (key != "method" && key != "url") {
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
          <FLEXROW>
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
          </FLEXROW>
        </ENDPOINTDIV1>
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
      </ENDPOINT>
    </React.Fragment>
  );
};

export default TestResults;
