vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: "/", query: {} }) }));
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
  chartFn.getChart = vi.fn(() => null);
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
import { render, screen, waitFor } from "@testing-library/react";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import axios from "axios";
import { join } from "path";
import { readFileSync } from "fs";

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

  describe("polling a running test", () => {
    const POLL_INTERVAL = 15000;
    const statsText = readFileSync(join(__dirname, "../../public/test-results/stats-discoverywicffamilybeta20200311T200153210.json"), "utf8");
    const runningTest: TestData = {
      ...noResult,
      testId: "runningtest20200311T200153210",
      s3Folder: "runningtest/20200311T200153210",
      resultsFileLocation: ["s3/runningtest/20200311T200153210/stats-runningtest.json"],
      status: TestStatus.Running
    };
    const mergeTest: TestData = {
      ...noResult,
      testId: "mergetest20200311T200153210",
      s3Folder: "mergetest/20200311T200153210",
      resultsFileLocation: ["s3/mergetest/20200311T200153210/stats-mergetest.json"],
      status: TestStatus.Running
    };
    const compareTest: TestData = {
      ...noResult,
      testId: "comparetest20200311T200153210",
      s3Folder: "comparetest/20200311T200153210",
      resultsFileLocation: ["s3/comparetest/20200311T200153210/stats-comparetest.json"],
      status: TestStatus.Finished
    };
    // What the next fetch of each file returns, keyed by the end of its URL
    let fileTexts: Record<string, string>;
    let requestedUrls: string[];

    beforeEach(() => {
      fileTexts = {
        "stats-runningtest.json": statsText,
        "stats-mergetest.json": statsText,
        "stats-comparetest.json": statsText
      };
      requestedUrls = [];
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        const fileName = Object.keys(fileTexts).find((name: string) => url.endsWith(name));
        return fileName
          ? Promise.resolve({ data: fileTexts[fileName] })
          : Promise.reject(new Error("Unexpected url " + url));
      });
      // Only fake the poll. Parsing awaits a dynamic import that needs real timers.
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(axios.get).mockReset();
    });

    const poll = async () => {
      const requestCount = requestedUrls.length;
      vi.advanceTimersByTime(POLL_INTERVAL);
      await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(requestCount));
    };

    const countRequests = (fileName: string) => requestedUrls.filter((url: string) => url.endsWith(fileName)).length;

    it("keeps the merge when the base file changes", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      const mergedLabel = `Merged view: ${runningTest.testId}, ${mergeTest.testId}`;
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-runningtest.json"] = statsText + " ";
      const mergeRequests = countRequests("stats-mergetest.json");
      await poll();
      await waitFor(() => expect(countRequests("stats-mergetest.json")).toBe(mergeRequests + 1));
      // Let the rebuilt state render, then check the merge survived it
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("re-fetches the merged files on each poll even when the base file has not changed", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      const mergedLabel = `Merged view: ${runningTest.testId}, ${mergeTest.testId}`;
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-mergetest.json"] = statsText + " ";
      const baseRequests = countRequests("stats-runningtest.json");
      const mergeRequests = countRequests("stats-mergetest.json");
      await poll();
      await waitFor(() => expect(countRequests("stats-mergetest.json")).toBe(mergeRequests + 1));
      expect(countRequests("stats-runningtest.json")).toBe(baseRequests + 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("keeps the compare when the base file changes", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialCompareTestId={compareTest.testId} initialCompareTestData={compareTest} />);
      await poll();
      const compareHeading = `${compareTest.testId} - Request Count by Endpoint`;
      expect(await screen.findByText(compareHeading)).toBeInTheDocument();

      fileTexts["stats-runningtest.json"] = statsText + " ";
      const compareRequests = countRequests("stats-comparetest.json");
      await poll();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByText(compareHeading)).toBeInTheDocument();
      // Kept as-is, not dropped and then reloaded by the initialCompareTestId effect
      expect(countRequests("stats-comparetest.json")).toBe(compareRequests);
    });
  });
});
