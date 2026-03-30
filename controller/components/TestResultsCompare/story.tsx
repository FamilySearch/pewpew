import type { Meta, StoryFn } from "@storybook/react";
import React, { useEffect, useState } from "react";
import { GlobalStyle } from "../Layout";
import { ParsedFileEntry } from "../TestResults/model";
import { TestResultsCompare } from ".";
import axios from "axios";
import { parseResultsData } from "../TestResults/utils";

// Test result file paths
const TEST_RESULTS = {
  DISCOVERY_RUN_1: "test-results/stats-discoverywicffamilybeta20200311T194618937.json",
  DISCOVERY_RUN_2: "test-results/stats-discoverywicffamilybeta20200311T200153210.json",
  DISCOVERY_GOOD: "test-results/stats-discoverywicffamilybeta20200311T221932362.json",
  RMS_ALL_STAGE: "test-results/stats-rmsallstage20220603T012101115.json",
  DEEPZOOM_TEST_1: "test-results/stats-deepzoomcloudtest20250630T180711861.json",
  DEEPZOOM_TEST_2: "test-results/stats-deepzoomcloudtest20250829T144939352.json"
};

// Hook to load and parse data from file path
const useResultsDataFromFile = (filePath: string) => {
  const [parsedData, setParsedData] = useState<ParsedFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setParsedData([]);
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        const response = await axios.get(filePath, {
          responseType: "text",
          transformResponse: []
        });

        const resultsText = typeof response.data !== "string" && response.data !== undefined
          ? JSON.stringify(response.data)
          : response.data;

        const parsed = await parseResultsData(resultsText);
        setParsedData(parsed);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Failed to load ${filePath}:`, error);
        setParsedData([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [filePath]);

  return { parsedData, loading };
};

export default {
  title: "TestResultsCompare"
} as Meta<typeof TestResultsCompare>;

export const EmptyComparison: StoryFn = () => {
  const { parsedData: baselineData } = useResultsDataFromFile("");
  const { parsedData: comparisonData } = useResultsDataFromFile("");

  return (
    <React.Fragment>
      <GlobalStyle />
      <TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />
    </React.Fragment>
  );
};

export const CompareDiscoveryRuns: StoryFn = () => {
  const { parsedData: baselineData, loading: baselineLoading } = useResultsDataFromFile(TEST_RESULTS.DISCOVERY_RUN_1);
  const { parsedData: comparisonData, loading: comparisonLoading } = useResultsDataFromFile(TEST_RESULTS.DISCOVERY_RUN_2);

  if (baselineLoading || comparisonLoading) {
    return <div>Loading...</div>;
  }

  return (
    <React.Fragment>
      <GlobalStyle />
      <TestResultsCompare
        baselineData={baselineData}
        comparisonData={comparisonData}
        baselineLabel="Discovery Run 1 (19:46)"
        comparisonLabel="Discovery Run 2 (20:01) - With Errors"
      />
    </React.Fragment>
  );
};

export const CompareDiscoveryRunsSame: StoryFn = () => {
  const { parsedData: baselineData, loading: baselineLoading } = useResultsDataFromFile(TEST_RESULTS.DISCOVERY_RUN_1);
  const { parsedData: comparisonData, loading: comparisonLoading } = useResultsDataFromFile(TEST_RESULTS.DISCOVERY_RUN_1);

  if (baselineLoading || comparisonLoading) {
    return <div>Loading...</div>;
  }

  return (
    <React.Fragment>
      <GlobalStyle />
      <TestResultsCompare
        baselineData={baselineData}
        comparisonData={comparisonData}
        baselineLabel="Discovery Run 1 (19:46)"
        comparisonLabel="Discovery Run 2 (19:46)"
      />
    </React.Fragment>
  );
};

export const CompareDiscoveryGoodVsBad: StoryFn = () => {
  const { parsedData: baselineData, loading: baselineLoading } = useResultsDataFromFile(TEST_RESULTS.DISCOVERY_GOOD);
  const { parsedData: comparisonData, loading: comparisonLoading } = useResultsDataFromFile(TEST_RESULTS.DISCOVERY_RUN_2);

  if (baselineLoading || comparisonLoading) {
    return <div>Loading...</div>;
  }

  return (
    <React.Fragment>
      <GlobalStyle />
      <TestResultsCompare
        baselineData={baselineData}
        comparisonData={comparisonData}
        baselineLabel="Discovery Good Run (22:19)"
        comparisonLabel="Discovery Bad Run (20:01)"
      />
    </React.Fragment>
  );
};

export const LargeResultComparison: StoryFn = () => {
  const { parsedData: baselineData, loading: baselineLoading } = useResultsDataFromFile(TEST_RESULTS.DEEPZOOM_TEST_1);
  const { parsedData: comparisonData, loading: comparisonLoading } = useResultsDataFromFile(TEST_RESULTS.DEEPZOOM_TEST_2);

  if (baselineLoading || comparisonLoading) {
    return <div>Loading...</div>;
  }

  return (
    <React.Fragment>
      <GlobalStyle />
      <TestResultsCompare
        baselineData={baselineData}
        comparisonData={comparisonData}
        baselineLabel="DeepZoom Test 1"
        comparisonLabel="DeepZoom Test 2"
      />
    </React.Fragment>
  );
};