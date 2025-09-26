import { ComparisonData, ComparisonResult, ComparisonValue, compareResults } from "../TestResults/comparison";
import { LogLevel, formatError, log } from "../../util/log";
import React, { useEffect, useState } from "react";
import { Danger } from "../Alert";
import { ParsedFileEntry } from "../TestResults/model";
import styled from "styled-components";

interface MinMaxTime {
  startTime?: string;
  endTime?: string;
  deltaTime?: string;
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

const CONTAINER = styled.div`
  text-align: left;
`;

const COMPARISON_HEADER = styled.div`
  display: flex;
  gap: 2em;
  margin-bottom: 2em;
`;

const COMPARISON_SECTION = styled.div`
  flex: 1;
`;

const COMPARISON_GRID = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 1em;
  margin-bottom: 2em;
`;

const COMPARISON_COLUMN = styled.div`
  display: flex;
  flex-direction: column;
`;

const ENDPOINT = styled.div`
  margin-bottom: 2em;
  padding: 1em;
  border: 1px solid #333;
  border-radius: 4px;
`;

const H1 = styled.h1`
  text-align: center;
`;

const H2 = styled.h2`
  text-align: center;
  margin-bottom: 1em;
`;

const H3 = styled.h3`
  text-align: left;
  word-break: break-all;
  margin-bottom: 0.5em;
`;

const H4 = styled.h4`
  text-align: center;
  margin: 1em 0 0.5em 0;
`;

const TABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: grey;
  width: 100%;
  margin-bottom: 1em;
`;

const TH = styled.th`
  padding: 8px;
  text-align: left;
  background-color: #555;
  font-weight: bold;
  &:not(:first-child) {
    text-align: right;
  }
`;

const TD = styled.td`
  padding: 5px 8px;
  &:not(:first-child) {
    text-align: right;
  }
`;

const TR = styled.tr`
  &:nth-child(even) {
    background: #474747;
  }
`;

const CHANGE_POSITIVE = styled.span`
  color: #ff6b6b;
  font-weight: bold;
`;

const CHANGE_NEGATIVE = styled.span`
  color: #51cf66;
  font-weight: bold;
`;

const CHANGE_NEUTRAL = styled.span`
  color: #868e96;
`;

const UL = styled.ul`
  list-style: none;
  padding-left: 0;
`;

export interface TestResultsCompareProps {
  baselineText: string;
  comparisonText: string;
  baselineLabel?: string;
  comparisonLabel?: string;
}

interface TestResultsCompareState {
  baselineData: ParsedFileEntry[] | undefined;
  comparisonData: ParsedFileEntry[] | undefined;
  comparisonResult: ComparisonResult | undefined;
  baselineMinMaxTime: MinMaxTime | undefined;
  comparisonMinMaxTime: MinMaxTime | undefined;
  error: string | undefined;
  loading: boolean;
}

function formatValue (value: number, unit: string = ""): string {
  return `${value.toLocaleString()}${unit}`;
}

function formatChangeValue (compValue: ComparisonValue, unit: string = ""): React.ReactNode {
  const { diff, percentChange } = compValue;
  const isPositive = diff > 0;
  const isZero = Math.abs(diff) < 0.01 && Math.abs(percentChange) < 0.01;

  if (isZero) {
    return <CHANGE_NEUTRAL>0{unit}</CHANGE_NEUTRAL>;
  }

  const changeText = `${diff > 0 ? "+" : ""}${diff.toLocaleString()}${unit} (${percentChange > 0 ? "+" : ""}${percentChange.toFixed(1)}%)`;

  return isPositive ? (
    <CHANGE_POSITIVE>{changeText}</CHANGE_POSITIVE>
  ) : (
    <CHANGE_NEGATIVE>{changeText}</CHANGE_NEGATIVE>
  );
}

const parseResultsData = async (text: string): Promise<ParsedFileEntry[]> => {
  try {
    const results = text.replace(/}{/g, "}\n{")
      .split("\n")
      .map((s) => JSON.parse(s));
    const model = await import("../TestResults/model");

    const testStartKeys = ["test", "bin", "bucketSize"];
    const isOnlyTestStart: boolean = results.length === 1
      && Object.keys(results[0]).length === testStartKeys.length
      && testStartKeys.every((key) => key in results[0]);

    if (results.length === 1 && !isOnlyTestStart) {
      return model.processJson(results[0]);
    } else {
      return model.processNewJson(results);
    }
  } catch (error) {
    throw new Error(`Failed to parse results: ${error}`);
  }
};

const ComparisonEndpoint: React.FC<{ comparison: ComparisonData }> = ({ comparison }) => {
  const { bucketId, stats, statusCounts, otherErrors } = comparison;

  return (
    <ENDPOINT>
      <H3>{bucketId.method} {bucketId.url}</H3>
      <UL>
        {Object.entries(bucketId).map(([key, value], idx) => {
          if (key !== "method" && key !== "url") {
            return (
              <li key={idx}>
                {key}: {value}
              </li>
            );
          }
          return null;
        })}
      </UL>

      <H4>RTT Statistics Comparison</H4>
      <TABLE>
        <thead>
          <TR>
            <TH>Metric</TH>
            <TH>Baseline</TH>
            <TH>Comparison</TH>
            <TH>Change</TH>
          </TR>
        </thead>
        <tbody>
          <TR>
            <TD>Avg</TD>
            <TD>{formatValue(stats.avg.baseline, "ms")}</TD>
            <TD>{formatValue(stats.avg.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.avg, "ms")}</TD>
          </TR>
          <TR>
            <TD>Min</TD>
            <TD>{formatValue(stats.min.baseline, "ms")}</TD>
            <TD>{formatValue(stats.min.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.min, "ms")}</TD>
          </TR>
          <TR>
            <TD>Max</TD>
            <TD>{formatValue(stats.max.baseline, "ms")}</TD>
            <TD>{formatValue(stats.max.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.max, "ms")}</TD>
          </TR>
          <TR>
            <TD>Std Dev</TD>
            <TD>{formatValue(stats.stdDev.baseline, "ms")}</TD>
            <TD>{formatValue(stats.stdDev.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.stdDev, "ms")}</TD>
          </TR>
          <TR>
            <TD>90th PCTL</TD>
            <TD>{formatValue(stats.p90.baseline, "ms")}</TD>
            <TD>{formatValue(stats.p90.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.p90, "ms")}</TD>
          </TR>
          <TR>
            <TD>95th PCTL</TD>
            <TD>{formatValue(stats.p95.baseline, "ms")}</TD>
            <TD>{formatValue(stats.p95.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.p95, "ms")}</TD>
          </TR>
          <TR>
            <TD>99th PCTL</TD>
            <TD>{formatValue(stats.p99.baseline, "ms")}</TD>
            <TD>{formatValue(stats.p99.comparison, "ms")}</TD>
            <TD>{formatChangeValue(stats.p99, "ms")}</TD>
          </TR>
        </tbody>
      </TABLE>

      <H4>HTTP Status Counts Comparison</H4>
      <TABLE>
        <thead>
          <TR>
            <TH>Status</TH>
            <TH>Baseline</TH>
            <TH>Comparison</TH>
            <TH>Change</TH>
          </TR>
        </thead>
        <tbody>
          {Object.entries(statusCounts)
            .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
            .map(([status, counts]) => (
              <TR key={status}>
                <TD>{status}</TD>
                <TD>{formatValue(counts.baseline)}</TD>
                <TD>{formatValue(counts.comparison)}</TD>
                <TD>{formatChangeValue(counts)}</TD>
              </TR>
            ))}
        </tbody>
      </TABLE>

      {(otherErrors.baseline.length > 0 || otherErrors.comparison.length > 0) && (
        <>
          <H4>Other Errors</H4>
          <COMPARISON_GRID>
            <COMPARISON_COLUMN>
              <strong>Baseline</strong>
              {otherErrors.baseline.length > 0 ? (
                <TABLE>
                  <tbody>
                    {otherErrors.baseline.map(([msg, count], baselineIdx) => (
                      <TR key={baselineIdx}>
                        <TD title={msg}>{msg}</TD>
                        <TD>{count}</TD>
                      </TR>
                    ))}
                  </tbody>
                </TABLE>
              ) : (
                <div>No errors</div>
              )}
            </COMPARISON_COLUMN>
            <COMPARISON_COLUMN>
              <strong>Comparison</strong>
              {otherErrors.comparison.length > 0 ? (
                <TABLE>
                  <tbody>
                    {otherErrors.comparison.map(([msg, count], comparisonIdx) => (
                      <TR key={comparisonIdx}>
                        <TD title={msg}>{msg}</TD>
                        <TD>{count}</TD>
                      </TR>
                    ))}
                  </tbody>
                </TABLE>
              ) : (
                <div>No errors</div>
              )}
            </COMPARISON_COLUMN>
          </COMPARISON_GRID>
        </>
      )}
    </ENDPOINT>
  );
};

export const TestResultsCompare: React.FC<TestResultsCompareProps> = ({
  baselineText,
  comparisonText,
  baselineLabel = "Baseline",
  comparisonLabel = "Comparison"
}) => {
  const [state, setState] = useState<TestResultsCompareState>({
    baselineData: undefined,
    comparisonData: undefined,
    comparisonResult: undefined,
    baselineMinMaxTime: undefined,
    comparisonMinMaxTime: undefined,
    error: undefined,
    loading: false
  });

  const updateState = (newState: Partial<TestResultsCompareState>) =>
    setState((oldState) => ({ ...oldState, ...newState }));

  useEffect(() => {
    const loadData = async () => {
      if (!baselineText || !comparisonText) {
        updateState({
          baselineData: undefined,
          comparisonData: undefined,
          comparisonResult: undefined,
          baselineMinMaxTime: undefined,
          comparisonMinMaxTime: undefined,
          error: undefined,
          loading: false
        });
        return;
      }

      updateState({ loading: true, error: undefined });

      try {
        const [unsortedBaselineData, unsortedComparisonData] = await Promise.all([
          parseResultsData(baselineText),
          parseResultsData(comparisonText)
        ]);

        const baselineData = unsortedBaselineData.sort(([a], [b]) => {
          const aId = parseInt(a._id, 10);
          const bId = parseInt(b._id, 10);
          if (aId === bId) {
            // Sort alphabetically a vs. b
            return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
          }
          return aId - bId;
        });

        const comparisonData = unsortedComparisonData.sort(([a], [b]) => {
          const aId = parseInt(a._id, 10);
          const bId = parseInt(b._id, 10);
          if (aId === bId) {
            // Sort alphabetically a vs. b
            return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
          }
          return aId - bId;
        });

        // Calculate timing information
        const baselineMinMaxTime = minMaxTime(baselineData);
        const comparisonMinMaxTime = minMaxTime(comparisonData);

        const comparisonResult = compareResults(baselineData, comparisonData);

        // Sort the comparison results by _id
        comparisonResult.matchedEndpoints.sort((a, b) => {
          const aId = parseInt(a.bucketId._id, 10);
          const bId = parseInt(b.bucketId._id, 10);
          if (aId === bId) {
            // Sort alphabetically a vs. b
            return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
          }
          return aId - bId;
        });

        comparisonResult.baselineOnly.sort(([a], [b]) => {
          const aId = parseInt(a._id, 10);
          const bId = parseInt(b._id, 10);
          if (aId === bId) {
            // Sort alphabetically a vs. b
            return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
          }
          return aId - bId;
        });

        comparisonResult.comparisonOnly.sort(([a], [b]) => {
          const aId = parseInt(a._id, 10);
          const bId = parseInt(b._id, 10);
          if (aId === bId) {
            // Sort alphabetically a vs. b
            return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
          }
          return aId - bId;
        });

        updateState({
          baselineData,
          comparisonData,
          comparisonResult,
          baselineMinMaxTime,
          comparisonMinMaxTime,
          error: undefined,
          loading: false
        });

        log("TestResultsCompare loaded", LogLevel.DEBUG, {
          baselineEndpoints: baselineData.length,
          comparisonEndpoints: comparisonData.length,
          matchedEndpoints: comparisonResult.matchedEndpoints.length,
          baselineOnly: comparisonResult.baselineOnly.length,
          comparisonOnly: comparisonResult.comparisonOnly.length
        });
      } catch (error) {
        log("TestResultsCompare error", LogLevel.ERROR, error);
        updateState({
          error: formatError(error),
          loading: false
        });
      }
    };

    loadData();
  }, [baselineText, comparisonText]);

  if (state.loading) {
    return <H1>Loading comparison...</H1>;
  }

  if (state.error) {
    return <Danger>{state.error}</Danger>;
  }

  if (!state.comparisonResult) {
    return <H1>Select two results files to compare</H1>;
  }

  const { matchedEndpoints, baselineOnly, comparisonOnly } = state.comparisonResult;

  return (
    <CONTAINER>
      <COMPARISON_HEADER>
        <COMPARISON_SECTION>
          <H2>{baselineLabel}</H2>
          <p>{state.baselineData?.length || 0} endpoints</p>
          {state.baselineMinMaxTime?.startTime && (
            <p>
              {state.baselineMinMaxTime.startTime} to {state.baselineMinMaxTime.endTime}
            </p>
          )}
          {state.baselineMinMaxTime?.deltaTime && (
            <p>Total time: {state.baselineMinMaxTime.deltaTime}</p>
          )}
        </COMPARISON_SECTION>
        <COMPARISON_SECTION>
          <H2>{comparisonLabel}</H2>
          <p>{state.comparisonData?.length || 0} endpoints</p>
          {state.comparisonMinMaxTime?.startTime && (
            <p>
              {state.comparisonMinMaxTime.startTime} to {state.comparisonMinMaxTime.endTime}
            </p>
          )}
          {state.comparisonMinMaxTime?.deltaTime && (
            <p>Total time: {state.comparisonMinMaxTime.deltaTime}</p>
          )}
        </COMPARISON_SECTION>
      </COMPARISON_HEADER>

      {matchedEndpoints.length > 0 && (
        <>
          <H1>Matched Endpoints ({matchedEndpoints.length})</H1>
          {matchedEndpoints.map((comparison, idx) => (
            <ComparisonEndpoint key={idx} comparison={comparison} />
          ))}
        </>
      )}

      {baselineOnly.length > 0 && (
        <>
          <H1>Only in {baselineLabel} ({baselineOnly.length})</H1>
          {baselineOnly.map(([bucketId], idx) => (
            <ENDPOINT key={idx}>
              <H3>{bucketId.method} {bucketId.url}</H3>
              <UL>
                {Object.entries(bucketId).map(([key, value], keyIdx) => {
                  if (key !== "method" && key !== "url") {
                    return (
                      <li key={keyIdx}>
                        {key}: {value}
                      </li>
                    );
                  }
                  return null;
                })}
              </UL>
            </ENDPOINT>
          ))}
        </>
      )}

      {comparisonOnly.length > 0 && (
        <>
          <H1>Only in {comparisonLabel} ({comparisonOnly.length})</H1>
          {comparisonOnly.map(([bucketId], idx) => (
            <ENDPOINT key={idx}>
              <H3>{bucketId.method} {bucketId.url}</H3>
              <UL>
                {Object.entries(bucketId).map(([key, value], keyIdx) => {
                  if (key !== "method" && key !== "url") {
                    return (
                      <li key={keyIdx}>
                        {key}: {value}
                      </li>
                    );
                  }
                  return null;
                })}
              </UL>
            </ENDPOINT>
          ))}
        </>
      )}
    </CONTAINER>
  );
};

export default TestResultsCompare;