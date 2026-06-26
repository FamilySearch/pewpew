/**
 * TestResults Component
 *
 * Displays load test results with quad panel dashboard, charts, and data tables.
 *
 * Features:
 * - Quad panel charts (Median Duration, Worst 5%, 5xx Errors, All Errors)
 * - Custom HTML legends for better click handling
 * - Merge endpoints toggle to group by method+url
 * - Final Results table with aggregated statistics
 * - Individual endpoint details with RTT and status charts
 */

import { API_JSON, API_SEARCH, API_SEARCH_FORMAT, API_TEST_FORMAT } from "../../types";
import { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { Button, defaultButtonTheme } from "../LinkButton";
import {
  EndpointDiv,
  EndpointDiv1,
  EndpointDiv2,
  FlexRow,
  H3,
  HashAnchorLink,
  RttDiv,
  RttTable,
  StyledUl
} from "./styled";
import { ExcelResultRow, exportResultsToExcel } from "../../src/excelexport";
import { HtmlTable, HtmlTd, HtmlTr } from "../Table";
import { LogLevel, log } from "../../src/log";
import { MinMaxTime, bucketAnchorId, comprehensiveSort, minMaxTime, parseResultsData } from "./utils";
import { ModalObject, TestsListModal, useEffectModal } from "../Modal";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TestData, TestManagerError, TestManagerMessage } from "../../types/testmanager";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref, isTestManagerMessage } from "../../src/clientutil";
import { Chart } from "chart.js";
import { Danger } from "../Alert";
import { MergeSearchModal } from "./MergeSearchModal";
import { TestResultsCompare } from "../TestResultsCompare";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { mergeResults } from "./merge";
import styled from "styled-components";

const TimeTaken = styled.div`
  text-align: left;
`;

const CanvasBox = styled.div`
  position: relative;
  width: 55%;

  @media (max-width: 768px) {
    width: 100%;
  }
`;

// New Dashboard Styled Components
const QuadGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  grid-gap: 1.5em;
  margin: 2em 0;
  width: 100%;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    grid-template-rows: unset;
  }
`;

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

const FullWidthPanel = styled.div`
  position: relative;
  background-color: #2a2a2a;
  border-radius: 4px;
  padding: 1em;
  margin-bottom: 1.5em;

  h3 {
    margin: 0 0 0.5em 0;
    font-size: 14px;
    color: #ccc;
  }

  canvas {
    width: 100% !important;
    height: 260px !important;
  }
`;

const CustomLegend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 1em;
  padding-top: 1em;
  border-top: 1px solid #444;
  justify-content: center;
`;

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

const TableContainer = styled.div`
  width: 100%;
  overflow-x: auto;
  margin: 2em 0;
`;

const DataTable = styled.table`
  color: white;
  border-spacing: 0;
  background-color: #2a2a2a;
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  padding: 8px 12px;
  text-align: left;
  background-color: #1a1a1a;
  border-bottom: 2px solid #444;
  font-weight: bold;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 10;
`;

const DataTd = styled.td`
  padding: 6px 12px;
  border-bottom: 1px solid #444;
  white-space: nowrap;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
  vertical-align: top;
`;

const DataTr = styled.tr`
  &:nth-child(even) {
    background: #333;
  }
  &:hover {
    background: #404040;
  }
`;

const DownloadButton = styled.button`
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

const SectionHeading = styled.h1`
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

const SectionHeadingH2 = styled.h2`
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

export interface TestResultProps {
  testData: TestData;
  /** Auto-select this results index (0-based) on mount */
  initialResultsIndex?: number;
  /** Called when the user changes the selected results file (undefined = deselected) */
  onResultsIndexChange?: (index: number | undefined) => void;
  /** Auto-load this testId as the compare target once primary results are available */
  initialCompareTestId?: string;
  /** Pre-fetched compare TestData for Storybook. Skips the API fetch when set. */
  initialCompareTestData?: TestData;
  /** Called when the compare test selection changes (undefined = cleared) */
  onCompareTestIdChange?: (testId: string | undefined) => void;
  /** Test IDs to auto-merge on mount (from URL query param) */
  initialMergeTestIds?: string[];
  /** Called when merged test IDs change — used to sync URL query (undefined = cleared) */
  onMergeTestIdsChange?: (testIds: string[] | undefined) => void;
  /** Initial value for the "Merge endpoints with different tags" checkbox */
  initialMergeEndpoints?: boolean;
  /** Called when the merge-endpoints checkbox changes */
  onMergeEndpointsChange?: (checked: boolean) => void;
}

export interface TestResultState {
  defaultMessage: string;
  /** Filters the results Data by a tag equalling this value. I.e. 'method', 'url', '_id' */
  summaryTagFilter: string;
  /** Filters the results Data by a summaryTagFilter's value containing this value */
  summaryTagValueFilter: string;
  resultsPath: string | undefined;
  resultsText: string | undefined;
  /** All endpoints from the results file */
  resultsData: ParsedFileEntry[] | undefined;
  /** Filtered list based on the values from summaryTagFilter and summaryTagValueFilter */
  filteredData: ParsedFileEntry[] | undefined;
  /** Overall merged stats from all filteredData */
  summaryData: ParsedFileEntry | undefined;
  /** List of tests to compare against. Undefined is not searched yet, empty is no matches found */
  compareTests: TestData[] | undefined;
  /** Test to compare against */
  compareTest: TestData | undefined;
  /** string data for comparison */
  compareText: string | undefined;
  /** Parsed data for comparison */
  compareData: ParsedFileEntry[] | undefined;
  /** Merged data from multiple tests — when set, replaces the single-test view */
  mergedData: ParsedFileEntry[] | undefined;
  /** Per-file total request counts for the AgentChart when mergedData is active */
  mergedAgentTimeSeries: [string, { time: Date; count: number }[]][];
  /** IDs of the additional tests included in the merge (for the status label) */
  mergedTestIds: string[];
  minMaxTime: MinMaxTime | undefined;
  error: string | undefined;
}


export interface EndpointProps {
  bucketId: BucketId;
  dataPoints: DataPoint[];
  anchorId: string;
}

/** Let's us override for Storybook to use static files */
export const configureURL = {
  baseS3Url: API_JSON + "/"
};


const freeHistograms = (resultsData: ParsedFileEntry[] | undefined, summaryData: ParsedFileEntry | undefined, compareData: ParsedFileEntry[] | undefined) => {
  const oldData: ParsedFileEntry[] = [
    ...(resultsData || []),
    ...(summaryData ? [summaryData] : []),
    ...(compareData || [])
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

/**
 * Groups displayData by a label function, then merges DataPoints within each group
 * using one mergeAllDataPoints call per group (O(N) references, no intermediate clones).
 * The returned DataPoints are clones — call freeGroupedHistograms after chart creation.
 */
const groupAndMergeByLabel = (
  displayData: ParsedFileEntry[],
  getLabel: (bucketId: BucketId) => string
): [string, DataPoint[]][] => {
  const labelGroups = new Map<string, DataPoint[]>();
  for (const [bucketId, dataPoints] of displayData) {
    const label = getLabel(bucketId);
    if (labelGroups.has(label)) {
      labelGroups.get(label)!.push(...dataPoints);
    } else {
      labelGroups.set(label, [...dataPoints]);
    }
  }
  return Array.from(labelGroups.entries())
    .map(([label, allDps]) => [label, mergeAllDataPoints(...allDps)] as [string, DataPoint[]]);
};

const freeGroupedHistograms = (groupedData: [string, DataPoint[]][]) => {
  for (const [, dps] of groupedData) {
    for (const dp of dps) {
      try { dp.rttHistogram.free(); } catch { }
    }
  }
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
  resultsPath: undefined,
  resultsText: undefined,
  resultsData: undefined,
  filteredData: undefined,
  summaryData: undefined,
  compareTests: undefined,
  compareTest: undefined,
  compareText: undefined,
  compareData: undefined,
  mergedData: undefined,
  mergedAgentTimeSeries: [],
  mergedTestIds: [],
  minMaxTime: undefined,
  error: undefined
};
const MICROS_TO_MS = 1000;

// Chart component with custom HTML legend
interface ChartPanelProps {
  title: string;
  chartRef: React.RefCallback<HTMLCanvasElement>;
  chart: Chart | undefined;
  hiddenDatasets: Set<number>;
  onToggleDataset: (index: number) => void;
}

const ChartPanel: React.FC<ChartPanelProps> = ({ title, chartRef, chart, hiddenDatasets, onToggleDataset }) => {
  return (
    <QuadPanel>
      <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>{title}</h3>
      <canvas ref={chartRef} />
      {chart && chart.data.datasets && chart.data.datasets.length > 0 && (
        <CustomLegend>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LegendItem
              key={dataset.label || index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => onToggleDataset(index)}
            >
              <span className="color-box" style={{ backgroundColor: dataset.borderColor }} />
              <span>{dataset.label}</span>
            </LegendItem>
          ))}
        </CustomLegend>
      )}
    </QuadPanel>
  );
};

interface OverviewChartProps {
  displayData: ParsedFileEntry[];
  mergeEndpoints: boolean;
}

export const OverviewChart: React.FC<OverviewChartProps> = ({ displayData, mergeEndpoints }) => {
  const [overviewChart, setOverviewChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const overviewCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (overviewChart) { overviewChart.destroy(); }

      if (mergeEndpoints) {
        const mergedData = groupAndMergeByLabel(displayData, (b) => `${b.method} ${b.url}`);
        import("./charts").then(({ requestCountByEndpoint }) => {
          setOverviewChart(requestCountByEndpoint(node, mergedData));
          freeGroupedHistograms(mergedData);
        });
      } else {
        const endpointData: [string, DataPoint[]][] = displayData.map(([bucketId, dataPoints]) =>
          [`${bucketId.method} ${bucketId.url}`, dataPoints]
        );
        import("./charts").then(({ requestCountByEndpoint }) => {
          setOverviewChart(requestCountByEndpoint(node, endpointData));
        });
      }
    }
  }, [displayData, mergeEndpoints]);

  const onToggleDataset = useCallback((index: number) => {
    if (!overviewChart) { return; }
    const meta = overviewChart.getDatasetMeta(index);
    meta.hidden = !meta.hidden;
    overviewChart.update();
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      if (meta.hidden) { next.add(index); } else { next.delete(index); }
      return next;
    });
  }, [overviewChart]);

  return (
    <FullWidthChartPanel
      title="Request Count by Endpoint"
      chartRef={overviewCanvas}
      chart={overviewChart}
      hiddenDatasets={hiddenDatasets}
      onToggleDataset={onToggleDataset}
    />
  );
};

export const HostChart: React.FC<{ displayData: ParsedFileEntry[] }> = ({ displayData }) => {
  const [hostChart, setHostChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const hostCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (hostChart) { hostChart.destroy(); }

      const hostData = groupAndMergeByLabel(displayData, (bucketId) => {
        try { return new URL(bucketId.url).hostname; } catch { return bucketId.url; }
      });

      import("./charts").then(({ requestCountByEndpoint, mergeAgentColors }) => {
        setHostChart(requestCountByEndpoint(node, hostData, mergeAgentColors));
        freeGroupedHistograms(hostData);
      });
    }
  }, [displayData]);

  const onToggleDataset = useCallback((index: number) => {
    if (!hostChart) { return; }
    const meta = hostChart.getDatasetMeta(index);
    meta.hidden = !meta.hidden;
    hostChart.update();
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      if (meta.hidden) { next.add(index); } else { next.delete(index); }
      return next;
    });
  }, [hostChart]);

  return (
    <FullWidthChartPanel
      title="Request Count by Host"
      chartRef={hostCanvas}
      chart={hostChart}
      hiddenDatasets={hiddenDatasets}
      onToggleDataset={onToggleDataset}
    />
  );
};

export interface AgentChartProps {
  displayData: ParsedFileEntry[];
  agentTimeSeries?: [string, { time: Date; count: number }[]][];
}

export const AgentChart: React.FC<AgentChartProps> = ({ displayData, agentTimeSeries }) => {
  const [agentChart, setAgentChart] = useState<Chart>();
  const [hiddenDatasets, setHiddenDatasets] = useState<Set<number>>(new Set());

  const agentCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (agentChart) { agentChart.destroy(); }

      if (agentTimeSeries && agentTimeSeries.length > 0) {
        import("./charts").then(({ requestCountByAgentSeries, mergeAgentColors }) => {
          setAgentChart(requestCountByAgentSeries(node, agentTimeSeries, mergeAgentColors));
        });
        return;
      }

      // Fallback: group by agent/host/machine/source tag from BucketId.
      // Uses groupAndMergeByLabel (O(N) gather + one merge per group) to avoid
      // the O(N²) clone leak that an incremental loop would cause.
      const agentData = groupAndMergeByLabel(displayData, (bucketId) =>
        bucketId.agent || bucketId.host || bucketId.machine || bucketId.source || "All Agents"
      );

      import("./charts").then(({ requestCountByEndpoint, mergeAgentColors }) => {
        setAgentChart(requestCountByEndpoint(node, agentData, mergeAgentColors));
        freeGroupedHistograms(agentData);
      });
    }
  }, [displayData, agentTimeSeries]);

  const onToggleDataset = useCallback((index: number) => {
    if (!agentChart) { return; }
    const meta = agentChart.getDatasetMeta(index);
    meta.hidden = !meta.hidden;
    agentChart.update();
    setHiddenDatasets((prev) => {
      const next = new Set(prev);
      if (meta.hidden) { next.add(index); } else { next.delete(index); }
      return next;
    });
  }, [agentChart]);

  return (
    <FullWidthChartPanel
      title="Request Count by Agent"
      chartRef={agentCanvas}
      chart={agentChart}
      hiddenDatasets={hiddenDatasets}
      onToggleDataset={onToggleDataset}
    />
  );
};

const FullWidthChartPanel: React.FC<ChartPanelProps> = ({ title, chartRef, chart, hiddenDatasets, onToggleDataset }) => {
  return (
    <FullWidthPanel>
      <h3>{title}</h3>
      <canvas ref={chartRef} />
      {chart && chart.data.datasets && chart.data.datasets.length > 0 && (
        <CustomLegend>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LegendItem
              key={dataset.label || index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => onToggleDataset(index)}
            >
              <span className="color-box" style={{ backgroundColor: dataset.borderColor }} />
              <span>{dataset.label}</span>
            </LegendItem>
          ))}
        </CustomLegend>
      )}
    </FullWidthPanel>
  );
};

// Quad Panel Charts Component
interface QuadPanelChartsProps {
  displayData: ParsedFileEntry[];
  mergeEndpoints: boolean;
}

export const QuadPanelCharts: React.FC<QuadPanelChartsProps> = ({ displayData, mergeEndpoints }) => {
  const [medianChart, setMedianChart] = useState<Chart>();
  const [worst5Chart, setWorst5Chart] = useState<Chart>();
  const [error5xxChartState, setError5xxChartState] = useState<Chart>();
  const [allErrorsChartState, setAllErrorsChartState] = useState<Chart>();

  const [medianHidden, setMedianHidden] = useState<Set<number>>(new Set());
  const [worst5Hidden, setWorst5Hidden] = useState<Set<number>>(new Set());
  const [error5xxHidden, setError5xxHidden] = useState<Set<number>>(new Set());
  const [allErrorsHidden, setAllErrorsHidden] = useState<Set<number>>(new Set());

  // Process data based on mergeEndpoints flag.
  // When merging, collect all DataPoints per label first (O(N) references),
  // then merge once per group — avoids O(N²) intermediate WASM histogram clones.
  const allEndpoints = useMemo(() => {
    if (mergeEndpoints) {
      const labelGroups = new Map<string, DataPoint[]>();
      for (const [bucketId, dataPoints] of displayData) {
        const label = `${bucketId.method} ${bucketId.url}`;
        if (labelGroups.has(label)) {
          labelGroups.get(label)!.push(...dataPoints);
        } else {
          labelGroups.set(label, [...dataPoints]);
        }
      }
      return Array.from(labelGroups.entries())
        .map(([label, allDps]) => [label, mergeAllDataPoints(...allDps)] as [string, DataPoint[]]);
    }
    // Use raw data — create label with all tags
    return displayData.map(([bucketId, dataPoints]) => {
      const tagList = Object.entries(bucketId)
        .filter(([key]) => key !== "method" && key !== "url")
        .map(([key, value]) => `${key}:${value}`)
        .join(" ");
      const label = tagList
        ? `${bucketId.method} ${bucketId.url} [${tagList}]`
        : `${bucketId.method} ${bucketId.url}`;
      return [label, dataPoints] as [string, DataPoint[]];
    });
  }, [displayData, mergeEndpoints]);

  // Free merged WASM histograms when allEndpoints is recomputed or the component
  // unmounts. Chart.js extracts scalar values synchronously during chart creation
  // and does not retain references to DataPoints afterward.
  useEffect(() => {
    if (!mergeEndpoints) { return; }
    return () => {
      for (const [, dps] of allEndpoints) {
        for (const dp of dps) {
          try { dp.rttHistogram.free(); } catch { }
        }
      }
    };
  }, [allEndpoints, mergeEndpoints]);

  // Create stable key for data points
  const dataKey = useMemo(() =>
    allEndpoints.map(([label, dps]: [string, DataPoint[]]) => `${label}-${dps.length}`).join(";"),
    [allEndpoints]
  );

  const toggleDataset = useCallback((chart: Chart | undefined, index: number, hiddenSet: Set<number>, setHiddenSet: React.Dispatch<React.SetStateAction<Set<number>>>) => {
    if (!chart) {
      return;
    }
    const meta = chart.getDatasetMeta(index);
    meta.hidden = !meta.hidden;
    chart.update();

    setHiddenSet((prev: Set<number>) => {
      const newSet = new Set(prev);
      if (meta.hidden) {
        newSet.add(index);
      } else {
        newSet.delete(index);
      }
      return newSet;
    });
  }, []);

  const medianCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (medianChart) {
        medianChart.destroy();
      }
      import("./charts").then(({ medianDurationChart }) => {
        setMedianChart(medianDurationChart(node, allEndpoints));
      });
    }
  }, [dataKey, allEndpoints]);

  const worst5Canvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (worst5Chart) {
        worst5Chart.destroy();
      }
      import("./charts").then(({ worst5PercentChart }) => {
        setWorst5Chart(worst5PercentChart(node, allEndpoints));
      });
    }
  }, [dataKey, allEndpoints]);

  const error5xxCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (error5xxChartState) {
        error5xxChartState.destroy();
      }
      import("./charts").then(({ error5xxChart }) => {
        setError5xxChartState(error5xxChart(node, allEndpoints));
      });
    }
  }, [dataKey, allEndpoints]);

  const allErrorsCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) {
      if (allErrorsChartState) {
        allErrorsChartState.destroy();
      }
      import("./charts").then(({ allErrorsChart }) => {
        setAllErrorsChartState(allErrorsChart(node, allEndpoints));
      });
    }
  }, [dataKey, allEndpoints]);

  return (
    <QuadGrid>
      <ChartPanel
        title="Median Duration by Path"
        chartRef={medianCanvas}
        chart={medianChart}
        hiddenDatasets={medianHidden}
        onToggleDataset={(idx: number) => toggleDataset(medianChart, idx, medianHidden, setMedianHidden)}
      />
      <ChartPanel
        title="Worst 5% Duration by Path"
        chartRef={worst5Canvas}
        chart={worst5Chart}
        hiddenDatasets={worst5Hidden}
        onToggleDataset={(idx: number) => toggleDataset(worst5Chart, idx, worst5Hidden, setWorst5Hidden)}
      />
      <ChartPanel
        title="5xx Error Count by Path"
        chartRef={error5xxCanvas}
        chart={error5xxChartState}
        hiddenDatasets={error5xxHidden}
        onToggleDataset={(idx: number) => toggleDataset(error5xxChartState, idx, error5xxHidden, setError5xxHidden)}
      />
      <ChartPanel
        title="All Errors"
        chartRef={allErrorsCanvas}
        chart={allErrorsChartState}
        hiddenDatasets={allErrorsHidden}
        onToggleDataset={(idx: number) => toggleDataset(allErrorsChartState, idx, allErrorsHidden, setAllErrorsHidden)}
      />
    </QuadGrid>
  );
};

export const TestResults = React.memo(({ testData, initialResultsIndex, onResultsIndexChange, initialCompareTestId, initialCompareTestData, onCompareTestIdChange, initialMergeTestIds, onMergeTestIdsChange, initialMergeEndpoints, onMergeEndpointsChange }: TestResultProps) => {
  const defaultMessage = () => testData.resultsFileLocation && testData.resultsFileLocation.length > 0 ? "Select Results File" : "No Results Found";

  const [state, setState] = useState(() => {
    const init = { ...DEFAULT_STATE, defaultMessage: defaultMessage() };
    if (initialResultsIndex !== undefined && testData.resultsFileLocation?.[initialResultsIndex]) {
      init.resultsPath = testData.resultsFileLocation[initialResultsIndex];
      init.defaultMessage = "Results Loading...";
    }
    return init;
  });
  const [mergeEndpoints, setMergeEndpoints] = useState(initialMergeEndpoints ?? false);
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [endpointDataExpanded, setEndpointDataExpanded] = useState(false);
  const compareSearchModalRef = useRef<ModalObject| null>(null);
  useEffectModal(compareSearchModalRef);
  const mergeSearchModalRef = useRef<ModalObject | null>(null);
  useEffectModal(mergeSearchModalRef);
  // Keep a ref so onMergeLoad / onClearMerge can call the current callback without
  // needing it in their useCallback dependency arrays.
  const onMergeTestIdsChangeRef = useRef(onMergeTestIdsChange);
  onMergeTestIdsChangeRef.current = onMergeTestIdsChange;
  const autoMergeTriggeredRef = useRef(false);

  const updateState = (newState: Partial<TestResultState>) =>
    setState((oldState: TestResultState) => ({ ...oldState, ...newState }));

  const fetchResults = async (s3ResultPath: string): Promise<string> => {
    // s3ResultPath ends with /yamlFile/datestring/stats-name.json
    const localResultsPath: string = formatPageHref(configureURL.baseS3Url + s3ResultPath.split("/").slice(-3).join("/"));
    log("localResultsPath: " + localResultsPath, LogLevel.DEBUG);
    // https://github.com/axios/axios/issues/2791
    const response: AxiosResponse = await axios.get(localResultsPath, { responseType: "text", transformResponse: [] });

    // get the response text
    log("typeof response.data: " + typeof response.data, LogLevel.DEBUG);
    const resultsText: string = typeof response.data !== "string" && response.data !== undefined
      ? JSON.stringify(response.data) // https://github.com/axios/axios/issues/907
      : response.data;
    return resultsText;
  };

  const updateResults = async (s3ResultPath: string): Promise<void> => {
    try {
      const resultsText: string = await fetchResults(s3ResultPath);
      // Check if the data has changed. No need to reprocess and redraw if it didn't
      if (state.resultsText === resultsText) {
        log("resultsText not changed", LogLevel.DEBUG);
        return;
      }

      // Use shared parsing utility (includes sorting)
      const resultsData = await parseResultsData(resultsText);
      setState((oldState: TestResultState) => {
        // Free the old ones
        freeHistograms(oldState.resultsData, oldState.summaryData, oldState.compareData);
        // Free merged data — new base results invalidate the merge
        for (const [, dps] of (oldState.mergedData || [])) {
          for (const dp of dps) { try { dp.rttHistogram.free(); } catch { /* already freed */ } }
        }

        const startEndTime: MinMaxTime = minMaxTime(resultsData);
        const { summaryTagFilter, summaryTagValueFilter } = oldState;
        const filteredData = getFilteredEndpoints({ resultsData, summaryTagFilter, summaryTagValueFilter });
        const summaryData = getSummaryData({ filteredData: filteredData || resultsData, summaryTagFilter, summaryTagValueFilter });

        log("updateResultsData", LogLevel.DEBUG, { filteredData: filteredData?.length, resultsData: resultsData?.length, summaryData });
        return {
          ...oldState,
          resultsData,
          filteredData,
          resultsText,
          summaryData,
          compareTest: undefined,
          compareText: undefined,
          compareData: undefined,
          mergedData: undefined,
          mergedTestIds: [],
          error: undefined,
          minMaxTime: startEndTime
        };
      });
    } catch (error) {
      log("Error Fetching Data: " + s3ResultPath, LogLevel.ERROR, error);
      updateState({
        error: formatError(error)
      });
      setTimeout(() => updateState({ error: undefined}), 30000);
    }
  };

  const onResultsFileChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedIndex = event.target.selectedIndex;
    updateState({
      defaultMessage: "Results Loading...",
      resultsPath: event.target.value
    });
    if (selectedIndex !== 0) {
      await updateResults(event.target.value);
      onResultsIndexChange?.(selectedIndex - 1);
    } else {
      setState((oldState: TestResultState) => {
        // Free the old data
        freeHistograms(oldState.resultsData, oldState.summaryData, oldState.compareData);
        for (const [, dps] of (oldState.mergedData || [])) {
          for (const dp of dps) { try { dp.rttHistogram.free(); } catch { /* already freed */ } }
        }
        return {
          ...oldState,
          defaultMessage: defaultMessage(),
          resultsPath: undefined,
          resultsData: undefined,
          filteredData: undefined,
          resultsText: undefined,
          summaryData: undefined,
          compareTest: undefined,
          compareText: undefined,
          compareData: undefined,
          mergedData: undefined,
          mergedTestIds: [],
          error: undefined,
          minMaxTime: undefined
        };
      });
      onResultsIndexChange?.(undefined);
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

    setState((oldState: TestResultState) => {
      // Free the old data (only the summary)
      freeHistograms(undefined, oldState.summaryData, undefined);
      const summaryData = getSummaryData({ filteredData: filteredData || oldState.resultsData, summaryTagFilter, summaryTagValueFilter });
      return {
        ...oldState,
        [stateName]: newValue,
        filteredData,
        summaryData
      };
    });
  };

  const doubleClickCheckRef = useRef<boolean>(false);
  const onPriorTestSearch = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (doubleClickCheckRef.current) {
      return;
    }
    try {
      doubleClickCheckRef.current = true;
      // We should open the modal right away and then show a loading if we don't have compareTests yet
      if (compareSearchModalRef.current) {
        compareSearchModalRef.current.openModal();
      } else {
        log("compareModalRef is null", LogLevel.WARN);
      }
      updateState({
        error: undefined
      });
      // Check if we already have state.compareTests and just open the modal
      if (state.compareTests !== undefined) {
        return;
      }
      const searchString = testData.s3Folder.split("/")[0];
      const response: AxiosResponse = await axios.get(formatPageHref(API_SEARCH_FORMAT(searchString)));
      log("search response", LogLevel.DEBUG, response.data);
      if (Array.isArray(response.data) && response.data.length > 0) {
        // It's going to be an array of TestData that can be put into a TestList and update status like normal search
        const compareTests: TestData[] = response.data.filter((test: TestData) => test.testId !== testData.testId);
        // Pop up the modal with all the comparison options
        updateState({ compareTests });
        return;
      }
      if (!isTestManagerMessage(response.data)) {
        const errorString = API_SEARCH + " did not return a TestManagerMessage object";
        log(errorString, LogLevel.WARN, response.data);
        throw new Error(errorString);
      }
      const json: TestManagerMessage | undefined = response.data; // Could also be an empty array
      updateState({
        error: json?.message || "Could not get other results for compare"
      });
      // Clear the message after 30 seconds or it never goes away
      setTimeout(() => updateState({
        error: undefined
      }), 30000);
    } catch (error) {
      log("onPriorTestSearch error", LogLevel.ERROR, error);
      updateState({
        // message: undefined,
        error: formatError(error)
      });
      if (compareSearchModalRef.current) {
        compareSearchModalRef.current.closeModal();
      }
      // Clear the message after 30 seconds or it never goes away
      setTimeout(() => updateState({
        error: undefined
      }), 30000);
    } finally {
      doubleClickCheckRef.current = false;
    }
  };

  const loadCompareByTestId = async (testId: string, overrideTestData?: TestData): Promise<void> => {
    let compareTestData: TestData;
    if (overrideTestData) {
      compareTestData = overrideTestData;
    } else {
      const response: AxiosResponse = await axios.get(formatPageHref(API_TEST_FORMAT(testId)));
      log("test data response", LogLevel.DEBUG, response.data);
      const result: TestManagerError | TestData = response.data;
      if ("message" in result) {
        throw result;
      }
      compareTestData = result;
    }
    const s3ResultPath = compareTestData.resultsFileLocation?.[0];
    if (!s3ResultPath) {
      throw new Error(`No results path found for test ${testId}`);
    }
    const compareText: string = await fetchResults(s3ResultPath);
    if (state.compareText === compareText) {
      log("compareText not changed", LogLevel.DEBUG);
      return;
    }
    setState((oldState: TestResultState) => {
      freeHistograms(undefined, undefined, oldState.compareData);
      return {
        ...oldState,
        compareTest: compareTestData,
        compareText: undefined,
        compareData: undefined,
        error: undefined
      };
    });
    const compareData = await parseResultsData(compareText);
    log("loadCompareByTestId done", LogLevel.DEBUG, { compareData: compareData?.length });
    updateState({ compareTest: compareTestData, compareText, compareData });
  };

  const loadMergeByTestIds = async (testIds: string[]): Promise<void> => {
    const selectedTests: TestData[] = [];
    for (const testId of testIds) {
      try {
        const response: AxiosResponse = await axios.get(formatPageHref(API_TEST_FORMAT(testId)));
        const result: TestData | TestManagerError = response.data;
        if (!("message" in result) && result.resultsFileLocation?.length) {
          selectedTests.push(result as TestData);
        } else {
          log(`loadMergeByTestIds: no results for ${testId}`, LogLevel.WARN);
        }
      } catch (error) {
        log(`loadMergeByTestIds: error fetching ${testId}`, LogLevel.WARN, error);
      }
    }
    if (selectedTests.length > 0) {
      await onMergeLoad(selectedTests);
    }
  };

  const onPriorTestLoad = async (event: React.MouseEvent<HTMLButtonElement>, compareTest: TestData) => {
    event.preventDefault();
    if (doubleClickCheckRef.current) {
      return;
    }
    try {
      doubleClickCheckRef.current = true;
      compareSearchModalRef.current?.closeModal();
      await loadCompareByTestId(compareTest.testId);
      onCompareTestIdChange?.(compareTest.testId);
    } catch (error) {
      log("onPriorTestLoad error", LogLevel.ERROR, error);
      updateState({ error: formatError(error) });
      // Clear the message after 30 seconds or it never goes away
      setTimeout(() => updateState({ error: undefined }), 30000);
    } finally {
      doubleClickCheckRef.current = false;
    }
  };

  const onMergeSearch = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (mergeSearchModalRef.current) {
      mergeSearchModalRef.current.openModal();
    }
  };

  const onMergeLoad = useCallback(async (selectedTests: TestData[]): Promise<void> => {
    if (!state.resultsData) { return; }

    const allParsed: ParsedFileEntry[][] = [state.resultsData];
    const fileLabels: string[] = [testData.testId];

    for (const test of selectedTests) {
      const s3ResultPath = test.resultsFileLocation?.[0];
      if (!s3ResultPath) {
        log(`onMergeLoad: no resultsFileLocation for ${test.testId}`, LogLevel.WARN);
        continue;
      }
      try {
        const text = await fetchResults(s3ResultPath);
        const parsed = await parseResultsData(text);
        allParsed.push(parsed);
        fileLabels.push(test.testId);
      } catch (error) {
        log(`onMergeLoad: error loading ${test.testId}`, LogLevel.WARN, error);
      }
    }

    // Compute per-file request count time series before merging (mergeResults loses file identity)
    const agentTimeSeries: [string, { time: Date; count: number }[]][] = allParsed.map((fileData, i) => {
      const timeMap = new Map<number, { time: Date; count: number }>();
      for (const [, dataPoints] of fileData) {
        for (const dp of dataPoints) {
          const t = dp.time.getTime();
          const count = Number(dp.rttHistogram.getTotalCount());
          const existing = timeMap.get(t);
          if (existing) { existing.count += count; }
          else { timeMap.set(t, { time: new Date(t), count }); }
        }
      }
      const points = Array.from(timeMap.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
      return [fileLabels[i] ?? `Agent ${i + 1}`, points];
    });

    const merged = mergeResults(allParsed);

    // Free the intermediate parsed data from selected tests — mergeResults cloned what it needed
    for (let i = 1; i < allParsed.length; i++) {
      for (const [, dps] of allParsed[i]) {
        for (const dp of dps) { try { dp.rttHistogram.free(); } catch { /* already freed */ } }
      }
    }

    setState((old) => {
      // Free the previous merged data before replacing it
      for (const [, dps] of (old.mergedData || [])) {
        for (const dp of dps) { try { dp.rttHistogram.free(); } catch { } }
      }
      return { ...old, mergedData: merged, mergedAgentTimeSeries: agentTimeSeries, mergedTestIds: fileLabels };
    });
    // Sync additional testIds (all labels except the current test) to the URL
    onMergeTestIdsChangeRef.current?.(fileLabels.slice(1));
  }, [state.resultsData, testData.testId]);

  const onClearMerge = useCallback(() => {
    setState((old) => {
      for (const [, dps] of (old.mergedData || [])) {
        for (const dp of dps) { try { dp.rttHistogram.free(); } catch { } }
      }
      return { ...old, mergedData: undefined, mergedAgentTimeSeries: [], mergedTestIds: [] };
    });
    onMergeTestIdsChangeRef.current?.(undefined);
  }, []);

  useEffect(() => {
    import("chartjs-adapter-date-fns")
    .catch((error) => log("Could not load chartjs-adapter-date-fns import", LogLevel.WARN, error));
  }, []);

  useEffect(() => {
    if (
      state.resultsPath &&
      !state.resultsData &&
      !state.error &&
      testData.status === TestStatus.Running
    ) {
      const intervalId = setInterval(() => {
      updateResults(state.resultsPath!).catch((error) =>
        log("Error Fetching Data: " + state.resultsPath, LogLevel.WARN, error)
      );
      }, 15000);
      return () => clearInterval(intervalId);
    } else if (
      state.resultsPath &&
      !state.resultsData &&
      !state.error &&
      (testData.status === TestStatus.Finished || testData.status === TestStatus.Unknown || testData.status === TestStatus.Failed)
    ) {
      updateResults(state.resultsPath).catch((error) =>
        log("Error Fetching Data: " + state.resultsPath, LogLevel.WARN, error)
      );
    }
    return undefined;
  }, [testData.status, state.resultsPath]);

  useEffect(() => {
    if (initialCompareTestId && state.resultsData && !state.compareData && !state.compareTest) {
      loadCompareByTestId(initialCompareTestId, initialCompareTestData).catch((error: unknown) => {
        log("Auto-load compare error", LogLevel.WARN, error);
        updateState({ error: formatError(error) });
      });
    }
  }, [state.resultsData]);

  useEffect(() => {
    if (initialMergeTestIds?.length && state.resultsData && !state.mergedData && !autoMergeTriggeredRef.current) {
      autoMergeTriggeredRef.current = true;
      loadMergeByTestIds(initialMergeTestIds).catch((error: unknown) => {
        log("Auto-load merge error", LogLevel.WARN, error);
      });
    }
  }, [state.resultsData]);

  // Memoized display data to avoid unnecessary recalculations.
  // mergedData takes precedence — when set it replaces the single-test view.
  const displayData = useMemo(() => {
    return state.mergedData || state.filteredData || state.resultsData;
  }, [state.mergedData, state.filteredData, state.resultsData]);

  // Extract unique HTTP methods from displayData
  const availableMethods = useMemo(() => {
    if (!displayData) {
      return [];
    }
    const methods = new Set<string>();
    for (const [bucketId] of displayData) {
      if (bucketId.method) {
        methods.add(bucketId.method);
      }
    }
    return Array.from(methods).sort();
  }, [displayData]);

  // Filter displayData by selected method
  const filteredDisplayData = useMemo(() => {
    if (!displayData) {
      return displayData;
    }
    if (methodFilter === "all") {
      return displayData;
    }
    return displayData.filter(([bucketId]) => bucketId.method === methodFilter);
  }, [displayData, methodFilter]);

  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (filteredDisplayData === undefined) {
      initialScrollDoneRef.current = false;
      return;
    }
    if (initialScrollDoneRef.current) { return; }
    initialScrollDoneRef.current = true;
    const hash = window.location.hash.slice(1);
    if (!hash) { return; }
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [filteredDisplayData]);

  log("displayData", LogLevel.DEBUG, { displayData: displayData?.length, filteredData: state.filteredData?.length, resultsData: state.resultsData?.length });
  return (
    <React.Fragment>
      {state.error && <Danger>{state.error}</Danger>}
      {testData &&
        testData.resultsFileLocation &&
        testData.resultsFileLocation.length > 0 && (
          <FilterDropdown>
            <label htmlFor="results-file-select">Results File:</label>
            <select
              id="results-file-select"
              data-testid="results-select"
              value={state.resultsPath}
              onChange={onResultsFileChange}
              style={{ minWidth: "220px" }}
            >
              <option>Select Result File</option>
              {testData.resultsFileLocation.map((fileLocation, idx) => (
                <option key={fileLocation} value={fileLocation}>
                  Test Result - {idx}
                </option>
              ))}
            </select>
          </FilterDropdown>
        )}
      {filteredDisplayData !== undefined ? (
        <TimeTaken data-testid="results-loaded">
          <div id="time-taken">
            <SectionHeading>
              Time Taken
              <a href="#time-taken" className="anchor-link" onClick={(e) => handleAnchorClick(e, "time-taken")}>#</a>
            </SectionHeading>
          </div>
          <p>
            {state.minMaxTime?.startTime} to {state.minMaxTime?.endTime}
          </p>
          <p>Total time: {state.minMaxTime?.deltaTime}</p>
          <p>
            Compare results with: <Button onClick={onPriorTestSearch} theme={{...defaultButtonTheme, buttonFontSize: "1.2rem"}}>Prior Test</Button>
            {" "}
            <Button onClick={onMergeSearch} theme={{...defaultButtonTheme, buttonFontSize: "1.2rem"}}>Merge Results</Button>
            {state.mergedData && (
              <>
                {" "}
                <Button onClick={onClearMerge} theme={{...defaultButtonTheme, buttonFontSize: "1.2rem"}}>Clear Merge</Button>
                <span style={{ marginLeft: "0.8em", fontSize: "0.9em", color: "#76b7b2" }}>
                  Merged view: {state.mergedTestIds.join(", ")}
                </span>
              </>
            )}
          </p>
          {/* This is the compare search modal */}
          <TestsListModal ref={compareSearchModalRef} tests={state.compareTests} onClick={onPriorTestLoad} />
          {/* This is the merge results search modal */}
          <MergeSearchModal
            ref={mergeSearchModalRef}
            defaultSearchText={testData.s3Folder.split("/")[0]}
            currentTestId={testData.testId}
            onMerge={onMergeLoad}
          />
          {/* This is the compare test UI. We want it above the normal results */}
          {state.resultsData && state.compareTest && state.compareData === undefined && <H3>Loading Results {state.compareTest?.testId} for Comparison</H3>}
          {state.resultsData && state.compareData && <TestResultsCompare
            baselineData={state.compareData}
            comparisonData={state.resultsData}
            baselineLabel={state.compareTest?.testId}
            comparisonLabel={testData.testId}
          />}
          <div id="overview-charts">
            <SectionHeading>
              Overview charts
              <a href="#overview-charts" className="anchor-link" onClick={(e) => handleAnchorClick(e, "overview-charts")}>#</a>
            </SectionHeading>
          </div>
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

          <FilterContainer>
            <FilterDropdown>
              <label htmlFor="method-filter">Filter by Method:</label>
              <select
                id="method-filter"
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
                id="merge-endpoints"
                checked={mergeEndpoints}
                onChange={(e) => {
                  setMergeEndpoints(e.target.checked);
                  onMergeEndpointsChange?.(e.target.checked);
                }}
              />
              <label htmlFor="merge-endpoints">
                Merge endpoints with different tags
              </label>
            </ToggleContainer>
          </FilterContainer>

          <div id="request-count-charts">
            <SectionHeadingH2>
              Request Count Overview
              <a href="#request-count-charts" className="anchor-link" onClick={(e) => handleAnchorClick(e, "request-count-charts")}>#</a>
            </SectionHeadingH2>
          </div>
          <OverviewChart displayData={filteredDisplayData} mergeEndpoints={mergeEndpoints} />
          <HostChart displayData={filteredDisplayData} />
          <AgentChart displayData={filteredDisplayData} agentTimeSeries={state.mergedAgentTimeSeries.length > 0 ? state.mergedAgentTimeSeries : undefined} />

          <div id="performance-metrics">
            <SectionHeadingH2>
              Performance &amp; Error Metrics
              <a href="#performance-metrics" className="anchor-link" onClick={(e) => handleAnchorClick(e, "performance-metrics")}>#</a>
            </SectionHeadingH2>
          </div>
          <QuadPanelCharts displayData={filteredDisplayData} mergeEndpoints={mergeEndpoints} />

          <div id="final-results">
            <SectionHeading>
              Final Results
              <a href="#final-results" className="anchor-link" onClick={(e) => handleAnchorClick(e, "final-results")}>#</a>
            </SectionHeading>
          </div>
          <FinalResultsTable displayData={filteredDisplayData} />

          <div id="endpoint-data">
            <SectionHeading>
              <button
                onClick={() => setEndpointDataExpanded((prev) => !prev)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8em", padding: "0 0.3em 0 0", verticalAlign: "middle", color: "inherit" }}
                aria-expanded={endpointDataExpanded}
                aria-controls="endpoint-data-content"
              >
                {endpointDataExpanded ? "▼" : "▶"}
              </button>
              Endpoint Data
              <a href="#endpoint-data" className="anchor-link" onClick={(e) => handleAnchorClick(e, "endpoint-data")}>#</a>
            </SectionHeading>
          </div>
          {endpointDataExpanded && (
            <div id="endpoint-data-content">
              {filteredDisplayData.map(([bucketId, dataPoints], index) => {
                const anchorId = bucketAnchorId(bucketId, index);
                return (
                  <Endpoint key={JSON.stringify(bucketId)} bucketId={bucketId} dataPoints={dataPoints} anchorId={anchorId} />
                );
              })}
            </div>
          )}
        </TimeTaken>
      ) : (
        <h4>{state.defaultMessage}</h4>
      )}
    </React.Fragment>
  );
});

// Final Results Table Component (without Excel export)
export interface TableProps {
  displayData: ParsedFileEntry[];
}

export const FinalResultsTable = ({ displayData }: TableProps) => {
  const tableData = useMemo(() => {
    const results: any[] = [];

    for (const [index, [bucketId, dataPoints]] of displayData.entries()) {
      if (dataPoints.length === 0) { continue; }

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

      // Filter out method and url from tags since they're already in separate columns
      const { method: _, url: __, ...otherTags } = bucketId;
      const tagsString = JSON.stringify(otherTags);

      results.push({
        anchorId: bucketAnchorId(bucketId, index),
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
        time: dataPoints[dataPoints.length - 1].time // Last timestamp
      });

      // Free cloned histogram
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
    exportResultsToExcel(excelData, `performance-results-${timestamp}.xlsx`, "Final Results")
    .catch((error) => log("Error exporting to Excel", LogLevel.ERROR, error));
  }, [tableData]);

  return (
    <>
      <DownloadButton onClick={exportToExcel}>
        Download as Excel
      </DownloadButton>
      <TableContainer>
        <DataTable>
        <thead>
          <tr>
            <Th style={{ width: "24px", padding: "8px 4px" }}></Th>
            <Th>method</Th>
            <Th>hostname</Th>
            <Th>path</Th>
            <Th>queryString</Th>
            <Th>tags</Th>
            <Th>statusCount</Th>
            <Th>callCount</Th>
            <Th>p50</Th>
            <Th>p95</Th>
            <Th>p99</Th>
            <Th>min</Th>
            <Th>max</Th>
            <Th>stddev</Th>
            <Th>_time</Th>
          </tr>
        </thead>
        <tbody>
          {tableData.map((row) => (
            <DataTr key={`${row.method}-${row.hostname}-${row.path}-${row.queryString}-${row.tags}`}>
              <DataTd style={{ padding: "6px 4px", textAlign: "center" }}>
                <a
                  href={`#${row.anchorId}`}
                  title="Jump to endpoint detail"
                  style={{ color: "#666", textDecoration: "none", fontSize: "0.85em" }}
                  onClick={(e) => handleAnchorClick(e, row.anchorId)}
                >#</a>
              </DataTd>
              <DataTd>{row.method}</DataTd>
              <DataTd title={row.hostname}>{row.hostname}</DataTd>
              <DataTd title={row.path}>{row.path}</DataTd>
              <DataTd>{row.queryString}</DataTd>
              <DataTd title={row.tags}>{row.tags}</DataTd>
              <DataTd>
                {row.statusCounts.map((sc: any) => (
                  <div key={sc.status}>{sc.status}: {sc.count.toLocaleString()}</div>
                ))}
              </DataTd>
              <DataTd>{row.callCount.toLocaleString()}</DataTd>
              <DataTd>{row.p50.toFixed(2)}</DataTd>
              <DataTd>{row.p95.toFixed(2)}</DataTd>
              <DataTd>{row.p99.toFixed(2)}</DataTd>
              <DataTd>{row.min.toFixed(2)}</DataTd>
              <DataTd>{row.max.toFixed(2)}</DataTd>
              <DataTd>{row.stddev.toFixed(2)}</DataTd>
              <DataTd>{row.time.toLocaleString()}</DataTd>
            </DataTr>
          ))}
        </tbody>
      </DataTable>
    </TableContainer>
    </>
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

const Endpoint = React.memo(({ bucketId, dataPoints, anchorId }: EndpointProps) => {
  const [rttButtonDisplay, setRttButtonDisplay] = useState("");
  const [totalButtonDisplay, setTotalButtonDisplay] = useState("");

  const [rttChart, setRttChart] = useState<Chart>();
  const [totalChart, setTotalChart] = useState<Chart>();

  // Memoize totalResults calculation to avoid recalculation on every render
  const totalResults = useMemo(() => total(dataPoints), [dataPoints]);

  // Create stable key for dataPoints to determine when charts need recreation.
  // dp.time is a plain JS Date, so this avoids N WASM calls per render per endpoint.
  const dataPointsKey = useMemo(() =>
    dataPoints.map(dp => dp.time.getTime()).join(","),
    [dataPoints]
  );

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
  }, [dataPointsKey, dataPoints]); // Stable key + dataPoints for actual chart creation

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
  }, [dataPointsKey, dataPoints]); // Stable key + dataPoints for actual chart creation

  return (
    <React.Fragment>
      <EndpointDiv id={anchorId}>
        <H3>
          {bucketId.method} {bucketId.url}
          <HashAnchorLink href={`#${anchorId}`} onClick={(e) => handleAnchorClick(e, anchorId)}>#</HashAnchorLink>
        </H3>
        <StyledUl>
          {Object.entries(bucketId).map(([key, value]) => {

            if (key !== "method" && key !== "url") {
              return (
                <li key={key}>
                  {key} - {value}
                </li>
              );
            }
            return undefined; // fixes typescript error: Not all code paths return a value.
          })}
        </StyledUl>
        <EndpointDiv1>
          <h3>Endpoint Summary</h3>
          {totalResults && <FlexRow>
            <RttTable>
              <h5>RTT Stats</h5>
              <HtmlTable>
                <tbody>
                  {totalResults.stats.map(([label, stat]) => {
                    return (
                      <HtmlTr key={String(label)}>
                        <HtmlTd>{label}</HtmlTd>
                        <HtmlTd>{stat.toLocaleString()}ms</HtmlTd>
                      </HtmlTr>
                    );
                  })}
                </tbody>
              </HtmlTable>
            </RttTable>
            <EndpointDiv1>
              <h5>HTTP Status Counts and Errors</h5>
              <HtmlTable>
                <tbody>
                  {totalResults.statusCounts.map(
                    ([status, count, percent]) => {
                      return (
                        <HtmlTr key={String(status)}>
                          <HtmlTd>{status}</HtmlTd>
                          <HtmlTd>{count.toLocaleString()}</HtmlTd>
                          <HtmlTd>
                            {percent
                              ? (percent * 100).toFixed(1) + "%"
                              : undefined}
                          </HtmlTd>
                        </HtmlTr>
                      );
                    }
                  )}
                </tbody>
              </HtmlTable>
              {totalResults.otherErrors.length > 0 ? (
                <div>
                  <h5>Other Errors</h5>
                  <HtmlTable>
                    <tbody>
                      {totalResults.otherErrors.map(([msg, count]) => {
                        return (
                          <HtmlTr key={msg}>
                            <HtmlTd title={msg}>{msg}</HtmlTd>
                            <HtmlTd>{count}</HtmlTd>
                          </HtmlTr>
                        );
                      })}
                    </tbody>
                  </HtmlTable>
                </div>
              ) : (
                  undefined
                )}
            </EndpointDiv1>
          </FlexRow>}
        </EndpointDiv1>
        <FlexRow>
        <RttDiv>
          <h3>RTT Stats</h3>
          <button onClick={() => rttChart && toggleChart(rttChart)} disabled={!rttChart}>
            Switch to {rttButtonDisplay}
          </button>
          <EndpointDiv2>
            <CanvasBox>
              <canvas ref={rttCanvas} />
            </CanvasBox>
          </EndpointDiv2>
        </RttDiv>
        <EndpointDiv1>
          <h3>HTTP Status Counts and Errors</h3>
          <button onClick={() => totalChart && toggleChart(totalChart)} disabled={!totalChart}>
            Switch to {totalButtonDisplay}
          </button>
          <EndpointDiv2>
            <CanvasBox>
              <canvas ref={totalCanvas} />
            </CanvasBox>
          </EndpointDiv2>
        </EndpointDiv1>
      </FlexRow>
      </EndpointDiv>
    </React.Fragment>
  );
});

export default TestResults;
