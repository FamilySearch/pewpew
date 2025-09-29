import { ComparisonData, ComparisonResult, ComparisonValue, compareResults } from "../TestResults/comparison";
import {
  ENDPOINT,
  ENDPOINTDIV1,
  ENDPOINTDIV2,
  H3,
  UL,
  RTTTABLE as _RTTTABLE
} from "../TestResults";
import { LogLevel, log } from "../../src/log";
import { MinMaxTime, comprehensiveSort, formatValue, minMaxTime, parseResultsData } from "../TestResults/utils";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TABLE, TR, TD as _TD } from "../Table";
import { Danger } from "../Alert";
import { ParsedFileEntry } from "../TestResults/model";
import { formatError } from "../../src/clientutil";
import styled from "styled-components";


const RTTTABLE = styled(_RTTTABLE)`
  max-width: 600px;
`;

const TD = styled(_TD)`
  max-width: 250px;
`;

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

const COMPARISON_GRID = styled(ENDPOINTDIV2)`
  gap: 1em;
  margin-bottom: 2em;
`;

// Comparison-specific styled components
const COMPARISON_ENDPOINT = styled(ENDPOINT)`
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

const H4 = styled.h4`
  text-align: center;
  margin: 1em 0 0.5em 0;
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


const ComparisonEndpoint: React.FC<{
  comparison: ComparisonData;
  formatChangeValue: (compValue: ComparisonValue, unit?: string) => React.ReactNode;
}> = React.memo(({ comparison, formatChangeValue }) => {
  const { bucketId, stats, statusCounts, otherErrors } = comparison;

  return (
    <COMPARISON_ENDPOINT>
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

      <ENDPOINTDIV1>
        <H4>RTT Statistics Comparison</H4>
        <RTTTABLE>
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
        </RTTTABLE>

        <H4>HTTP Status Counts Comparison</H4>
        <RTTTABLE>
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
        </RTTTABLE>
      </ENDPOINTDIV1>

      {(otherErrors.baseline.length > 0 || otherErrors.comparison.length > 0) && (
        <ENDPOINTDIV1>
          <H4>Other Errors</H4>
          <COMPARISON_GRID>
            <ENDPOINTDIV1>
              <strong>Baseline</strong>
              {otherErrors.baseline.length > 0 ? (
                <RTTTABLE>
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
                </RTTTABLE>
              ) : (
                <div>No errors</div>
              )}
            </ENDPOINTDIV1>
            <ENDPOINTDIV1>
              <strong>Comparison</strong>
              {otherErrors.comparison.length > 0 ? (
                <RTTTABLE>
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
                </RTTTABLE>
              ) : (
                <div>No errors</div>
              )}
            </ENDPOINTDIV1>
          </COMPARISON_GRID>
        </ENDPOINTDIV1>
      )}
    </COMPARISON_ENDPOINT>
  );
});

export const TestResultsCompare: React.FC<TestResultsCompareProps> = React.memo(({
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

  // Memoize the destructured comparison result to avoid unnecessary re-renders
  const { matchedEndpoints, baselineOnly, comparisonOnly } = useMemo(() =>
    state.comparisonResult || { matchedEndpoints: [], baselineOnly: [], comparisonOnly: [] },
    [state.comparisonResult]
  );

  // Memoized formatChangeValue function to prevent recalculations
  const formatChangeValue = useCallback((compValue: ComparisonValue, unit: string = ""): React.ReactNode => {
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
  }, []);

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

        const baselineData = comprehensiveSort(unsortedBaselineData);
        const comparisonData = comprehensiveSort(unsortedComparisonData);

        // Calculate timing information
        const baselineMinMaxTime = minMaxTime(baselineData);
        const comparisonMinMaxTime = minMaxTime(comparisonData);

        const comparisonResult = compareResults(baselineData, comparisonData);

        // Sort the comparison results by _id using comprehensiveSort
        comparisonResult.matchedEndpoints.sort((a, b) => {
          const aId = parseInt(a.bucketId._id, 10);
          const bId = parseInt(b.bucketId._id, 10);
          if (aId === bId) {
            return JSON.stringify(a.bucketId) < JSON.stringify(b.bucketId) ? -1 : 1;
          }
          return aId - bId;
        });

        comparisonResult.baselineOnly = comprehensiveSort(comparisonResult.baselineOnly);
        comparisonResult.comparisonOnly = comprehensiveSort(comparisonResult.comparisonOnly);

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
            <ComparisonEndpoint key={idx} comparison={comparison} formatChangeValue={formatChangeValue} />
          ))}
        </>
      )}

      {baselineOnly.length > 0 && (
        <>
          <H1>Only in {baselineLabel} ({baselineOnly.length})</H1>
          {baselineOnly.map(([bucketId], idx) => (
            <COMPARISON_ENDPOINT key={idx}>
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
            </COMPARISON_ENDPOINT>
          ))}
        </>
      )}

      {comparisonOnly.length > 0 && (
        <>
          <H1>Only in {comparisonLabel} ({comparisonOnly.length})</H1>
          {comparisonOnly.map(([bucketId], idx) => (
            <COMPARISON_ENDPOINT key={idx}>
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
            </COMPARISON_ENDPOINT>
          ))}
        </>
      )}
    </CONTAINER>
  );
});

export default TestResultsCompare;