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
import { configure, fireEvent, getConfig, render, screen, waitFor } from "@testing-library/react";
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
    const defaultAsyncUtilTimeout = getConfig().asyncUtilTimeout;
    // What the next fetch of each file returns, keyed by the end of its URL
    let fileTexts: Record<string, string>;
    // What the next /api/test lookup returns for each merged test
    let testStatuses: Record<string, TestStatus>;
    // One-shot responses held until the test releases them, keyed by the end of the URL
    let heldRequests: Record<string, Promise<{ data: string }>>;
    let requestedUrls: string[];
    // The component's 15s poll callbacks, run by hand. Faking setInterval would also freeze waitFor's own re-checks.
    let pollCallbacks: Map<number, () => void>;
    let intervalSpies: { mockRestore: () => void }[];

    beforeEach(() => {
      fileTexts = {
        "stats-runningtest.json": statsText,
        "stats-mergetest.json": statsText,
        "stats-comparetest.json": statsText
      };
      testStatuses = { [mergeTest.testId]: TestStatus.Running };
      heldRequests = {};
      requestedUrls = [];
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        const heldKey = Object.keys(heldRequests).find((key: string) => url.endsWith(key));
        if (heldKey) {
          const held = heldRequests[heldKey];
          delete heldRequests[heldKey];
          return held;
        }
        const statusTestId = Object.keys(testStatuses).find((testId: string) => url.endsWith("testId=" + testId));
        if (statusTestId) {
          return Promise.resolve({ data: { ...mergeTest, testId: statusTestId, status: testStatuses[statusTestId] } });
        }
        const fileName = Object.keys(fileTexts).find((name: string) => url.endsWith(name));
        return fileName
          ? Promise.resolve({ data: fileTexts[fileName] })
          : Promise.reject(new Error("Unexpected url " + url));
      });
      pollCallbacks = new Map();
      // Well above jsdom's own timer ids, so clearing a real timer can never remove a poll callback
      let nextPollId = 1_000_000_000;
      const realSetInterval = globalThis.setInterval;
      const realClearInterval = globalThis.clearInterval;
      intervalSpies = [vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms?: number) => {
        if (ms !== POLL_INTERVAL) { return realSetInterval(callback, ms); }
        const id = nextPollId++;
        pollCallbacks.set(id, callback);
        return id;
      }) as typeof setInterval), vi.spyOn(globalThis, "clearInterval").mockImplementation(((id?: number) => {
        if (!pollCallbacks.delete(id!)) { realClearInterval(id); }
      }) as typeof clearInterval)];
      // The first load includes a dynamic import, which can pass the 1s default when the whole suite runs in parallel
      configure({ asyncUtilTimeout: 5000 });
    });

    afterEach(() => {
      configure({ asyncUtilTimeout: defaultAsyncUtilTimeout });
      for (const spy of intervalSpies) { spy.mockRestore(); }
      vi.mocked(axios.get).mockReset();
    });

    const poll = async () => {
      expect(pollCallbacks.size).toBe(1);
      const requestCount = requestedUrls.length;
      for (const callback of pollCallbacks.values()) { callback(); }
      await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(requestCount));
    };

    /** The next request ending in urlEnd waits until the returned function is called with its response text */
    const holdNextRequest = (urlEnd: string): ((text: string) => void) => {
      let release: (text: string) => void = () => undefined;
      heldRequests[urlEnd] = new Promise((resolve) => { release = (text: string) => resolve({ data: text }); });
      return (text: string) => release(text);
    };

    const countRequests = (fileName: string) => requestedUrls.filter((url: string) => url.endsWith(fileName)).length;

    // The same results with the first endpoint renamed, so a test can tell which version is showing
    const secondText = () => statsText.split("https://ident.pewpew.org/oauth2/v3/token").join("https://second.pewpew.org/switched");
    const mergedLabel = `Merged view: ${runningTest.testId}, ${mergeTest.testId}`;

    /** Fails if text matching pattern shows up within a second, long enough for a stale refresh to have rendered */
    const expectNotToAppear = async (pattern: RegExp) => {
      await expect(waitFor(() => expect(screen.queryAllByText(pattern)).not.toHaveLength(0), { timeout: 1000 })).rejects.toThrow();
    };

    it("keeps the merge when the base file changes", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-runningtest.json"] = secondText();
      const mergeRequests = countRequests("stats-mergetest.json");
      await poll();
      // Wait for the new data to render, then check the merge survived it
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(countRequests("stats-mergetest.json")).toBe(mergeRequests + 1);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("re-fetches the merged files on each poll even when the base file has not changed", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-mergetest.json"] = secondText();
      const baseRequests = countRequests("stats-runningtest.json");
      const mergeRequests = countRequests("stats-mergetest.json");
      await poll();
      // Only the merged file changed, so the new endpoint shows up only if the merge was rebuilt
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(countRequests("stats-mergetest.json")).toBe(mergeRequests + 1);
      expect(countRequests("stats-runningtest.json")).toBe(baseRequests + 1);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("keeps polling after switching to another results file mid-test", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      fileTexts["stats-runningtest2.json"] = statsText;
      render(<TestResults testData={twoFiles} initialResultsIndex={0} />);
      await poll();

      fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
      await waitFor(() => expect(countRequests("stats-runningtest2.json")).toBe(1));
      await poll();
      expect(countRequests("stats-runningtest2.json")).toBe(2);
    });

    it("drops a refresh of the previous file that finishes after switching files", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      // A different endpoint so the two files are told apart on screen
      fileTexts["stats-runningtest2.json"] = statsText.split("https://ident.pewpew.org/oauth2/v3/token").join("https://second.pewpew.org/switched");
      render(<TestResults testData={twoFiles} initialResultsIndex={0} />);
      await poll();
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);

      // Hold the next poll of the first file until after the switch
      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();

      fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      releasePoll(statsText + " ");
      await expectNotToAppear(/ident\.pewpew\.org/);
      expect(screen.queryAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
    });

    it("fetches the results once more when a running test finishes", async () => {
      const { rerender } = render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-runningtest.json"] = secondText();
      const baseRequests = countRequests("stats-runningtest.json");
      const mergeRequests = countRequests("stats-mergetest.json");
      // No poll: the final fetch comes from the status change
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(countRequests("stats-mergetest.json")).toBe(mergeRequests + 1);
      expect(countRequests("stats-runningtest.json")).toBe(baseRequests + 1);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("keeps polling a merged test that is still running after this test finishes", async () => {
      const { rerender } = render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      const mergeRequests = countRequests("stats-mergetest.json");
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await waitFor(() => expect(countRequests("stats-mergetest.json")).toBe(mergeRequests + 1));
      // The merged test is still running, so polling carries on
      expect(pollCallbacks.size).toBe(1);

      fileTexts["stats-mergetest.json"] = secondText();
      await poll();
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);

      // Once the merged test finishes, fetch one last time and stop
      testStatuses[mergeTest.testId] = TestStatus.Finished;
      await poll();
      await waitFor(() => expect(pollCallbacks.size).toBe(0));
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("keeps the final fetch when an older poll finishes after it", async () => {
      const { rerender } = render(<TestResults testData={runningTest} initialResultsIndex={0} />);
      await poll();
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);

      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();
      fileTexts["stats-runningtest.json"] = secondText();
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} initialResultsIndex={0} />);
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);

      releasePoll(statsText + " ");
      await expectNotToAppear(/ident\.pewpew\.org/);
      expect(screen.queryAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
    });

    it("rebuilds the merge from the newer results when the merge lands during a refresh", async () => {
      // Hold the auto-merge's fetch so the merge lands while the next poll is in flight
      const releaseMerge = holdNextRequest("stats-mergetest.json");
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      await waitFor(() => expect(countRequests("stats-mergetest.json")).toBe(1));

      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();
      releaseMerge(statsText);
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-runningtest.json"] = secondText();
      releasePoll(secondText());
      // The merged view is what's shown, so the newer results only appear if the merge was rebuilt from them
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("doesn't restore the merge when a refresh finishes after switching files", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      fileTexts["stats-runningtest2.json"] = secondText();
      const onMergeTestIdsChange = vi.fn();
      render(<TestResults testData={twoFiles} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} onMergeTestIdsChange={onMergeTestIdsChange} />);
      await poll();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();
      fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(onMergeTestIdsChange).toHaveBeenLastCalledWith(undefined);

      releasePoll(statsText + " ");
      await expectNotToAppear(/Merged view|ident\.pewpew\.org/);
    });

    it("keeps refreshing when a merged file stops parsing", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await poll();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-mergetest.json"] = "<html>Bad Gateway</html>";
      fileTexts["stats-runningtest.json"] = secondText();
      await poll();
      // The merged test falls back to its last good data, so this test's update still shows
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("keeps the compare when the base file changes", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialCompareTestId={compareTest.testId} initialCompareTestData={compareTest} />);
      await poll();
      const compareHeading = `${compareTest.testId} - Request Count by Endpoint`;
      expect(await screen.findByText(compareHeading)).toBeInTheDocument();

      fileTexts["stats-runningtest.json"] = secondText();
      const compareRequests = countRequests("stats-comparetest.json");
      await poll();
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(screen.getByText(compareHeading)).toBeInTheDocument();
      // Kept as-is, not dropped and then reloaded by the initialCompareTestId effect
      expect(countRequests("stats-comparetest.json")).toBe(compareRequests);
    });
  });
});
