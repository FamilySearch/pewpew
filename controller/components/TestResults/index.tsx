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

import * as XLSX from "xlsx";
import { API_JSON, API_SEARCH, API_SEARCH_FORMAT, API_TEST_FORMAT } from "../../types";
import { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { Button, defaultButtonTheme } from "../LinkButton";
import {
  ENDPOINT,
  ENDPOINTDIV1,
  ENDPOINTDIV2,
  FLEXROW,
  H3,
  RTTDIV,
  RTTTABLE,
  UL
} from "./styled";
import { LogLevel, log } from "../../src/log";
import { MinMaxTime, comprehensiveSort, minMaxTime, parseResultsData } from "./utils";
import { ModalObject, TestsListModal, useEffectModal } from "../Modal";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TABLE, TD, TR } from "../Table";
import type { TestData, TestManagerError, TestManagerMessage } from "../../types/testmanager";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref, isTestManagerMessage } from "../../src/clientutil";
import { Chart } from "chart.js";
import { Danger } from "../Alert";
import { TestResultsCompare } from "../TestResultsCompare";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import styled from "styled-components";

const SELECT = styled.select`
  width: 150px;
`;

const TIMETAKEN = styled.div`
  text-align: left;
`;

const CANVASBOX = styled.div`
  position: relative;
  width: calc(55vw - 100px);
`;

// New Dashboard Styled Components
const QUADGRID = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  grid-gap: 1.5em;
  margin: 2em 0;
  width: 100%;
`;

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

const CUSTOMLEGEND = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 1em;
  padding-top: 1em;
  border-top: 1px solid #444;
  justify-content: center;
`;

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

const TABLECONTAINER = styled.div`
  width: 100%;
  overflow-x: auto;
  margin: 2em 0;
`;

const DATATABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: #2a2a2a;
  width: 100%;
  border-collapse: collapse;
`;

const TH = styled.th`
  padding: 8px 12px;
  text-align: left;
  background-color: #1a1a1a;
  border-bottom: 2px solid #444;
  font-weight: bold;
  white-space: normal;
  word-break: break-word;
  position: sticky;
  top: 0;
  z-index: 10;
`;

const DATATD = styled.td`
  padding: 6px 12px;
  border-bottom: 1px solid #444;
  white-space: normal;
  word-break: break-word;
  max-width: 200px;
  line-height: 1.4;
  vertical-align: top;
`;

const DATATR = styled.tr`
  &:nth-child(even) {
    background: #333;
  }
  &:hover {
    background: #404040;
  }
`;

const DOWNLOADBUTTON = styled.button`
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

export interface TestResultProps {
  testData: TestData;
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
  minMaxTime: MinMaxTime | undefined;
  error: string | undefined;
}


export interface EndpointProps {
  bucketId: BucketId;
  dataPoints: DataPoint[];
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
    <QUADPANEL>
      <h3 style={{ margin: "0 0 0.5em 0", fontSize: "14px", color: "#ccc" }}>{title}</h3>
      <canvas ref={chartRef} />
      {chart && chart.data.datasets && chart.data.datasets.length > 0 && (
        <CUSTOMLEGEND>
          {chart.data.datasets.map((dataset: any, index: number) => (
            <LEGENDITEM
              key={index}
              $hidden={hiddenDatasets.has(index)}
              onClick={() => onToggleDataset(index)}
            >
              <span className="color-box" style={{ backgroundColor: dataset.borderColor }} />
              <span>{dataset.label}</span>
            </LEGENDITEM>
          ))}
        </CUSTOMLEGEND>
      )}
    </QUADPANEL>
  );
};

// Quad Panel Charts Component
interface QuadPanelChartsProps {
  displayData: ParsedFileEntry[];
  mergeEndpoints: boolean;
}

const QuadPanelCharts: React.FC<QuadPanelChartsProps> = ({ displayData, mergeEndpoints }) => {
  const [medianChart, setMedianChart] = useState<Chart>();
  const [worst5Chart, setWorst5Chart] = useState<Chart>();
  const [error5xxChartState, setError5xxChartState] = useState<Chart>();
  const [allErrorsChartState, setAllErrorsChartState] = useState<Chart>();

  const [medianHidden, setMedianHidden] = useState<Set<number>>(new Set());
  const [worst5Hidden, setWorst5Hidden] = useState<Set<number>>(new Set());
  const [error5xxHidden, setError5xxHidden] = useState<Set<number>>(new Set());
  const [allErrorsHidden, setAllErrorsHidden] = useState<Set<number>>(new Set());

  // Process data based on mergeEndpoints flag
  const allEndpoints = useMemo(() => {
    let endpointData: [string, DataPoint[]][];

    if (mergeEndpoints) {
      // Group endpoints by method+url, merging data points at same timestamps
      const groupedMap = new Map<string, DataPoint[]>();

      for (const [bucketId, dataPoints] of displayData) {
        const label = `${bucketId.method} ${bucketId.url}`;

        if (groupedMap.has(label)) {
          const existing = groupedMap.get(label)!;
          groupedMap.set(label, mergeAllDataPoints(...existing, ...dataPoints));
        } else {
          groupedMap.set(label, dataPoints);
        }
      }

      endpointData = Array.from(groupedMap.entries());
    } else {
      // Use raw data - create label with all tags
      endpointData = displayData.map(([bucketId, dataPoints]) => {
        const tagList = Object.entries(bucketId)
          .filter(([key]) => key !== "method" && key !== "url")
          .map(([key, value]) => `${key}:${value}`)
          .join(" ");
        const label = tagList
          ? `${bucketId.method} ${bucketId.url} [${tagList}]`
          : `${bucketId.method} ${bucketId.url}`;
        return [label, dataPoints];
      });
    }

    return endpointData;
  }, [displayData, mergeEndpoints]);

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
    <QUADGRID>
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
    </QUADGRID>
  );
};

export const TestResults = React.memo(({ testData }: TestResultProps) => {
  const defaultMessage = () => testData.resultsFileLocation && testData.resultsFileLocation.length > 0 ? "Select Results File" : "No Results Found";

  const [state, setState] = useState({ ...DEFAULT_STATE, defaultMessage: defaultMessage() });
  const [mergeEndpoints, setMergeEndpoints] = useState(false);
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const compareSearchModalRef = useRef<ModalObject| null>(null);
  useEffectModal(compareSearchModalRef);

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
    updateState({
      defaultMessage: "Results Loading...",
      resultsPath: event.target.value
    });
    if (event.target.selectedIndex !== 0) {
      await updateResults(event.target.value);
    } else {
      setState((oldState: TestResultState) => {
        // Free the old data
        freeHistograms(oldState.resultsData, oldState.summaryData, oldState.compareData);
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
          error: undefined,
          minMaxTime: undefined
        };
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

  const onPriorTestLoad = async (event: React.MouseEvent<HTMLButtonElement>, compareTest: TestData) => {
    event.preventDefault();
    if (doubleClickCheckRef.current) {
      return;
    }
    try {
      doubleClickCheckRef.current = true;
      compareSearchModalRef.current?.closeModal();
      // Load the Status and find results
      const response: AxiosResponse = await axios.get(formatPageHref(API_TEST_FORMAT(compareTest.testId)));
      // It's either a TestManagerError | TestData
      log("test data response", LogLevel.DEBUG, response.data);
      const compareTestData: TestManagerError | TestData = response.data;
      if ("message" in compareTestData) {
        throw compareTestData;
      }
      const s3ResultPath = compareTestData.resultsFileLocation && compareTestData.resultsFileLocation.length > 0
        ? compareTestData.resultsFileLocation[0]
        : undefined;
      if (!s3ResultPath) {
        throw new Error(`No results path found for test ${compareTest.testId}`);
      }
      const compareText: string = await fetchResults(s3ResultPath);
      // Check if the data has changed. No need to reprocess and redraw if it didn't
      if (state.compareText === compareText) {
        log("compareText not changed", LogLevel.DEBUG);
      } else {
        setState((oldState: TestResultState) => {
          // Free the old ones
          freeHistograms(undefined, undefined, oldState.compareData);

          log("updateCompareData", LogLevel.DEBUG, { compareData: compareData?.length });
          return {
            ...oldState,
            compareTest,
            compareText: undefined,
            compareData: undefined, // Set this back to undefined while loading. Need compareData to be freed
            error: undefined
          };
        });
        // Use shared parsing utility (includes sorting)
        const compareData = await parseResultsData(compareText);
        // Update the state with the new compare data
        log("updateCompareData", LogLevel.DEBUG, { compareData: compareData?.length });
        updateState({
          compareTest,
          compareText,
          compareData
        });
      }
    } catch (error) {
      log("onPriorTestLoad error", LogLevel.ERROR, error);
      updateState({
        // message: undefined,
        error: formatError(error)
      });
      // Clear the message after 30 seconds or it never goes away
      setTimeout(() => updateState({
        error: undefined
      }), 30000);
    } finally {
      doubleClickCheckRef.current = false;
    }
  };

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

  // Memoized display data to avoid unnecessary recalculations
  const displayData = useMemo(() => {
    return state.filteredData || state.resultsData;
  }, [state.filteredData, state.resultsData]);

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

  log("displayData", LogLevel.DEBUG, { displayData: displayData?.length, filteredData: state.filteredData?.length, resultsData: state.resultsData?.length });
  return (
    <React.Fragment>
      {state.error && <Danger>{state.error}</Danger>}
      {testData &&
        testData.resultsFileLocation &&
        testData.resultsFileLocation.length > 0 && (
          <SELECT value={state.resultsPath} onChange={onResultsFileChange}>
            <option>Select Result File</option>
            {testData.resultsFileLocation.map((fileLocation, idx) => (
              <option key={fileLocation} value={fileLocation}>
                Test Result - {idx}
              </option>
            ))}
          </SELECT>
        )}
      {filteredDisplayData !== undefined ? (
        <TIMETAKEN>
          <h1>Time Taken</h1>
          <p>
            {state.minMaxTime?.startTime} to {state.minMaxTime?.endTime}
          </p>
          <p>Total time: {state.minMaxTime?.deltaTime}</p>
          <p>Compare results with: <Button onClick={onPriorTestSearch} theme={{...defaultButtonTheme, buttonFontSize: "1.2rem"}} >Prior Test</Button></p>
          {/* This is the compare search modal */}
          <TestsListModal ref={compareSearchModalRef} tests={state.compareTests} onClick={onPriorTestLoad} />
          {/* This is the compare test UI. We want it above the normal results */}
          {state.resultsData && state.compareTest && state.compareData === undefined && <H3>Loading Results {state.compareTest?.testId} for Comparison</H3>}
          {state.resultsData && state.compareData && <TestResultsCompare
            baselineData={state.compareData}
            comparisonData={state.resultsData}
            baselineLabel={state.compareTest?.testId}
            comparisonLabel={testData.testId}
          />}
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

          <FILTERCONTAINER>
            <FILTERDROPDOWN>
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
            </FILTERDROPDOWN>

            <TOGGLECONTAINER style={{ margin: 0 }}>
              <input
                type="checkbox"
                id="merge-endpoints"
                checked={mergeEndpoints}
                onChange={(e) => setMergeEndpoints(e.target.checked)}
              />
              <label htmlFor="merge-endpoints">
                Merge endpoints with different tags
              </label>
            </TOGGLECONTAINER>
          </FILTERCONTAINER>

          <h2>Performance & Error Metrics</h2>
          <QuadPanelCharts displayData={filteredDisplayData} mergeEndpoints={mergeEndpoints} />

          <h1>Final Results</h1>
          <FinalResultsTable displayData={filteredDisplayData} />

          <h1>Endpoint Data</h1>
          {filteredDisplayData.map(([bucketId, dataPoints]) => {
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

// Final Results Table Component (without Excel export)
interface TableProps {
  displayData: ParsedFileEntry[];
}

const FinalResultsTable = ({ displayData }: TableProps) => {
  const tableData = useMemo(() => {
    const results: any[] = [];

    for (const [bucketId, dataPoints] of displayData) {
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
    XLSX.utils.book_append_sheet(workbook, worksheet, "Final Results");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `performance-results-${timestamp}.xlsx`;

    // Download file
    XLSX.writeFile(workbook, filename);
  }, [tableData]);

  return (
    <>
      <DOWNLOADBUTTON onClick={exportToExcel}>
        Download as Excel
      </DOWNLOADBUTTON>
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

const Endpoint = React.memo(({ bucketId, dataPoints }: EndpointProps) => {
  const [rttButtonDisplay, setRttButtonDisplay] = useState("");
  const [totalButtonDisplay, setTotalButtonDisplay] = useState("");

  const [rttChart, setRttChart] = useState<Chart>();
  const [totalChart, setTotalChart] = useState<Chart>();

  // Memoize totalResults calculation to avoid recalculation on every render
  const totalResults = useMemo(() => total(dataPoints), [dataPoints]);

  // Create stable key for dataPoints to determine when charts need recreation
  const dataPointsKey = useMemo(() =>
    dataPoints.map(dp => `${dp.time}-${dp.rttHistogram.getTotalCount()}`).join(","),
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
          <button onClick={() => rttChart && toggleChart(rttChart)} disabled={!rttChart}>
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
          <button onClick={() => totalChart && toggleChart(totalChart)} disabled={!totalChart}>
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
});

export default TestResults;
