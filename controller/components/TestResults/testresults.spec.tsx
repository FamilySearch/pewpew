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

  it("should show Select Results File message and a restart hint when there are multiple results files", () => {
    const multipleResults: TestData = {
      ...noResult,
      resultsFileLocation: [
        "unittest/20200424T191934978/stats-test1.json",
        "unittest/20200424T191934978/stats-test2.json"
      ],
      status: TestStatus.Finished
    };
    render(<TestResults testData={multipleResults} />);
    expect(screen.getByText("Select Results File")).toBeInTheDocument();
    expect(screen.getByTestId("results-select-hint")).toHaveTextContent("This test has 2 results files because it restarted after a failure");
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("should fall back to the only results file when ?results= is out of range", () => {
    const oneResult: TestData = {
      ...noResult,
      resultsFileLocation: ["unittest/20200424T191934978/stats-test.json"],
      status: TestStatus.Finished
    };
    render(<TestResults testData={oneResult} initialResultsIndex={3} />);
    expect(screen.getByTestId("results-select")).toHaveValue("unittest/20200424T191934978/stats-test.json");
    expect(screen.getByText("Results Loading...")).toBeInTheDocument();
  });

  it("should highlight the selector only when there are multiple files and none is chosen", () => {
    const twoResults: TestData = {
      ...noResult,
      resultsFileLocation: ["unittest/20200424T191934978/stats-test1.json", "unittest/20200424T191934978/stats-test2.json"],
      status: TestStatus.Finished
    };
    const { unmount } = render(<TestResults testData={twoResults} />);
    expect(screen.getByTestId("results-file-dropdown")).toHaveStyle("border: 2px solid #6a7bb4");
    unmount();

    render(<TestResults testData={{ ...twoResults, resultsFileLocation: [twoResults.resultsFileLocation![0]] }} />);
    fireEvent.change(screen.getByTestId("results-select"), { target: { value: "" } });
    expect(screen.getByTestId("results-file-dropdown")).not.toHaveStyle("border: 2px solid #6a7bb4");
  });

  it("should keep the restart hint while one of several results files is selected", () => {
    const twoResults: TestData = {
      ...noResult,
      resultsFileLocation: ["unittest/20200424T191934978/stats-test1.json", "unittest/20200424T191934978/stats-test2.json"],
      status: TestStatus.Finished
    };
    render(<TestResults testData={twoResults} initialResultsIndex={0} />);
    const hint = screen.getByTestId("results-select-hint");
    expect(hint).toHaveTextContent("This test has 2 results files because it restarted after a failure.");
    expect(hint).not.toHaveTextContent("Pick one");
  });

  it("should start loading automatically when there is a single results file", () => {
    const oneResult: TestData = {
      ...noResult,
      resultsFileLocation: ["unittest/20200424T191934978/stats-test.json"],
      status: TestStatus.Finished
    };
    render(<TestResults testData={oneResult} />);
    expect(screen.getByText("Results Loading...")).toBeInTheDocument();
    expect(screen.getByTestId("results-select")).toHaveValue("unittest/20200424T191934978/stats-test.json");
    expect(screen.queryByTestId("results-select-hint")).not.toBeInTheDocument();
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

  // A test can chain several waitFor calls at the 5s asyncUtilTimeout below, so it needs more than vitest's 5s default
  describe("polling a running test", { timeout: 15000 }, () => {
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

    /** Waits for the load that starts on mount (no poll needed) to fetch and render the base file */
    const initialLoad = async () => {
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(1));
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
    };

    /** Fires the poll without waiting for it to make a request */
    const tick = () => {
      expect(pollCallbacks.size).toBe(1);
      for (const callback of pollCallbacks.values()) { callback(); }
    };

    const poll = async () => {
      const requestCount = requestedUrls.length;
      tick();
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
      await initialLoad();
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
      await initialLoad();
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
      await initialLoad();

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
      await initialLoad();
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

    it("keeps a merge that lands during a refresh and rebuilds it on the next poll", async () => {
      // Hold the auto-merge's fetch so the merge lands while the next poll is in flight
      const releaseMerge = holdNextRequest("stats-mergetest.json");
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await initialLoad();
      await waitFor(() => expect(countRequests("stats-mergetest.json")).toBe(1));

      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();
      releaseMerge(statsText);
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      // The held refresh was built without the merge, so it's dropped rather than undoing the merge
      releasePoll(secondText());
      await expectNotToAppear(/second\.pewpew\.org/);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();

      // The next poll rebuilds the merge from the newer results
      fileTexts["stats-runningtest.json"] = secondText();
      await poll();
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("stops polling when the test finishes and refreshes once for the final results", async () => {
      const { rerender } = render(<TestResults testData={runningTest} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await initialLoad();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      const baseCount = countRequests("stats-runningtest.json");
      const mergeCount = countRequests("stats-mergetest.json");
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} />);
      await waitFor(() => expect(pollCallbacks.size).toBe(0));
      // One final refresh (base and merged files) picks up the seconds since the last poll, and keeps the merge
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(baseCount + 1));
      await waitFor(() => expect(countRequests("stats-mergetest.json")).toBe(mergeCount + 1));
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
      // ...and only one
      await expect(waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(baseCount + 2), { timeout: 500 })).rejects.toThrow();
    });

    it("still loads the final results when the test stops after the first load failed", async () => {
      vi.mocked(axios.get).mockImplementationOnce((url: string) => {
        requestedUrls.push(url);
        return Promise.reject(Object.assign(new Error("Request failed with status code 500"), { response: { status: 500 } }));
      });
      const { rerender } = render(<TestResults testData={runningTest} />);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(1));
      // Let the failed load settle into the error state before the test stops
      await waitFor(() => expect(screen.queryAllByText(/500/).length).toBeGreaterThan(0));
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} />);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(2));
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
    });

    it("waits for an in-flight poll before the final refresh when the test finishes with results showing", async () => {
      const { rerender } = render(<TestResults testData={runningTest} />);
      await initialLoad();
      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();
      const baseCount = countRequests("stats-runningtest.json");
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} />);
      // No overlapping fetch while the poll is still out
      await expect(waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(baseCount + 1), { timeout: 500 })).rejects.toThrow();
      releasePoll(statsText);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(baseCount + 1));
    });

    it("doesn't restore the merge when a refresh finishes after switching files", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      fileTexts["stats-runningtest2.json"] = secondText();
      const onMergeTestIdsChange = vi.fn();
      render(<TestResults testData={twoFiles} initialResultsIndex={0} initialMergeTestIds={[mergeTest.testId]} initialMergeTestData={[mergeTest]} onMergeTestIdsChange={onMergeTestIdsChange} />);
      await initialLoad();
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
      await initialLoad();
      expect(await screen.findByText(mergedLabel)).toBeInTheDocument();

      fileTexts["stats-mergetest.json"] = "<html>Bad Gateway</html>";
      fileTexts["stats-runningtest.json"] = secondText();
      await poll();
      // The merged test falls back to its last good data, so this test's update still shows
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
      expect(screen.getByText(mergedLabel)).toBeInTheDocument();
    });

    it("lets a slow poll finish instead of replacing it on the next tick", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} />);
      await initialLoad();
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);

      const releasePoll = holdNextRequest("stats-runningtest.json");
      await poll();
      // The next tick lands while the first poll is still fetching
      const requestCount = requestedUrls.length;
      tick();
      expect(requestedUrls.length).toBe(requestCount);

      releasePoll(secondText());
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
    });

    it("keeps polling the new file while a poll of the previous file is still stuck", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      fileTexts["stats-runningtest2.json"] = statsText;
      render(<TestResults testData={twoFiles} initialResultsIndex={0} />);
      await initialLoad();
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);

      // Never released, like a request that hangs
      holdNextRequest("stats-runningtest.json");
      await poll();

      fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
      await waitFor(() => expect(countRequests("stats-runningtest2.json")).toBe(1));
      fileTexts["stats-runningtest2.json"] = secondText();
      await poll();
      expect(countRequests("stats-runningtest2.json")).toBe(2);
      expect(await screen.findAllByText(/second\.pewpew\.org/)).not.toHaveLength(0);
    });

    it("keeps the compare when the base file changes", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} initialCompareTestId={compareTest.testId} initialCompareTestData={compareTest} />);
      await initialLoad();
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

    it("loads a running test's results on mount instead of waiting for the first poll", async () => {
      render(<TestResults testData={runningTest} initialResultsIndex={0} />);
      await initialLoad();
      // The poll is still set up for later refreshes
      expect(pollCallbacks.size).toBe(1);
    });

    it("waits quietly when a running test's results file is not uploaded yet", async () => {
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        return Promise.reject(Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } }));
      });
      render(<TestResults testData={runningTest} />);
      expect(await screen.findByText("Waiting for the first results...")).toBeInTheDocument();
      expect(screen.queryByText(/Request failed/)).not.toBeInTheDocument();
      // Still polling, so results show up once the agent uploads them
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        return Promise.resolve({ data: statsText });
      });
      await poll();
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
    });

    for (const status of [403, 500]) {
      it(`still shows an error for a ${status} while waiting for results`, async () => {
        vi.mocked(axios.get).mockImplementation(() =>
          Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } })));
        render(<TestResults testData={runningTest} />);
        expect(await screen.findByText(new RegExp(`status code ${status}`))).toBeInTheDocument();
        expect(screen.queryByText("Waiting for the first results...")).not.toBeInTheDocument();
      });
    }

    it("fetches a file picked from the empty option only once", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      fileTexts["stats-runningtest2.json"] = statsText;
      render(<TestResults testData={twoFiles} />);
      fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
      await expect(waitFor(() => expect(countRequests("stats-runningtest2.json")).toBeGreaterThan(1), { timeout: 1000 })).rejects.toThrow();
      expect(countRequests("stats-runningtest2.json")).toBe(1);
    });

    it("waits for the in-flight load before the final load when the test finishes during the first load", async () => {
      const releaseLoad = holdNextRequest("stats-runningtest.json");
      const { rerender } = render(<TestResults testData={runningTest} />);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(1));
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} />);
      // No overlapping fetch while the first one is still out
      await expect(waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(2), { timeout: 500 })).rejects.toThrow();
      releaseLoad(statsText);
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(2));
    });

    it("loads the final results when the test finishes while the first load finds no file yet", async () => {
      let notUploaded = true;
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        return notUploaded
          ? Promise.reject(Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } }))
          : Promise.resolve({ data: statsText });
      });
      const releaseLoad = holdNextRequest("stats-runningtest.json");
      vi.mocked(axios.get).mockImplementationOnce((url: string) => {
        requestedUrls.push(url);
        return heldRequests["stats-runningtest.json"].then(() => {
          throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
        });
      });
      const { rerender } = render(<TestResults testData={runningTest} />);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(1));
      // The agent uploads its results and the test finishes while the first load is still out
      notUploaded = false;
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Finished }} />);
      releaseLoad("");
      expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
    });

    it("reports a missing file once the test stops instead of waiting forever", async () => {
      const notFound = () => Promise.reject(Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } }));
      let releaseFirst: () => void = () => undefined;
      const firstLoad = new Promise<void>((resolve) => { releaseFirst = resolve; });
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        // The first load is still out when the test stops; it and the final load both find no file
        return requestedUrls.length === 1 ? firstLoad.then(notFound) : notFound();
      });
      const { rerender } = render(<TestResults testData={runningTest} />);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(1));
      rerender(<TestResults testData={{ ...runningTest, status: TestStatus.Failed }} />);
      releaseFirst();
      expect(await screen.findByText(/status code 404/)).toBeInTheDocument();
      expect(countRequests("stats-runningtest.json")).toBe(2);
      expect(screen.queryByText("Waiting for the first results...")).not.toBeInTheDocument();
      expect(screen.getByText("No Results Found")).toBeInTheDocument();
    });

    it("waits quietly when a file picked by hand on a running test is not uploaded yet", async () => {
      const twoFiles: TestData = {
        ...runningTest,
        resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
      };
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        return Promise.reject(Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } }));
      });
      render(<TestResults testData={twoFiles} />);
      fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
      expect(await screen.findByText("Waiting for the first results...")).toBeInTheDocument();
      expect(screen.queryByText(/status code 404/)).not.toBeInTheDocument();
    });

    it("keeps Select Results File when a cleared file's pending load returns 404", async () => {
      let releaseLoad: () => void = () => undefined;
      const pending = new Promise<void>((resolve) => { releaseLoad = resolve; });
      vi.mocked(axios.get).mockImplementation((url: string) => {
        requestedUrls.push(url);
        return pending.then(() => Promise.reject(Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } })));
      });
      render(<TestResults testData={runningTest} />);
      await waitFor(() => expect(countRequests("stats-runningtest.json")).toBe(1));
      fireEvent.change(screen.getByTestId("results-select"), { target: { value: "" } });
      await waitFor(() => expect(screen.getByText("Select Results File")).toBeInTheDocument());
      releaseLoad();
      await expectNotToAppear(/Waiting for the first results/);
      expect(screen.getByText("Select Results File")).toBeInTheDocument();
    });

    for (const status of [TestStatus.Finished, TestStatus.Failed, TestStatus.Unknown]) {
      it(`fetches a file picked from the empty option only once on a ${status} test`, async () => {
        const twoFiles: TestData = {
          ...runningTest,
          status,
          resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
        };
        fileTexts["stats-runningtest2.json"] = statsText;
        render(<TestResults testData={twoFiles} />);
        fireEvent.change(screen.getByTestId("results-select"), { target: { value: twoFiles.resultsFileLocation![1] } });
        expect(await screen.findAllByText(/ident\.pewpew\.org/)).not.toHaveLength(0);
        await expect(waitFor(() => expect(countRequests("stats-runningtest2.json")).toBeGreaterThan(1), { timeout: 1000 })).rejects.toThrow();
        expect(countRequests("stats-runningtest2.json")).toBe(1);
      });
    }

    describe("auto-selecting the only results file", () => {
      it("selects and loads a single results file without initialResultsIndex", async () => {
        render(<TestResults testData={runningTest} />);
        await initialLoad();
        expect(screen.getByTestId("results-select")).toHaveValue(runningTest.resultsFileLocation![0]);
      });

      it("selects the results file when it first appears after mount", async () => {
        const noFilesYet: TestData = { ...runningTest, resultsFileLocation: [] };
        const { rerender } = render(<TestResults testData={noFilesYet} />);
        expect(screen.getByText("No Results Found")).toBeInTheDocument();
        rerender(<TestResults testData={runningTest} />);
        await initialLoad();
      });

      it("does not re-select the file after the user picks the empty option", async () => {
        const { rerender } = render(<TestResults testData={runningTest} />);
        await initialLoad();
        fireEvent.change(screen.getByTestId("results-select"), { target: { value: "" } });
        await waitFor(() => expect(screen.getByText("Select Results File")).toBeInTheDocument());
        // A status update brings a new testData object with the same single file
        rerender(<TestResults testData={{ ...runningTest, resultsFileLocation: [...runningTest.resultsFileLocation!] }} />);
        await expectNotToAppear(/Results Loading\.\.\./);
        expect(countRequests("stats-runningtest.json")).toBe(1);
      });

      it("does not auto-select when there are multiple results files", async () => {
        const twoFiles: TestData = {
          ...runningTest,
          resultsFileLocation: [...runningTest.resultsFileLocation!, "s3/runningtest/20200311T200153210/stats-runningtest2.json"]
        };
        render(<TestResults testData={twoFiles} />);
        expect(screen.getByTestId("results-select-hint")).toBeInTheDocument();
        await expectNotToAppear(/ident\.pewpew\.org/);
        expect(requestedUrls).toHaveLength(0);
        expect(pollCallbacks.size).toBe(0);
      });
    });
  });
});
