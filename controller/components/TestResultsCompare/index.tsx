/**
 * TestResultsCompare Component (Controller Version)
 *
 * Displays side-by-side performance comparison between two load test results.
 * Features:
 * - Visual chart comparison (4 charts per side)
 * - Custom HTML legends outside canvas
 * - Optional endpoint merging
 * - Side-by-side Final Results tables
 */

/* eslint-disable sort-imports */
import { DataPoint, ParsedFileEntry } from "../TestResults/model";
import { Chart } from "chart.js";
import React, { useCallback, useMemo, useState } from "react";
import styled from "styled-components";
/* eslint-enable sort-imports */

// ============================================================================
// Styled Components
// ============================================================================

const CONTAINER = styled.div`
  text-align: left;
  margin: 2em 0;
`;

const H1 = styled.h1`
  text-align: center;
`;

const H2 = styled.h2`
  text-align: center;
  margin-bottom: 1em;
`;

/** Chart container with fixed height */
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

/** Side-by-side grid layout */
const COMPARISONCHARTSGRID = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 1.5em;
  margin-bottom: 2em;
`;

/** Each column contains stacked charts */
const CHARTCOLUMN = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2em;
  min-width: 0;
  overflow: hidden;
`;

/** Custom HTML legend */
const CUSTOMLEGEND = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 1em;
  padding-top: 1em;
  border-top: 1px solid #444;
  justify-content: center;
`;

/** Individual legend item */
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

/** Merge endpoints toggle */
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

const FILTERCONTAINER = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1em;
  margin: 1em 0 2em 0;
`;

const FILTERDROPDOWN = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 1em;
  background-color: #2a2a2a;
  border-radius: 4px;

  label {
    color: white;
    font-size: 14px;
    white-space: nowrap;
  }

  select {
    padding: 0.4em 0.8em;
    background-color: #1a1a1a;
    color: white;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;

    &:hover {
      border-color: #666;
    }

    &:focus {
      outline: none;
      border-color: #6a7bb4;
    }
  }
`;

/** Compact table for comparison view */
const TABLECONTAINER = styled.div`
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  margin: 1em 0;
`;

const DATATABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: #2a2a2a;
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  font-size: 10px;
  table-layout: fixed;
`;

const TH = styled.th`
  padding: 4px 6px;
  text-align: left;
  background-color: #1a1a1a;
  border-bottom: 2px solid #444;
  font-weight: bold;
  white-space: normal;
  word-break: break-word;
  position: sticky;
  top: 0;
  z-index: 10;
  font-size: 10px;
`;

const DATATD = styled.td`
  padding: 4px 6px;
  border-bottom: 1px solid #444;
  white-space: normal;
  word-break: break-word;
  max-width: 150px;
  font-size: 10px;
  line-height: 1.3;
`;

const DATATR = styled.tr`
  &:nth-child(even) {
    background: #333;
  }
  &:hover {
    background: #404040;
  }
`;

// ============================================================================
// TypeScript Interfaces
// ============================================================================

export interface TestResultsCompareProps {
  baselineData: ParsedFileEntry[];
  comparisonData: ParsedFileEntry[];
  baselineLabel?: string;
  comparisonLabel?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

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

interface ChartComponentProps {
  displayData: ParsedFileEntry[];
  mergeEndpoints: boolean;
  chartType: "median" | "worst5" | "error5xx" | "allErrors";
}

const ComparisonChart: React.FC<ChartComponentProps> = ({ displayData, mergeEndpoints, chartType }) => {
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

      import("../TestResults/charts").then((charts) => {
        let currentChart: Chart;
        switch (chartType) {
          case "median":
            currentChart = charts.medianDurationChart(node, endpointData);
            break;
          case "worst5":
            currentChart = charts.worst5PercentChart(node, endpointData);
            break;
          case "error5xx":
            currentChart = charts.error5xxChart(node, endpointData);
            break;
          case "allErrors":
            currentChart = charts.allErrorsChart(node, endpointData);
            break;
        }
        setChart(currentChart);
        setHiddenDatasets(new Set());
      });
    }
  }, [displayData, mergeEndpoints, chartType]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();

      setHiddenDatasets((prev: Set<number>) => {
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
          {chart.data.datasets.map((dataset: any, index: number) => (
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
// Final Results Table Component
// ============================================================================

interface TableProps {
  displayData: ParsedFileEntry[];
  fileLabel?: string;
}

const FinalResultsTable: React.FC<TableProps> = ({ displayData, fileLabel: _fileLabel = "Results" }) => {
  const tableData = useMemo(() => {
    const results: any[] = [];

    for (const [bucketId, dataPoints] of displayData) {
      if (dataPoints.length === 0) { continue; }

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

      const callCount = totalRTT.getTotalCount();
      const p50 = callCount ? Number(totalRTT.getValueAtPercentile(50)) / 1000 : 0;
      const p95 = callCount ? Number(totalRTT.getValueAtPercentile(95)) / 1000 : 0;
      const p99 = callCount ? Number(totalRTT.getValueAtPercentile(99)) / 1000 : 0;
      const min = callCount ? Number(totalRTT.getMinNonZeroValue()) / 1000 : 0;
      const max = callCount ? Number(totalRTT.getMaxValue()) / 1000 : 0;
      const stddev = callCount ? Number(totalRTT.getStdDeviation()) / 1000 : 0;

      const statusCountsArray: any[] = [];
      for (const [status, count] of Object.entries(statusCounts)) {
        statusCountsArray.push({ status: parseInt(status), count });
      }
      statusCountsArray.sort((a, b) => a.status - b.status);

      let hostname = "";
      let path = "";
      let queryString = "";
      try {
        const urlObj = new URL(bucketId.url);
        hostname = urlObj.hostname;
        path = urlObj.pathname;
        queryString = urlObj.search.slice(1);
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
        time: dataPoints[dataPoints.length - 1].time
      });

      totalRTT.free();
    }

    return results;
  }, [displayData]);

  return (
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
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const TestResultsCompare: React.FC<TestResultsCompareProps> = ({
  baselineData,
  comparisonData,
  baselineLabel = "Baseline",
  comparisonLabel = "Comparison"
}) => {
  const [mergeEndpoints, setMergeEndpoints] = useState(false);
  const [methodFilter, setMethodFilter] = useState<string>("all");

  // Extract unique HTTP methods from both datasets
  const availableMethods = useMemo(() => {
    const methods = new Set<string>();

    if (baselineData) {
      for (const [bucketId] of baselineData) {
        if (bucketId.method) {
          methods.add(bucketId.method);
        }
      }
    }

    if (comparisonData) {
      for (const [bucketId] of comparisonData) {
        if (bucketId.method) {
          methods.add(bucketId.method);
        }
      }
    }

    return Array.from(methods).sort();
  }, [baselineData, comparisonData]);

  // Filter both datasets by selected method
  const filteredBaselineData = useMemo(() => {
    if (!baselineData) {
      return baselineData;
    }
    if (methodFilter === "all") {
      return baselineData;
    }
    return baselineData.filter(([bucketId]) => bucketId.method === methodFilter);
  }, [baselineData, methodFilter]);

  const filteredComparisonData = useMemo(() => {
    if (!comparisonData) {
      return comparisonData;
    }
    if (methodFilter === "all") {
      return comparisonData;
    }
    return comparisonData.filter(([bucketId]) => bucketId.method === methodFilter);
  }, [comparisonData, methodFilter]);

  // Empty state
  if (!baselineData || baselineData.length === 0 || !comparisonData || comparisonData.length === 0) {
    return (
      <CONTAINER>
        <H1>Performance Comparison</H1>
        <p style={{ textAlign: "center", color: "#999" }}>
          Select two results files to compare
        </p>
      </CONTAINER>
    );
  }

  return (
    <CONTAINER>
      <H1>Performance Comparison</H1>

      <FILTERCONTAINER>
        <FILTERDROPDOWN>
          <label htmlFor="method-filter-compare">Filter by Method:</label>
          <select
            id="method-filter-compare"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
          >
            <option value="all">All Methods</option>
            {availableMethods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </FILTERDROPDOWN>

        <TOGGLECONTAINER style={{ margin: 0 }}>
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
      </FILTERCONTAINER>

      <H2>Performance & Error Metrics Comparison</H2>
      <COMPARISONCHARTSGRID>
        <CHARTCOLUMN>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Median Duration
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="median"
              />
            </QUADPANEL>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Worst 5%
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="worst5"
              />
            </QUADPANEL>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - 5xx Errors
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="error5xx"
              />
            </QUADPANEL>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - All Errors
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="allErrors"
              />
            </QUADPANEL>
          </div>
        </CHARTCOLUMN>

        <CHARTCOLUMN>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Median Duration
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="median"
              />
            </QUADPANEL>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Worst 5%
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="worst5"
              />
            </QUADPANEL>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - 5xx Errors
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="error5xx"
              />
            </QUADPANEL>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - All Errors
            </h3>
            <QUADPANEL>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="allErrors"
              />
            </QUADPANEL>
          </div>
        </CHARTCOLUMN>
      </COMPARISONCHARTSGRID>

      <H1>Final Results Comparison</H1>
      <COMPARISONCHARTSGRID>
        <CHARTCOLUMN>
          <H2>{baselineLabel}</H2>
          <FinalResultsTable displayData={filteredBaselineData} fileLabel={baselineLabel} />
        </CHARTCOLUMN>
        <CHARTCOLUMN>
          <H2>{comparisonLabel}</H2>
          <FinalResultsTable displayData={filteredComparisonData} fileLabel={comparisonLabel} />
        </CHARTCOLUMN>
      </COMPARISONCHARTSGRID>
    </CONTAINER>
  );
};

export default TestResultsCompare;
