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

import { DataPoint, ParsedFileEntry } from "../TestResults/model";
import { ExcelResultRow, exportResultsToExcel } from "../../src/excelexport";
import { LogLevel, log } from "../../src/log";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "chart.js";
import { compareEndpointAnchorId } from "../TestResults/utils";
import styled from "styled-components";

// ============================================================================
// Styled Components
// ============================================================================

const Container = styled.div`
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
const QuadPanel = styled.div`
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
const ComparisonChartsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 1.5em;
  margin-bottom: 2em;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

/** Each column contains stacked charts */
const ChartColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2em;
  min-width: 0;
  overflow: hidden;
`;

/** Custom HTML legend */
const CustomLegend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 1em;
  padding-top: 1em;
  border-top: 1px solid #444;
  justify-content: center;
`;

/** Individual legend item */
const LegendItem = styled.div<{ $hidden?: boolean }>`
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
const ToggleContainer = styled.div`
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

const FilterContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1em;
  margin: 1em 0 2em 0;
`;

const FilterDropdown = styled.div`
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
const TableContainer = styled.div`
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  margin: 1em 0;
`;

const DataTable = styled.table`
  color: white;
  border-spacing: 0;
  background-color: #2a2a2a;
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  font-size: 10px;
`;

const Th = styled.th`
  padding: 4px 6px;
  text-align: left;
  background-color: #1a1a1a;
  border-bottom: 2px solid #444;
  font-weight: bold;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 10;
  font-size: 10px;
`;

const DataTd = styled.td`
  padding: 4px 6px;
  border-bottom: 1px solid #444;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
  line-height: 1.3;
`;

const DataTr = styled.tr`
  &:nth-child(even) {
    background: #333;
  }
  &:hover {
    background: #404040;
  }
`;

/** Change indicator with color coding */
const ChangeValue = styled.span<{ $isPositive?: boolean; $isNegative?: boolean }>`
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
const TabContainer = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid #444;
  margin: 2em 0 1em 0;
`;

/** Individual tab button */
const Tab = styled.button<{ $active?: boolean }>`
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
const TabContent = styled.div`
  margin-top: 2em;
`;

/** Download button for Excel export */
const DownloadButton = styled.button`
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

const ColumnSelect = styled.div`
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

const DropdownButton = styled.button`
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

const DropdownMenu = styled.div<{ $isOpen: boolean }>`
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

const DropdownItem = styled.label`
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

const SectionHeading = styled.h2`
  a.anchor-link {
    margin-left: 0.4em;
    color: #666;
    text-decoration: none;
    font-size: 0.7em;
    vertical-align: middle;
    opacity: 0;
    transition: opacity 0.15s;

    &:hover {
      color: #6a7bb4;
    }
  }

  &:hover a.anchor-link {
    opacity: 1;
  }
`;

const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
  e.preventDefault();
  history.replaceState(null, "", "#" + id);
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
};

// ============================================================================
// Shared state shape constants
// ============================================================================

const INITIAL_VISIBLE_COLUMNS = {
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
};

const INITIAL_VISIBLE_METRICS = {
  calls: true,
  avg: true,
  min: false,
  max: false,
  stdDev: false,
  p50: true,
  p90: false,
  p95: true,
  p99: true
};

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

const mergeAllDataPoints = (dataPoints: DataPoint[]): DataPoint[] => {
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
// Request Count Chart Components
// ============================================================================

const ComparisonRequestCountByEndpointChart: React.FC<{ displayData: ParsedFileEntry[]; mergeEndpoints: boolean }> = ({ displayData, mergeEndpoints }) => {
  const canvasNodeRef = useRef<HTMLCanvasElement | null>(null);
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const allEndpoints = useMemo((): [string, DataPoint[]][] => {
    if (mergeEndpoints) {
      const groupedMap = new Map<string, DataPoint[]>();
      for (const [bucketId, dataPoints] of displayData) {
        const label = `${bucketId.method} ${bucketId.url}`;
        if (groupedMap.has(label)) {
          const existing = groupedMap.get(label)!;
          for (const dp of dataPoints) { existing.push(dp); }
        } else {
          groupedMap.set(label, dataPoints.slice());
        }
      }
      return Array.from(groupedMap.entries());
    }
    return displayData.map(([bucketId, dataPoints]) => [`${bucketId.method} ${bucketId.url}`, dataPoints]);
  }, [displayData, mergeEndpoints]);

  useEffect(() => {
    const node = canvasNodeRef.current;
    if (!node || allEndpoints.length === 0) { return; }
    let currentChart: Chart;
    import("../TestResults/charts").then(({ requestCountByEndpoint }) => {
      if (chart) { chart.destroy(); }
      currentChart = requestCountByEndpoint(node, allEndpoints);
      setChart(currentChart);
      setHiddenDatasets(new Set());
    });
    return () => { if (currentChart) { currentChart.destroy(); } };
  }, [allEndpoints]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();
      setHiddenDatasets(prev => {
        const next = new Set(prev);
        if (meta.hidden) { next.add(index); } else { next.delete(index); }
        return next;
      });
    }
  };

  return (
    <QuadPanel>
      <canvas ref={canvasNodeRef} />
      {chart && chart.data.datasets && (
        <CustomLegend>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LegendItem key={index} $hidden={hiddenDatasets.has(index)} onClick={() => toggleDataset(index)}>
              <span className="color-box" style={{ backgroundColor: dataset.borderColor as string }} />
              <span>{dataset.label}</span>
            </LegendItem>
          ))}
        </CustomLegend>
      )}
    </QuadPanel>
  );
};

const ComparisonRequestCountByHostChart: React.FC<{ displayData: ParsedFileEntry[] }> = ({ displayData }) => {
  const canvasNodeRef = useRef<HTMLCanvasElement | null>(null);
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const hostGroups = useMemo((): [string, DataPoint[]][] => {
    const grouped = new Map<string, DataPoint[]>();
    for (const [bucketId, dataPoints] of displayData) {
      let hostname = bucketId.url;
      try {
        hostname = new URL(bucketId.url).hostname;
      } catch { }
      if (grouped.has(hostname)) {
        grouped.get(hostname)!.push(...dataPoints);
      } else {
        grouped.set(hostname, [...dataPoints]);
      }
    }
    return Array.from(grouped.entries());
  }, [displayData]);

  useEffect(() => {
    const node = canvasNodeRef.current;
    if (!node || hostGroups.length === 0) { return; }
    let currentChart: Chart;
    import("../TestResults/charts").then(({ mergeAgentColors, requestCountByEndpoint }) => {
      if (chart) { chart.destroy(); }
      currentChart = requestCountByEndpoint(node, hostGroups, mergeAgentColors);
      setChart(currentChart);
      setHiddenDatasets(new Set());
    });
    return () => { if (currentChart) { currentChart.destroy(); } };
  }, [hostGroups]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();
      setHiddenDatasets(prev => {
        const next = new Set(prev);
        if (meta.hidden) { next.add(index); } else { next.delete(index); }
        return next;
      });
    }
  };

  return (
    <QuadPanel>
      <canvas ref={canvasNodeRef} />
      {chart && chart.data.datasets && (
        <CustomLegend>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LegendItem key={index} $hidden={hiddenDatasets.has(index)} onClick={() => toggleDataset(index)}>
              <span className="color-box" style={{ backgroundColor: dataset.borderColor as string }} />
              <span>{dataset.label}</span>
            </LegendItem>
          ))}
        </CustomLegend>
      )}
    </QuadPanel>
  );
};

const ComparisonRequestCountByFileChart: React.FC<{ timeSeries: { time: Date; count: number }[]; label: string }> = ({ timeSeries, label }) => {
  const canvasNodeRef = useRef<HTMLCanvasElement | null>(null);
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  // timeSeries is pre-computed by the parent (no WASM calls here)
  const fileSeries = useMemo((): [string, { time: Date; count: number }[]][] =>
    [[label, timeSeries]],
    [label, timeSeries]
  );

  useEffect(() => {
    const node = canvasNodeRef.current;
    if (!node || fileSeries.length === 0) { return; }
    let currentChart: Chart;
    import("../TestResults/charts").then(({ requestCountByAgentSeries }) => {
      if (chart) { chart.destroy(); }
      currentChart = requestCountByAgentSeries(node, fileSeries);
      setChart(currentChart);
      setHiddenDatasets(new Set());
    });
    return () => { if (currentChart) { currentChart.destroy(); } };
  }, [fileSeries]);

  const toggleDataset = (index: number) => {
    if (chart) {
      const meta = chart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      chart.update();
      setHiddenDatasets(prev => {
        const next = new Set(prev);
        if (meta.hidden) { next.add(index); } else { next.delete(index); }
        return next;
      });
    }
  };

  return (
    <QuadPanel>
      <canvas ref={canvasNodeRef} />
      {chart && chart.data.datasets && (
        <CustomLegend>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LegendItem key={index} $hidden={hiddenDatasets.has(index)} onClick={() => toggleDataset(index)}>
              <span className="color-box" style={{ backgroundColor: dataset.borderColor as string }} />
              <span>{dataset.label}</span>
            </LegendItem>
          ))}
        </CustomLegend>
      )}
    </QuadPanel>
  );
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
  const canvasNodeRef = useRef<HTMLCanvasElement | null>(null);
  const [chart, setChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const allEndpoints = useMemo(() => {
    if (mergeEndpoints) {
      // Accumulate all DataPoints per label first, then merge once per label.
      // The old pattern (mergeAllDataPoints inside the loop) was O(N²) WASM calls
      // and leaked intermediate cloned histograms on every iteration.
      const groupedMap = new Map<string, DataPoint[]>();
      for (const [bucketId, dataPoints] of displayData) {
        const label = `${bucketId.method} ${bucketId.url}`;
        if (groupedMap.has(label)) {
          const existing = groupedMap.get(label)!;
          for (const dp of dataPoints) { existing.push(dp); }
        } else {
          groupedMap.set(label, dataPoints.slice());
        }
      }
      return Array.from(groupedMap.entries())
        .map(([label, dps]) => [label, mergeAllDataPoints(dps)] as [string, DataPoint[]]);
    }
    return displayData.map(([bucketId, dataPoints]) =>
      [`${bucketId.method} ${bucketId.url}`, dataPoints] as [string, DataPoint[]]
    );
  }, [displayData, mergeEndpoints]);

  useEffect(() => {
    const node = canvasNodeRef.current;
    if (!node || allEndpoints.length === 0) { return; }

    import("../TestResults/charts").then((charts) => {
      if (chart) {
        chart.destroy();
      }
      let currentChart: Chart;
      switch (chartType) {
        case "median":
          currentChart = charts.medianDurationChart(node, allEndpoints);
          break;
        case "worst5":
          currentChart = charts.worst5PercentChart(node, allEndpoints);
          break;
        case "error5xx":
          currentChart = charts.error5xxChart(node, allEndpoints);
          break;
        case "allErrors":
          currentChart = charts.allErrorsChart(node, allEndpoints);
          break;
      }
      setChart(currentChart);
      setHiddenDatasets(new Set());
    });

    return () => {
      if (chart) {
        chart.destroy();
      }
    };
  }, [allEndpoints, chartType]);

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
      <canvas ref={canvasNodeRef} />
      {chart && chart.data.datasets && (
        <CustomLegend>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LegendItem
              key={index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => toggleDataset(index)}
            >
              <span
                className="color-box"
                style={{ backgroundColor: dataset.borderColor as string }}
              />
              <span>{dataset.label}</span>
            </LegendItem>
          ))}
        </CustomLegend>
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
  visibleColumns: typeof INITIAL_VISIBLE_COLUMNS;
  onToggleColumn: (column: keyof typeof INITIAL_VISIBLE_COLUMNS) => void;
}

const FinalResultsTable: React.FC<TableProps> = ({ displayData, fileLabel = "Results", visibleColumns, onToggleColumn }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

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
    const excelData: ExcelResultRow[] = tableData.map(row => ({
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
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, -5);
    const filename = `${fileLabel.toLowerCase().replaceAll(/\s/g, "-")}-${timestamp}.xlsx`;
    exportResultsToExcel(excelData, filename, fileLabel)
    .catch((error) => log("Error exporting to Excel", LogLevel.ERROR, error));
  }, [tableData, fileLabel]);

  return (
    <>
      <DownloadButton onClick={exportToExcel}>
        Download as Excel
      </DownloadButton>
      <ColumnSelect className="column-select-container">
        <label htmlFor={`show-columns-${fileLabel}`}>Show Columns:</label>
        <DropdownButton id={`show-columns-${fileLabel}`} onClick={() => setDropdownOpen(!dropdownOpen)} type="button">
          <span>{visibleCount} of 14 columns selected</span>
          <span className="arrow">{dropdownOpen ? "▲" : "▼"}</span>
        </DropdownButton>
        <DropdownMenu $isOpen={dropdownOpen}>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.method}
              onChange={() => onToggleColumn("method")}
            />
            Method
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.hostname}
              onChange={() => onToggleColumn("hostname")}
            />
            Hostname
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.path}
              onChange={() => onToggleColumn("path")}
            />
            Path
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.queryString}
              onChange={() => onToggleColumn("queryString")}
            />
            Query String
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.tags}
              onChange={() => onToggleColumn("tags")}
            />
            Tags
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.statusCount}
              onChange={() => onToggleColumn("statusCount")}
            />
            Status Count
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.callCount}
              onChange={() => onToggleColumn("callCount")}
            />
            Call Count
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.p50}
              onChange={() => onToggleColumn("p50")}
            />
            P50
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.p95}
              onChange={() => onToggleColumn("p95")}
            />
            P95
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.p99}
              onChange={() => onToggleColumn("p99")}
            />
            P99
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.min}
              onChange={() => onToggleColumn("min")}
            />
            Min
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.max}
              onChange={() => onToggleColumn("max")}
            />
            Max
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.stddev}
              onChange={() => onToggleColumn("stddev")}
            />
            Std Dev
          </DropdownItem>
          <DropdownItem>
            <input
              type="checkbox"
              checked={visibleColumns.time}
              onChange={() => onToggleColumn("time")}
            />
            Time
          </DropdownItem>
        </DropdownMenu>
      </ColumnSelect>
      <TableContainer>
        <DataTable>
        <thead>
          <tr>
            {visibleColumns.method && <Th>method</Th>}
            {visibleColumns.hostname && <Th>hostname</Th>}
            {visibleColumns.path && <Th>path</Th>}
            {visibleColumns.queryString && <Th>queryString</Th>}
            {visibleColumns.tags && <Th>tags</Th>}
            {visibleColumns.statusCount && <Th>statusCount</Th>}
            {visibleColumns.callCount && <Th>callCount</Th>}
            {visibleColumns.p50 && <Th>p50</Th>}
            {visibleColumns.p95 && <Th>p95</Th>}
            {visibleColumns.p99 && <Th>p99</Th>}
            {visibleColumns.min && <Th>min</Th>}
            {visibleColumns.max && <Th>max</Th>}
            {visibleColumns.stddev && <Th>stddev</Th>}
            {visibleColumns.time && <Th>_time</Th>}
          </tr>
        </thead>
        <tbody>
          {tableData.map((row, idx) => (
            <DataTr key={idx}>
              {visibleColumns.method && <DataTd>{row.method}</DataTd>}
              {visibleColumns.hostname && <DataTd title={row.hostname}>{row.hostname}</DataTd>}
              {visibleColumns.path && <DataTd title={row.path}>{row.path}</DataTd>}
              {visibleColumns.queryString && <DataTd>{row.queryString}</DataTd>}
              {visibleColumns.tags && <DataTd title={row.tags}>{row.tags}</DataTd>}
              {visibleColumns.statusCount && <DataTd>
                {row.statusCounts.map((sc: any, i: number) => (
                  <div key={i}>{sc.status}: {sc.count.toLocaleString()}</div>
                ))}
              </DataTd>}
              {visibleColumns.callCount && <DataTd>{row.callCount.toLocaleString()}</DataTd>}
              {visibleColumns.p50 && <DataTd>{row.p50.toFixed(2)}</DataTd>}
              {visibleColumns.p95 && <DataTd>{row.p95.toFixed(2)}</DataTd>}
              {visibleColumns.p99 && <DataTd>{row.p99.toFixed(2)}</DataTd>}
              {visibleColumns.min && <DataTd>{row.min.toFixed(2)}</DataTd>}
              {visibleColumns.max && <DataTd>{row.max.toFixed(2)}</DataTd>}
              {visibleColumns.stddev && <DataTd>{row.stddev.toFixed(2)}</DataTd>}
              {visibleColumns.time && <DataTd>{row.time.toLocaleString()}</DataTd>}
            </DataTr>
          ))}
        </tbody>
      </DataTable>
    </TableContainer>
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

  // Shared column visibility for both Final Results tables — toggling one syncs the other
  const [visibleColumns, setVisibleColumns] = useState(INITIAL_VISIBLE_COLUMNS);
  const toggleColumn = useCallback((column: keyof typeof INITIAL_VISIBLE_COLUMNS) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
  }, []);

  // Metric row visibility for the Endpoint Comparison table
  const [visibleMetrics, setVisibleMetrics] = useState(INITIAL_VISIBLE_METRICS);
  const [metricsDropdownOpen, setMetricsDropdownOpen] = useState(false);
  const toggleMetric = useCallback((metric: keyof typeof INITIAL_VISIBLE_METRICS) => {
    setVisibleMetrics(prev => ({ ...prev, [metric]: !prev[metric] }));
  }, []);

  // Close metrics dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".metric-select-container")) {
        setMetricsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (!baselineData?.length || !comparisonData?.length) {
      initialScrollDoneRef.current = false;
      return;
    }
    if (initialScrollDoneRef.current) { return; }
    initialScrollDoneRef.current = true;
    const hash = window.location.hash.slice(1);
    if (!hash) { return; }
    if (hash === "compare-final-results") {
      setActiveTab("final");
    } else if (hash.startsWith("compare-endpoint-") || hash === "compare-overview-charts") {
      setActiveTab("endpoint");
    }
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [baselineData, comparisonData]);

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

  // Pre-compute request-count time series for each side so ComparisonRequestCountByFileChart
  // receives plain data and never needs to call getTotalCount() (a WASM boundary crossing)
  // during its own useMemo.
  const baselineTimeSeries = useMemo((): { time: Date; count: number }[] => {
    if (!filteredBaselineData) { return []; }
    const timeMap = new Map<number, { time: Date; count: number }>();
    for (const [, dataPoints] of filteredBaselineData) {
      for (const dp of dataPoints) {
        const t = dp.time.getTime();
        const count = Number(dp.rttHistogram.getTotalCount());
        const existing = timeMap.get(t);
        if (existing) { existing.count += count; }
        else { timeMap.set(t, { time: new Date(t), count }); }
      }
    }
    return Array.from(timeMap.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [filteredBaselineData]);

  const comparisonTimeSeries = useMemo((): { time: Date; count: number }[] => {
    if (!filteredComparisonData) { return []; }
    const timeMap = new Map<number, { time: Date; count: number }>();
    for (const [, dataPoints] of filteredComparisonData) {
      for (const dp of dataPoints) {
        const t = dp.time.getTime();
        const count = Number(dp.rttHistogram.getTotalCount());
        const existing = timeMap.get(t);
        if (existing) { existing.count += count; }
        else { timeMap.set(t, { time: new Date(t), count }); }
      }
    }
    return Array.from(timeMap.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [filteredComparisonData]);

  // Empty state
  if (!baselineData || baselineData.length === 0 || !comparisonData || comparisonData.length === 0) {
    return (
      <Container>
        <H1>Performance Comparison</H1>
        <p style={{ textAlign: "center", color: "#999" }}>
          Select two results files to compare
        </p>
      </Container>
    );
  }

  const visibleMetricsCount = Object.values(visibleMetrics).filter(Boolean).length;

  return (
    <Container>
      <H1>Performance Comparison</H1>

      <FilterContainer>
        <FilterDropdown>
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
        </FilterDropdown>

        <ToggleContainer style={{ margin: 0 }}>
          <input
            type="checkbox"
            id="merge-endpoints-compare"
            checked={mergeEndpoints}
            onChange={(e) => setMergeEndpoints(e.target.checked)}
          />
          <label htmlFor="merge-endpoints-compare">
            Merge endpoints with different tags
          </label>
        </ToggleContainer>
      </FilterContainer>

      <div id="compare-request-count-charts">
        <SectionHeading>
          Request Count Overview
          <a href="#compare-request-count-charts" className="anchor-link" onClick={(e) => handleAnchorClick(e, "compare-request-count-charts")}>#</a>
        </SectionHeading>
      </div>
      <ComparisonChartsGrid>
        <ChartColumn>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Request Count by Endpoint
            </h3>
            <ComparisonRequestCountByEndpointChart displayData={filteredBaselineData} mergeEndpoints={mergeEndpoints} />
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Request Count by Host
            </h3>
            <ComparisonRequestCountByHostChart displayData={filteredBaselineData} />
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Request Count by File
            </h3>
            <ComparisonRequestCountByFileChart timeSeries={baselineTimeSeries} label={baselineLabel} />
          </div>
        </ChartColumn>
        <ChartColumn>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Request Count by Endpoint
            </h3>
            <ComparisonRequestCountByEndpointChart displayData={filteredComparisonData} mergeEndpoints={mergeEndpoints} />
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Request Count by Host
            </h3>
            <ComparisonRequestCountByHostChart displayData={filteredComparisonData} />
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Request Count by File
            </h3>
            <ComparisonRequestCountByFileChart timeSeries={comparisonTimeSeries} label={comparisonLabel} />
          </div>
        </ChartColumn>
      </ComparisonChartsGrid>

      <div id="compare-overview-charts">
        <SectionHeading>
          Performance &amp; Error Metrics Comparison
          <a href="#compare-overview-charts" className="anchor-link" onClick={(e) => handleAnchorClick(e, "compare-overview-charts")}>#</a>
        </SectionHeading>
      </div>
      <ComparisonChartsGrid>
        <ChartColumn>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Median Duration
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="median"
              />
            </QuadPanel>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - Worst 5%
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="worst5"
              />
            </QuadPanel>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - 5xx Errors
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="error5xx"
              />
            </QuadPanel>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {baselineLabel} - All Errors
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredBaselineData}
                mergeEndpoints={mergeEndpoints}
                chartType="allErrors"
              />
            </QuadPanel>
          </div>
        </ChartColumn>

        <ChartColumn>
          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Median Duration
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="median"
              />
            </QuadPanel>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - Worst 5%
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="worst5"
              />
            </QuadPanel>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - 5xx Errors
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="error5xx"
              />
            </QuadPanel>
          </div>

          <div>
            <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>
              {comparisonLabel} - All Errors
            </h3>
            <QuadPanel>
              <ComparisonChart
                displayData={filteredComparisonData}
                mergeEndpoints={mergeEndpoints}
                chartType="allErrors"
              />
            </QuadPanel>
          </div>
        </ChartColumn>
      </ComparisonChartsGrid>

      <TabContainer>
        <Tab $active={activeTab === "endpoint"} onClick={() => setActiveTab("endpoint")}>
          Endpoint Comparison
        </Tab>
        <Tab $active={activeTab === "final"} onClick={() => setActiveTab("final")}>
          Final Results Comparison
        </Tab>
      </TabContainer>

      {activeTab === "endpoint" && (
        <TabContent>
          <div id="compare-endpoint-comparison">
            <SectionHeading>
              Endpoint Comparison
              <a href="#compare-endpoint-comparison" className="anchor-link" onClick={(e) => handleAnchorClick(e, "compare-endpoint-comparison")}>#</a>
            </SectionHeading>
          </div>
          <p style={{ textAlign: "center", color: "#999", marginBottom: "1em" }}>
            Per-endpoint metrics comparison (green = improvement, red = regression)
          </p>
          <ColumnSelect className="metric-select-container">
            <label htmlFor="metrics-dropdown">Show Metrics:</label>
            <DropdownButton id="metrics-dropdown" onClick={() => setMetricsDropdownOpen(!metricsDropdownOpen)} type="button">
              <span>{visibleMetricsCount} of 9 metrics selected</span>
              <span className="arrow">{metricsDropdownOpen ? "▲" : "▼"}</span>
            </DropdownButton>
            <DropdownMenu $isOpen={metricsDropdownOpen}>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.calls} onChange={() => toggleMetric("calls")} />
                Calls
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.avg} onChange={() => toggleMetric("avg")} />
                Avg Response Time
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.min} onChange={() => toggleMetric("min")} />
                Min Response Time
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.max} onChange={() => toggleMetric("max")} />
                Max Response Time
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.stdDev} onChange={() => toggleMetric("stdDev")} />
                Std Dev
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.p50} onChange={() => toggleMetric("p50")} />
                P50
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.p90} onChange={() => toggleMetric("p90")} />
                P90
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.p95} onChange={() => toggleMetric("p95")} />
                P95
              </DropdownItem>
              <DropdownItem>
                <input type="checkbox" checked={visibleMetrics.p99} onChange={() => toggleMetric("p99")} />
                P99
              </DropdownItem>
            </DropdownMenu>
          </ColumnSelect>
          {(() => {
            // Create a map to match endpoints between baseline and comparison
            const baselineMap = new Map<string, DataPoint[]>();
            const comparisonMap = new Map<string, DataPoint[]>();

            // Build baseline map
            for (const [bucketId, dataPoints] of filteredBaselineData) {
              const key = `${bucketId.method}||${bucketId.url}`;
              if (baselineMap.has(key)) {
                baselineMap.get(key)!.push(...dataPoints);
              } else {
                baselineMap.set(key, [...dataPoints]);
              }
            }

            // Build comparison map
            for (const [bucketId, dataPoints] of filteredComparisonData) {
              const key = `${bucketId.method}||${bucketId.url}`;
              if (comparisonMap.has(key)) {
                comparisonMap.get(key)!.push(...dataPoints);
              } else {
                comparisonMap.set(key, [...dataPoints]);
              }
            }

            // Find matching endpoints
            const matchedEndpoints: {
              key: string;
              method: string;
              url: string;
              baselineData: DataPoint[];
              comparisonData: DataPoint[];
            }[] = [];

            for (const [key, baselineEndpointData] of baselineMap.entries()) {
              if (comparisonMap.has(key)) {
                const [method, url] = key.split("||");
                matchedEndpoints.push({
                  key,
                  method,
                  url,
                  baselineData: baselineEndpointData,
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
                <DataTr key={label}>
                  <DataTd>{label}</DataTd>
                  <DataTd>
                    {baselineVal !== null && baselineVal !== undefined
                      ? isCount ? baselineVal.toLocaleString() : `${baselineVal.toFixed(2)}ms`
                      : "N/A"}
                  </DataTd>
                  <DataTd>
                    {comparisonVal !== null && comparisonVal !== undefined
                      ? isCount ? comparisonVal.toLocaleString() : `${comparisonVal.toFixed(2)}ms`
                      : "N/A"}
                  </DataTd>
                  <DataTd>
                    {diff !== null ? (
                      <ChangeValue
                        $isPositive={!isCount && diff < 0}
                        $isNegative={!isCount && diff > 0}
                      >
                        {diff > 0 ? "+" : ""}{isCount ? diff.toLocaleString() : `${diff.toFixed(2)}ms`}
                        {percent !== null && ` (${diff > 0 ? "+" : ""}${percent.toFixed(1)}%)`}
                      </ChangeValue>
                    ) : "N/A"}
                  </DataTd>
                </DataTr>
              );
            };

            return matchedEndpoints.map(({ key, method, url, baselineData: endpointBaselineData, comparisonData: endpointComparisonData }, endpointIndex) => {
              // Aggregate baseline data for this endpoint
              let baselineRTT = null;
              let baselineCallCount = 0;

              for (const dp of endpointBaselineData) {
                if (baselineRTT) {
                  baselineRTT.add(dp.rttHistogram);
                } else {
                  baselineRTT = dp.rttHistogram.clone();
                }
                baselineCallCount += Number(dp.rttHistogram.getTotalCount());
              }

              // Aggregate comparison data for this endpoint
              let comparisonRTT = null;
              let comparisonCallCount = 0;

              for (const dp of endpointComparisonData) {
                if (comparisonRTT) {
                  comparisonRTT.add(dp.rttHistogram);
                } else {
                  comparisonRTT = dp.rttHistogram.clone();
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

              const endpointAnchorId = compareEndpointAnchorId(endpointIndex);
              return (
                <div key={key} id={endpointAnchorId} style={{ marginBottom: "3em" }}>
                  <SectionHeading style={{ fontSize: "1.2em", marginBottom: "0.5em" }}>
                    {method} {url}
                    <a href={`#${endpointAnchorId}`} className="anchor-link" onClick={(e) => handleAnchorClick(e, endpointAnchorId)}>#</a>
                  </SectionHeading>
                  <TableContainer>
                    <DataTable>
                      <thead>
                        <tr>
                          <Th>Metric</Th>
                          <Th title={baselineLabel}>Baseline</Th>
                          <Th title={comparisonLabel}>Comparison</Th>
                          <Th>Change</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMetrics.calls && renderMetricRow("Calls", baselineMetrics?.callCount, comparisonMetrics?.callCount, true)}
                        {visibleMetrics.avg && renderMetricRow("Avg Response Time", baselineMetrics?.avg, comparisonMetrics?.avg)}
                        {visibleMetrics.min && renderMetricRow("Min Response Time", baselineMetrics?.min, comparisonMetrics?.min)}
                        {visibleMetrics.max && renderMetricRow("Max Response Time", baselineMetrics?.max, comparisonMetrics?.max)}
                        {visibleMetrics.stdDev && renderMetricRow("Std Dev", baselineMetrics?.stdDev, comparisonMetrics?.stdDev)}
                        {visibleMetrics.p50 && renderMetricRow("P50", baselineMetrics?.p50, comparisonMetrics?.p50)}
                        {visibleMetrics.p90 && renderMetricRow("P90", baselineMetrics?.p90, comparisonMetrics?.p90)}
                        {visibleMetrics.p95 && renderMetricRow("P95", baselineMetrics?.p95, comparisonMetrics?.p95)}
                        {visibleMetrics.p99 && renderMetricRow("P99", baselineMetrics?.p99, comparisonMetrics?.p99)}
                      </tbody>
                    </DataTable>
                  </TableContainer>
                </div>
              );
            });
          })()}
        </TabContent>
      )}

      {activeTab === "final" && (
        <TabContent>
          <div id="compare-final-results">
            <SectionHeading>
              Final Results Comparison
              <a href="#compare-final-results" className="anchor-link" onClick={(e) => handleAnchorClick(e, "compare-final-results")}>#</a>
            </SectionHeading>
          </div>
          <ComparisonChartsGrid>
            <ChartColumn>
              <H2>{baselineLabel}</H2>
              <FinalResultsTable
                displayData={filteredBaselineData}
                fileLabel={baselineLabel}
                visibleColumns={visibleColumns}
                onToggleColumn={toggleColumn}
              />
            </ChartColumn>
            <ChartColumn>
              <H2>{comparisonLabel}</H2>
              <FinalResultsTable
                displayData={filteredComparisonData}
                fileLabel={comparisonLabel}
                visibleColumns={visibleColumns}
                onToggleColumn={toggleColumn}
              />
            </ChartColumn>
          </ComparisonChartsGrid>
        </TabContent>
      )}
    </Container>
  );
};

export default TestResultsCompare;
