import { LogLevel, log } from "@fs/ppaas-common";
import {
  PAGE_TEST_HISTORY,
  PAGE_TEST_HISTORY_FORMAT,
  TestData
} from "../../types";
import { assertNoPageError, getTestData, getTestDataWithResults } from "./util";

describe("GET / (Test History Page)", () => {
  let testId: string;
  let s3Folder: string;

  before(async () => {
    const testData = await getTestData();
    testId = testData.testId;
    s3Folder = testData.s3Folder;
    log("index.spec testData", LogLevel.INFO, { s3Folder, testId });
  });

  describe("Page Load", () => {
    it("should load the page with the test status heading", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Check the Test Status");
    });

    it("should display the search form", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const searchInput = await $("[data-testid='search-input']");
      await expect(searchInput).toExist();
      const bodyText = await $("body").getText();
      expect(bodyText).toContain("Search for S3Folder:");
    });

    it("should display the test status sections", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const runningTests = await $("[data-testid='running-tests']");
      await expect(runningTests).toExist();
      const recentlyRunTests = await $("[data-testid='recently-run-tests']");
      await expect(recentlyRunTests).toExist();
      const recentlyViewedTests = await $("[data-testid='recently-viewed-tests']");
      await expect(recentlyViewedTests).toExist();
    });
  });

  describe("Query Parameters", () => {
    it("with ?testId= should display test data", async () => {
      const url = PAGE_TEST_HISTORY_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Check the Test Status");
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(testId);
    });

    it("with ?search= partial s3Folder should display search results", async () => {
      const partialSearch = s3Folder.split("/")[0];
      const url = `${PAGE_TEST_HISTORY}?search=${encodeURIComponent(partialSearch)}`;
      log(`navigating to ${url}`, LogLevel.INFO);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Check the Test Status");
      // Verify "Tests Found in S3" heading exists
      const searchHeading = await $("[data-testid='search-results']");
      await expect(searchHeading).toExist();
      // Verify testId appears as a link in the search results list (not just in running/recent tests)
      const searchResultLink = await $(`button[name='${testId}']`);
      await expect(searchResultLink).toExist();
    });

    it("with ?search= full s3Folder should display search results", async () => {
      const url = `${PAGE_TEST_HISTORY}?search=${encodeURIComponent(s3Folder)}`;
      log(`navigating to ${url}`, LogLevel.INFO);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Check the Test Status");
      // Verify "Tests Found in S3" heading exists
      const searchHeading = await $("[data-testid='search-results']");
      await expect(searchHeading).toExist();
      // Verify testId appears as a link in the search results list
      const searchResultLink = await $(`button[name='${testId}']`);
      await expect(searchResultLink).toExist();
    });
  });

  describe("TestResults Dropdown", () => {
    let testDataWithResults: TestData | undefined;

    before(async () => {
      testDataWithResults = await getTestDataWithResults();
      log("index.spec testDataWithResults", LogLevel.INFO, { testId: testDataWithResults?.testId });
    });

    beforeEach(function () {
      if (!testDataWithResults) { this.skip(); }
    });

    it("should display the results dropdown for a test with results", async () => {
      await browser.url(PAGE_TEST_HISTORY_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await expect(select).toExist();
    });

    it("selecting a result file should load the results", async () => {
      await browser.url(PAGE_TEST_HISTORY_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await select.selectByIndex(1);
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not load after selecting from dropdown" });
    });

    it("deselecting the result should hide the results", async () => {
      await browser.url(PAGE_TEST_HISTORY_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await select.selectByIndex(1);
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not load before deselect" });
      await select.selectByIndex(0);
      await resultsLoaded.waitForExist({ reverse: true, timeout: 10000, timeoutMsg: "Results did not disappear after deselecting" });
    });

    it("with ?results=0 should auto-select the first result and load it", async () => {
      const url = `${PAGE_TEST_HISTORY_FORMAT(testDataWithResults!.testId)}&results=0`;
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not auto-load with ?results=0" });
    });

    it("selecting a result should update the URL to include results=0", async () => {
      await browser.url(PAGE_TEST_HISTORY_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await select.selectByIndex(1);
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not load" });
      await browser.waitUntil(async () => {
        const currentUrl = await browser.getUrl();
        return currentUrl.includes("results=0");
      }, { timeout: 5000, timeoutMsg: "URL did not update to include results=0 after selecting" });
    });

    it("deselecting should remove results= from the URL", async () => {
      const url = `${PAGE_TEST_HISTORY_FORMAT(testDataWithResults!.testId)}&results=0`;
      await browser.url(url);
      await assertNoPageError();
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not auto-load" });
      const select = await $("[data-testid='results-select']");
      await select.selectByIndex(0);
      await resultsLoaded.waitForExist({ reverse: true, timeout: 10000, timeoutMsg: "Results did not disappear after deselecting" });
      await browser.waitUntil(async () => {
        const currentUrl = await browser.getUrl();
        return !currentUrl.includes("results=");
      }, { timeout: 5000, timeoutMsg: "URL still contains results= after deselecting" });
    });
  });

  describe("Interactions", () => {
    it("typing in the search box and submitting should display results", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const searchInput = await $("[data-testid='search-input']");
      const partialSearch = s3Folder.split("/")[0];
      await searchInput.setValue(partialSearch);
      // Submit the form (press Enter)
      await browser.keys("Enter");
      // Wait for "Tests Found in S3" heading to appear
      const searchHeading = await $("[data-testid='search-results']");
      await searchHeading.waitForExist({ timeout: 10000, timeoutMsg: "Expected search results to appear" });
      // Verify testId appears as a link in the search results list
      const searchResultLink = await $(`button[name='${testId}']`);
      await expect(searchResultLink).toExist();
    });

    it("searching for a non-existent test should display not found message", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const searchInput = await $("[data-testid='search-input']");
      await searchInput.setValue("nonexistenttestname");
      await browser.keys("Enter");
      // Wait for the error message
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("No s3Folders found starting with");
      }, { timeout: 10000, timeoutMsg: "Expected 'no results found' message" });
    });
  });
});
