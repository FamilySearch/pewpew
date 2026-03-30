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

export const TestResults = React.memo(({ testData }: TestResultProps) => {
  const defaultMessage = () => testData.resultsFileLocation && testData.resultsFileLocation.length > 0 ? "Select Results File" : "No Results Found";

  const [state, setState] = useState({ ...DEFAULT_STATE, defaultMessage: defaultMessage() });
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

  // Memoized summary tags calculation
  const summaryTags: BucketId = useMemo(() => {
    return state.summaryData && state.filteredData
      ? state.summaryData[0]
      : { method: getSummaryDisplay({ summaryTagFilter: "", summaryTagValueFilter: "" }), url: "" };
  }, [state.summaryData, state.filteredData]);

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
      {displayData !== undefined ? (
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
        <h4>{state.defaultMessage}</h4>
      )}
    </React.Fragment>
  );
});

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
