/**
 * TestResultsCompare Component
 *
 * Displays side-by-side performance comparison between two load test results.
 * Features:
 * - Visual chart comparison (4 charts per side: Median Duration, Worst 5%, 5xx Errors, All Errors)
 * - Custom HTML legends outside canvas for proper click handling
 * - Optional endpoint merging for tests with different tags
 * - Responsive two-column grid layout
 */

import { Chart } from "chart.js";
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { LogLevel, formatError, log } from "../../util/log";
import { Danger } from "../Alert";
import { ComparisonResult, compareResults } from "../TestResults/comparison";
import { DataPoint, ParsedFileEntry } from "../TestResults/model";
import { MinMaxTime, comprehensiveSort, minMaxTime, parseResultsData } from "../TestResults/utils";

// ============================================================================
// Styled Components
// ============================================================================

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

const H1 = styled.h1`
  text-align: center;
`;

const H2 = styled.h2`
  text-align: center;
  margin-bottom: 1em;
`;

/** Chart container with fixed height and responsive width */
const QUADPANEL = styled.div`
  position: relative;
  background-color: #2a2a2a;
  border-radius: 4px;
  padding: 1em;
  display: flex;
  flex-direction: column;

  canvas {
    width: 100% !important;
    height: 270px !important;
  }
`;

/** Side-by-side grid layout for baseline vs comparison */
const COMPARISONCHARTSGRID = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 2em;
  margin-bottom: 2em;
`;

/** Each column contains 4 stacked charts */
const CHARTCOLUMN = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2em;
`;

/**
 * Custom HTML legend rendered outside canvas to avoid click interception issues.
 * Uses compact spacing and grey color as per design requirements.
 */
const CUSTOMLEGEND = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 1em;
  padding-top: 1em;
  border-top: 1px solid #444;
  justify-content: center;
`;

/**
 * Individual legend item with click-to-toggle functionality.
 * Opacity reduced when dataset is hidden.
 */
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

/** Merge endpoints toggle container */
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

// ============================================================================
// TypeScript Interfaces
// ============================================================================

export interface TestResultsCompareProps {
  /** Raw results text from baseline test file */
  baselineText: string;
  /** Raw results text from comparison test file */
  comparisonText: string;
  /** Display label for baseline (default: "Baseline") */
  baselineLabel?: string;
  /** Display label for comparison (default: "Comparison") */
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Merges multiple DataPoint arrays by timestamp.
 * Used when "Merge endpoints with different tags" is enabled.
 *
 * @param dataPoints - Variable number of DataPoint arrays to merge
 * @returns Merged and sorted DataPoint array
 */
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

// ============================================================================
// Chart Components
// ============================================================================

/**
 * Median Duration Chart Component
 * Displays median response time trends over time with custom HTML legend.
 */
const ComparisonMedianChart: React.FC<{ displayData: ParsedFileEntry[]; mergeEndpoints: boolean }> = ({ displayData, mergeEndpoints }) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
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
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("../TestResults/charts").then(({ medianDurationChart }) => {
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

/**
 * Worst 5% Duration Chart Component
 * Displays 95th percentile response time trends over time with custom HTML legend.
 */
const ComparisonWorst5Chart: React.FC<{ displayData: ParsedFileEntry[]; mergeEndpoints: boolean }> = ({ displayData, mergeEndpoints }) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
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
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("../TestResults/charts").then(({ worst5PercentChart }) => {
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

/**
 * 5xx Error Count Chart Component
 * Displays server error (500-599) counts over time with custom HTML legend.
 */
const ComparisonError5xxChart: React.FC<{ displayData: ParsedFileEntry[]; mergeEndpoints: boolean }> = ({ displayData, mergeEndpoints }) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
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
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("../TestResults/charts").then(({ error5xxChart }) => {
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

/**
 * All Errors Chart Component
 * Displays all HTTP error status codes (4xx, 5xx) counts over time with custom HTML legend.
 */
const ComparisonAllErrorsChart: React.FC<{ displayData: ParsedFileEntry[]; mergeEndpoints: boolean }> = ({ displayData, mergeEndpoints }) => {
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (chart) {
        chart.destroy();
      }

      let endpointData: [string, DataPoint[]][];

      if (mergeEndpoints) {
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
        endpointData = displayData.map(([bucketId, dataPoints]) => {
          const label = `${bucketId.method} ${bucketId.url}`;
          return [label, dataPoints];
        });
      }

      import("../TestResults/charts").then(({ allErrorsChart }) => {
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

// ============================================================================
// Main Component
// ============================================================================

/**
 * Main TestResultsCompare Component
 * Memoized for performance with large datasets.
 */
export const TestResultsCompare: React.FC<TestResultsCompareProps> = React.memo(({
  baselineText,
  comparisonText,
  baselineLabel = "Baseline",
  comparisonLabel = "Comparison"
}) => {
  // Component state
  const [state, setState] = useState<TestResultsCompareState>({
    baselineData: undefined,
    comparisonData: undefined,
    comparisonResult: undefined,
    baselineMinMaxTime: undefined,
    comparisonMinMaxTime: undefined,
    error: undefined,
    loading: false
  });

  // Merge endpoints toggle state (defaults to false - raw data)
  const [mergeEndpoints, setMergeEndpoints] = useState(false);

  const updateState = (newState: Partial<TestResultsCompareState>) =>
    setState((oldState) => ({ ...oldState, ...newState }));

  // Load date adapter for Chart.js time scales
  useEffect(() => {
    import("chartjs-adapter-date-fns")
    .catch((error) => log("Could not load chartjs-adapter-date-fns import", LogLevel.ERROR, error));
  }, []);

  // Parse and compare results when input text changes
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

      <TOGGLECONTAINER>
        <input
          type="checkbox"
          id="merge-endpoints-compare"
          checked={mergeEndpoints}
          onChange={(e) => setMergeEndpoints(e.target.checked)}
        />
        <label htmlFor="merge-endpoints-compare">
          Merge endpoints with different tags
        </label>
      </TOGGLECONTAINER>

      {state.baselineData && state.comparisonData && (
        <>
          <H1>Performance & Error Metrics Comparison</H1>
          <COMPARISONCHARTSGRID>
            <CHARTCOLUMN>
              <H2>{baselineLabel}</H2>
              <QUADPANEL>
                <h3>Median Duration by Path</h3>
                <ComparisonMedianChart displayData={state.baselineData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
              <QUADPANEL>
                <h3>Worst 5% Duration by Path</h3>
                <ComparisonWorst5Chart displayData={state.baselineData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
              <QUADPANEL>
                <h3>5xx Error Count by Path</h3>
                <ComparisonError5xxChart displayData={state.baselineData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
              <QUADPANEL>
                <h3>All Errors</h3>
                <ComparisonAllErrorsChart displayData={state.baselineData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
            </CHARTCOLUMN>
            <CHARTCOLUMN>
              <H2>{comparisonLabel}</H2>
              <QUADPANEL>
                <h3>Median Duration by Path</h3>
                <ComparisonMedianChart displayData={state.comparisonData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
              <QUADPANEL>
                <h3>Worst 5% Duration by Path</h3>
                <ComparisonWorst5Chart displayData={state.comparisonData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
              <QUADPANEL>
                <h3>5xx Error Count by Path</h3>
                <ComparisonError5xxChart displayData={state.comparisonData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
              <QUADPANEL>
                <h3>All Errors</h3>
                <ComparisonAllErrorsChart displayData={state.comparisonData} mergeEndpoints={mergeEndpoints} />
              </QUADPANEL>
            </CHARTCOLUMN>
          </COMPARISONCHARTSGRID>
        </>
      )}
    </CONTAINER>
  );
});

export default TestResultsCompare;