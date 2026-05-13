vi.mock("@fs/hdr-histogram-wasm", () => {
  function makeHist () {
    return {
      getTotalCount: vi.fn(() => 100),
      getMean: vi.fn(() => 1000),
      getMaxValue: vi.fn(() => 2000),
      getMinNonZeroValue: vi.fn(() => 500),
      getStdDeviation: vi.fn(() => 100),
      getValueAtPercentile: vi.fn(() => 1500),
      add: vi.fn(),
      free: vi.fn(),
      clone: vi.fn(makeHist)
    };
  }
  return { HDRHistogram: vi.fn(makeHist) };
});
vi.mock("chart.js", () => {
  function MockChart () {
    return {
      destroy: vi.fn(),
      update: vi.fn(),
      data: { datasets: [] },
      getDatasetMeta: vi.fn(() => ({ hidden: false }))
    };
  }
  const chartFn: any = MockChart;
  chartFn.register = vi.fn();
  chartFn.defaults = { plugins: { legend: {} } };
  return {
    Chart: chartFn,
    Filler: {},
    Legend: {},
    LegendElement: {},
    LegendItem: {},
    LineController: {},
    LineElement: {},
    LinearScale: {},
    LogarithmicScale: {},
    PointElement: {},
    TimeScale: {},
    Title: {},
    Tooltip: {}
  };
});

import TestResults, { configureURL } from ".";
import { render, screen } from "@testing-library/react";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";

configureURL.baseS3Url = "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/";

describe("Test Result Component", () => {
  const noResult: TestData = {
    testId: "createtest20200424T191934978",
    s3Folder: "createtest/20200424T191934978",
    status: TestStatus.Unknown,
    startTime: 1587755974978,
    lastChecked: "2020-04-27T19:08:17.968Z"
  };

  it("should render No Results", () => {
    render(<TestResults testData={noResult} />);
    expect(screen.getByText("No Results Found")).toBeInTheDocument();
  });

  it("should render results file select when resultsFileLocation is provided", () => {
    const oneResult: TestData = {
      ...noResult,
      resultsFileLocation: [
        "unittest/20200424T191934978/stats-test.json"
      ],
      status: TestStatus.Finished
    };
    render(<TestResults testData={oneResult} />);
    expect(screen.getByTestId("results-select")).toBeInTheDocument();
  });

  it("should render Select Result File option for each results file", () => {
    const multipleResults: TestData = {
      ...noResult,
      resultsFileLocation: [
        "unittest/20200424T191934978/stats-test1.json",
        "unittest/20200424T191934978/stats-test2.json"
      ],
      status: TestStatus.Finished
    };
    render(<TestResults testData={multipleResults} />);
    expect(screen.getByText("Test Result - 0")).toBeInTheDocument();
    expect(screen.getByText("Test Result - 1")).toBeInTheDocument();
  });

  it("should show Select Results File message when results file is present but not yet selected", () => {
    const oneResult: TestData = {
      ...noResult,
      resultsFileLocation: ["unittest/20200424T191934978/stats-test.json"],
      status: TestStatus.Finished
    };
    render(<TestResults testData={oneResult} />);
    expect(screen.getByText("Select Results File")).toBeInTheDocument();
  });

  it("should show loading message when initialResultsIndex is provided", () => {
    const oneResult: TestData = {
      ...noResult,
      resultsFileLocation: ["unittest/20200424T191934978/stats-test.json"],
      status: TestStatus.Finished
    };
    render(<TestResults testData={oneResult} initialResultsIndex={0} />);
    expect(screen.getByText("Results Loading...")).toBeInTheDocument();
  });
});
