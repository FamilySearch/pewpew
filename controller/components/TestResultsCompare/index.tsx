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
import * as XLSX from "xlsx";
import { DataPoint, ParsedFileEntry } from "../TestResults/model";
import { Chart } from "chart.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

/** Change indicator with color coding */
const CHANGEVALUE = styled.span<{ $isPositive?: boolean; $isNegative?: boolean }>`
  color: ${props => {
    if (props.$isPositive) {
      return "#4CAF50";
    } // Green for improvements
    if (props.$isNegative) {
      return "#f44336";
    } // Red for regressions
    return "#999"; // Gray for no change
  }};
  font-weight: ${props => (props.$isPositive || props.$isNegative) ? "bold" : "normal"};
`;

/** Tab navigation container */
const TABCONTAINER = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid #444;
  margin: 2em 0 1em 0;
`;

/** Individual tab button */
const TAB = styled.button<{ $active?: boolean }>`
  background-color: ${props => props.$active ? "#2a2a2a" : "#1a1a1a"};
  color: ${props => props.$active ? "white" : "#999"};
  border: none;
  border-bottom: ${props => props.$active ? "2px solid #6a7bb4" : "2px solid transparent"};
  padding: 1em 2em;
  cursor: pointer;
  font-size: 14px;
  font-weight: ${props => props.$active ? "bold" : "normal"};
  transition: all 0.2s;
  margin-bottom: -2px;

  &:hover {
    background-color: #2a2a2a;
    color: white;
  }
`;

/** Tab content wrapper */
const TABCONTENT = styled.div`
  margin-top: 2em;
`;

/** Download button for Excel export */
const DOWNLOADBUTTON = styled.button`
  background-color: #4CAF50;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: bold;
  margin-bottom: 0.5em;
  transition: background-color 0.3s;
  width: 100%;

  &:hover {
    background-color: #45a049;
  }

  &:active {
    background-color: #3d8b40;
  }
`;

const COLUMNSELECT = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-bottom: 1em;
  padding: 0.75em;
  background-color: #2a2a2a;
  border-radius: 4px;
  position: relative;

  label {
    color: #ccc;
    font-size: 11px;
    font-weight: bold;
    white-space: nowrap;
  }

  .column-count {
    color: #999;
    font-size: 9px;
    font-style: italic;
  }
`;

const DROPDOWNBUTTON = styled.button`
  flex: 1;
  padding: 0.5em 0.75em;
  background-color: #1a1a1a;
  color: white;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  text-align: left;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 200px;

  &:hover {
    border-color: #666;
  }

  &:focus {
    outline: none;
    border-color: #6a7bb4;
  }

  .arrow {
    margin-left: 0.5em;
    font-size: 8px;
  }
`;

const DROPDOWNMENU = styled.div<{ $isOpen: boolean }>`
  display: ${props => props.$isOpen ? "block" : "none"};
  position: absolute;
  top: 100%;
  left: 0.75em;
  right: 0.75em;
  background-color: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  margin-top: 0.25em;
  max-height: 300px;
  overflow-y: auto;
  z-index: 1000;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
`;

const DROPDOWNITEM = styled.label`
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.5em 0.75em;
  cursor: pointer;
  font-size: 10px;
  color: #ccc;
  transition: background-color 0.15s;

  &:hover {
    background-color: #2a2a2a;
  }

  input[type="checkbox"] {
    cursor: pointer;
    width: 14px;
    height: 14px;
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

const FinalResultsTable: React.FC<TableProps> = ({ displayData, fileLabel = "Results" }) => {
  // Column visibility state - start with commonly less important columns hidden
  const [visibleColumns, setVisibleColumns] = useState({
    method: true,
    hostname: true,
    path: true,
    queryString: false,
    tags: false,
    statusCount: true,
    callCount: true,
    p50: true,
    p95: true,
    p99: false,
    min: false,
    max: false,
    stddev: false,
    time: false
  });

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const toggleColumn = (column: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const visibleCount = Object.values(visibleColumns).filter(Boolean).length;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".column-select-container")) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

      // Filter out method and url from tags since they're already in separate columns
      const { method: _, url: __, ...otherTags } = bucketId;
      const tagsString = JSON.stringify(otherTags);

      results.push({
        method: bucketId.method,
        hostname,
        path,
        queryString,
        tags: tagsString,
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
    XLSX.utils.book_append_sheet(workbook, worksheet, fileLabel);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `${fileLabel.toLowerCase().replace(/\s/g, "-")}-${timestamp}.xlsx`;

    // Download file
    XLSX.writeFile(workbook, filename);
  }, [tableData, fileLabel]);

  return (
    <>
      <DOWNLOADBUTTON onClick={exportToExcel}>
        Download as Excel
      </DOWNLOADBUTTON>
      <COLUMNSELECT className="column-select-container">
        <label>Show Columns:</label>
        <DROPDOWNBUTTON onClick={() => setDropdownOpen(!dropdownOpen)} type="button">
          <span>{visibleCount} of 14 columns selected</span>
          <span className="arrow">{dropdownOpen ? "▲" : "▼"}</span>
        </DROPDOWNBUTTON>
        <DROPDOWNMENU $isOpen={dropdownOpen}>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.method}
              onChange={() => toggleColumn("method")}
            />
            Method
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.hostname}
              onChange={() => toggleColumn("hostname")}
            />
            Hostname
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.path}
              onChange={() => toggleColumn("path")}
            />
            Path
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.queryString}
              onChange={() => toggleColumn("queryString")}
            />
            Query String
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.tags}
              onChange={() => toggleColumn("tags")}
            />
            Tags
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.statusCount}
              onChange={() => toggleColumn("statusCount")}
            />
            Status Count
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.callCount}
              onChange={() => toggleColumn("callCount")}
            />
            Call Count
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.p50}
              onChange={() => toggleColumn("p50")}
            />
            P50
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.p95}
              onChange={() => toggleColumn("p95")}
            />
            P95
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.p99}
              onChange={() => toggleColumn("p99")}
            />
            P99
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.min}
              onChange={() => toggleColumn("min")}
            />
            Min
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.max}
              onChange={() => toggleColumn("max")}
            />
            Max
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.stddev}
              onChange={() => toggleColumn("stddev")}
            />
            Std Dev
          </DROPDOWNITEM>
          <DROPDOWNITEM>
            <input
              type="checkbox"
              checked={visibleColumns.time}
              onChange={() => toggleColumn("time")}
            />
            Time
          </DROPDOWNITEM>
        </DROPDOWNMENU>
      </COLUMNSELECT>
      <TABLECONTAINER>
        <DATATABLE>
        <thead>
          <tr>
            {visibleColumns.method && <TH>method</TH>}
            {visibleColumns.hostname && <TH>hostname</TH>}
            {visibleColumns.path && <TH>path</TH>}
            {visibleColumns.queryString && <TH>queryString</TH>}
            {visibleColumns.tags && <TH>tags</TH>}
            {visibleColumns.statusCount && <TH>statusCount</TH>}
            {visibleColumns.callCount && <TH>callCount</TH>}
            {visibleColumns.p50 && <TH>p50</TH>}
            {visibleColumns.p95 && <TH>p95</TH>}
            {visibleColumns.p99 && <TH>p99</TH>}
            {visibleColumns.min && <TH>min</TH>}
            {visibleColumns.max && <TH>max</TH>}
            {visibleColumns.stddev && <TH>stddev</TH>}
            {visibleColumns.time && <TH>_time</TH>}
          </tr>
        </thead>
        <tbody>
          {tableData.map((row, idx) => (
            <DATATR key={idx}>
              {visibleColumns.method && <DATATD>{row.method}</DATATD>}
              {visibleColumns.hostname && <DATATD title={row.hostname}>{row.hostname}</DATATD>}
              {visibleColumns.path && <DATATD title={row.path}>{row.path}</DATATD>}
              {visibleColumns.queryString && <DATATD>{row.queryString}</DATATD>}
              {visibleColumns.tags && <DATATD title={row.tags}>{row.tags}</DATATD>}
              {visibleColumns.statusCount && <DATATD>
                {row.statusCounts.map((sc: any, i: number) => (
                  <div key={i}>{sc.status}: {sc.count.toLocaleString()}</div>
                ))}
              </DATATD>}
              {visibleColumns.callCount && <DATATD>{row.callCount.toLocaleString()}</DATATD>}
              {visibleColumns.p50 && <DATATD>{row.p50.toFixed(2)}</DATATD>}
              {visibleColumns.p95 && <DATATD>{row.p95.toFixed(2)}</DATATD>}
              {visibleColumns.p99 && <DATATD>{row.p99.toFixed(2)}</DATATD>}
              {visibleColumns.min && <DATATD>{row.min.toFixed(2)}</DATATD>}
              {visibleColumns.max && <DATATD>{row.max.toFixed(2)}</DATATD>}
              {visibleColumns.stddev && <DATATD>{row.stddev.toFixed(2)}</DATATD>}
              {visibleColumns.time && <DATATD>{row.time.toLocaleString()}</DATATD>}
            </DATATR>
          ))}
        </tbody>
      </DATATABLE>
    </TABLECONTAINER>
    </>
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
  const [activeTab, setActiveTab] = useState<"endpoint" | "final">("endpoint");

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

      <TABCONTAINER>
        <TAB $active={activeTab === "endpoint"} onClick={() => setActiveTab("endpoint")}>
          Endpoint Comparison
        </TAB>
        <TAB $active={activeTab === "final"} onClick={() => setActiveTab("final")}>
          Final Results Comparison
        </TAB>
      </TABCONTAINER>

      {activeTab === "endpoint" && (
        <TABCONTENT>
          <p style={{ textAlign: "center", color: "#999", marginBottom: "1em" }}>
            Per-endpoint metrics comparison (green = improvement, red = regression)
          </p>
          {(() => {
            // Create a map to match endpoints between baseline and comparison
            const baselineMap = new Map<string, DataPoint[]>();
            const comparisonMap = new Map<string, DataPoint[]>();

            // Build baseline map
            for (const [bucketId, dataPoints] of filteredBaselineData) {
              const key = `${bucketId.method}||${bucketId.hostname}||${bucketId.url}`;
              if (baselineMap.has(key)) {
                baselineMap.get(key)!.push(...dataPoints);
              } else {
                baselineMap.set(key, [...dataPoints]);
              }
            }

            // Build comparison map
            for (const [bucketId, dataPoints] of filteredComparisonData) {
              const key = `${bucketId.method}||${bucketId.hostname}||${bucketId.url}`;
              if (comparisonMap.has(key)) {
                comparisonMap.get(key)!.push(...dataPoints);
              } else {
                comparisonMap.set(key, [...dataPoints]);
              }
            }

            // Find matching endpoints
            const matchedEndpoints: Array<{
              key: string;
              method: string;
              hostname: string;
              path: string;
              baselineData: DataPoint[];
              comparisonData: DataPoint[];
            }> = [];

            for (const [key, baselineData] of baselineMap.entries()) {
              if (comparisonMap.has(key)) {
                const [method, hostname, path] = key.split("||");
                matchedEndpoints.push({
                  key,
                  method,
                  hostname,
                  path,
                  baselineData,
                  comparisonData: comparisonMap.get(key)!
                });
              }
            }

            const renderMetricRow = (label: string, baselineVal: number | null | undefined, comparisonVal: number | null | undefined, isCount = false) => {
              const diff = baselineVal !== null && baselineVal !== undefined && comparisonVal !== null && comparisonVal !== undefined
                ? comparisonVal - baselineVal
                : null;
              const percent = baselineVal && diff !== null && baselineVal !== 0 ? (diff / baselineVal) * 100 : null;

              return (
                <DATATR key={label}>
                  <DATATD>{label}</DATATD>
                  <DATATD>
                    {baselineVal !== null && baselineVal !== undefined
                      ? isCount ? baselineVal.toLocaleString() : `${baselineVal.toFixed(2)}ms`
                      : "N/A"}
                  </DATATD>
                  <DATATD>
                    {comparisonVal !== null && comparisonVal !== undefined
                      ? isCount ? comparisonVal.toLocaleString() : `${comparisonVal.toFixed(2)}ms`
                      : "N/A"}
                  </DATATD>
                  <DATATD>
                    {diff !== null ? (
                      <CHANGEVALUE
                        $isPositive={!isCount && diff < 0}
                        $isNegative={!isCount && diff > 0}
                      >
                        {diff > 0 ? "+" : ""}{isCount ? diff.toLocaleString() : `${diff.toFixed(2)}ms`}
                        {percent !== null && ` (${diff > 0 ? "+" : ""}${percent.toFixed(1)}%)`}
                      </CHANGEVALUE>
                    ) : "N/A"}
                  </DATATD>
                </DATATR>
              );
            };

            return matchedEndpoints.map(({ key, method, hostname, path, baselineData, comparisonData }) => {
              // Aggregate baseline data for this endpoint
              let baselineRTT = null;
              let baselineCallCount = 0;

              for (const dp of baselineData) {
                if (!baselineRTT) {
                  baselineRTT = dp.rttHistogram.clone();
                } else {
                  baselineRTT.add(dp.rttHistogram);
                }
                baselineCallCount += Number(dp.rttHistogram.getTotalCount());
              }

              // Aggregate comparison data for this endpoint
              let comparisonRTT = null;
              let comparisonCallCount = 0;

              for (const dp of comparisonData) {
                if (!comparisonRTT) {
                  comparisonRTT = dp.rttHistogram.clone();
                } else {
                  comparisonRTT.add(dp.rttHistogram);
                }
                comparisonCallCount += Number(dp.rttHistogram.getTotalCount());
              }

              // Calculate metrics
              const baselineMetrics = baselineRTT ? {
                avg: baselineRTT.getMean() / 1000,
                min: Number(baselineRTT.getMinNonZeroValue()) / 1000,
                max: Number(baselineRTT.getMaxValue()) / 1000,
                stdDev: Number(baselineRTT.getStdDeviation()) / 1000,
                p50: Number(baselineRTT.getValueAtPercentile(50)) / 1000,
                p90: Number(baselineRTT.getValueAtPercentile(90)) / 1000,
                p95: Number(baselineRTT.getValueAtPercentile(95)) / 1000,
                p99: Number(baselineRTT.getValueAtPercentile(99)) / 1000,
                callCount: baselineCallCount
              } : null;

              const comparisonMetrics = comparisonRTT ? {
                avg: comparisonRTT.getMean() / 1000,
                min: Number(comparisonRTT.getMinNonZeroValue()) / 1000,
                max: Number(comparisonRTT.getMaxValue()) / 1000,
                stdDev: Number(comparisonRTT.getStdDeviation()) / 1000,
                p50: Number(comparisonRTT.getValueAtPercentile(50)) / 1000,
                p90: Number(comparisonRTT.getValueAtPercentile(90)) / 1000,
                p95: Number(comparisonRTT.getValueAtPercentile(95)) / 1000,
                p99: Number(comparisonRTT.getValueAtPercentile(99)) / 1000,
                callCount: comparisonCallCount
              } : null;

              // Free histograms
              if (baselineRTT) {
                baselineRTT.free();
              }
              if (comparisonRTT) {
                comparisonRTT.free();
              }

              return (
                <div key={key} style={{ marginBottom: "3em" }}>
                  <H2 style={{ fontSize: "1.2em", marginBottom: "0.5em" }}>
                    {method} {hostname}{path}
                  </H2>
                  <TABLECONTAINER>
                    <DATATABLE>
                      <thead>
                        <tr>
                          <TH>Metric</TH>
                          <TH title={baselineLabel}>Baseline</TH>
                          <TH title={comparisonLabel}>Comparison</TH>
                          <TH>Change</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {renderMetricRow("Calls", baselineMetrics?.callCount, comparisonMetrics?.callCount, true)}
                        {renderMetricRow("Avg Response Time", baselineMetrics?.avg, comparisonMetrics?.avg)}
                        {renderMetricRow("Min Response Time", baselineMetrics?.min, comparisonMetrics?.min)}
                        {renderMetricRow("Max Response Time", baselineMetrics?.max, comparisonMetrics?.max)}
                        {renderMetricRow("Std Dev", baselineMetrics?.stdDev, comparisonMetrics?.stdDev)}
                        {renderMetricRow("P50", baselineMetrics?.p50, comparisonMetrics?.p50)}
                        {renderMetricRow("P90", baselineMetrics?.p90, comparisonMetrics?.p90)}
                        {renderMetricRow("P95", baselineMetrics?.p95, comparisonMetrics?.p95)}
                        {renderMetricRow("P99", baselineMetrics?.p99, comparisonMetrics?.p99)}
                      </tbody>
                    </DATATABLE>
                  </TABLECONTAINER>
                </div>
              );
            });
          })()}
        </TABCONTENT>
      )}

      {activeTab === "final" && (
        <TABCONTENT>
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
        </TABCONTENT>
      )}
    </CONTAINER>
  );
};

export default TestResultsCompare;
