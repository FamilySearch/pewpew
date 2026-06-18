import { LogLevel, log } from "@fs/ppaas-common";
import {
  PAGE_TEST_STATUS_FORMAT,
  TestData
} from "../../types";
import { assertNoPageError, getTestData, getTestDataWithResults } from "./util";

describe("GET /teststatus (Test Status Page)", () => {
  let testId: string;
  let s3Folder: string;

  before(async () => {
    const testData = await getTestData();
    testId = testData.testId;
    s3Folder = testData.s3Folder;
    log("teststatus.spec testData", LogLevel.INFO, { s3Folder, testId });
  });

  describe("Page Load", () => {
    it("should display test data for the given testId", async () => {
      const url = PAGE_TEST_STATUS_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Check the Test Status");
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(testId);
    });
  });

  describe("TestResults Dropdown", () => {
    let testDataWithResults: TestData | undefined;

    before(async () => {
      testDataWithResults = await getTestDataWithResults();
      log("teststatus.spec testDataWithResults", LogLevel.INFO, { testId: testDataWithResults?.testId });
    });

    beforeEach(function () {
      if (!testDataWithResults) { this.skip(); }
    });

    it("should display the results dropdown for a test with results", async () => {
      await browser.url(PAGE_TEST_STATUS_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await expect(select).toExist();
    });

    it("selecting a result file should load the results", async () => {
      await browser.url(PAGE_TEST_STATUS_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await select.selectByIndex(1);
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not load after selecting from dropdown" });
    });

    it("deselecting the result should hide the results", async () => {
      await browser.url(PAGE_TEST_STATUS_FORMAT(testDataWithResults!.testId));
      await assertNoPageError();
      const select = await $("[data-testid='results-select']");
      await select.selectByIndex(1);
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not load before deselect" });
      await select.selectByIndex(0);
      await resultsLoaded.waitForExist({ reverse: true, timeout: 10000, timeoutMsg: "Results did not disappear after deselecting" });
    });

    it("with ?results=0 should auto-select the first result and load it", async () => {
      const url = PAGE_TEST_STATUS_FORMAT({ testId: testDataWithResults!.testId, results: 0 });
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const resultsLoaded = await $("[data-testid='results-loaded']");
      await resultsLoaded.waitForExist({ timeout: 30000, timeoutMsg: "Results did not auto-load with ?results=0" });
    });

    it("selecting a result should update the URL to include results=0", async () => {
      await browser.url(PAGE_TEST_STATUS_FORMAT(testDataWithResults!.testId));
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
      const url = PAGE_TEST_STATUS_FORMAT({ testId: testDataWithResults!.testId, results: 0 });
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

  describe("Download Test Files", () => {
    it("should show the Download Test Files button when running as admin", async () => {
      const url = PAGE_TEST_STATUS_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const downloadButton = $("[data-testid='download-files-button']");
      await expect(downloadButton).toExist();
    });

    it("clicking Download Test Files should replace the button with download links", async () => {
      const url = PAGE_TEST_STATUS_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      await $("[data-testid='download-files-button']").click();
      // Button is replaced by a file list once the API responds (at minimum the yaml file is always present)
      await browser.waitUntil(async () => {
        return !(await $("[data-testid='download-files-button']").isExisting());
      }, { timeout: 15000, timeoutMsg: "Expected download-files-button to be replaced by file list" });
      const links = await $$("[data-testid='download-file-link']");
      expect(links.length).toBeGreaterThan(0);
      log("download rendered file links", LogLevel.INFO, { count: links.length, testId });
    });

    it("download file links should resolve to a valid download endpoint", async () => {
      const url = PAGE_TEST_STATUS_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      await $("[data-testid='download-files-button']").click();
      await browser.waitUntil(async () => {
        return !(await $("[data-testid='download-files-button']").isExisting());
      }, { timeout: 15000, timeoutMsg: "Expected download-files-button to be replaced by file list" });
      const firstLink = await $("[data-testid='download-file-link']");
      const href = await firstLink.getAttribute("href");
      expect(href).not.toBeNull();
      log("navigating to download file link", LogLevel.DEBUG, { href });
      // Navigate directly to the href — clicking triggers a file download (Content-Disposition: attachment)
      // which doesn't change the browser URL, so we use browser.url() for a reliable assertion.
      await browser.url(href!);
      const bodyText = await $("body").getText();
      expect(bodyText).not.toContain("Application error");
      expect(bodyText).not.toContain("Internal Server Error");
      log("download file link resolved successfully", LogLevel.INFO, { href });
    });
  });
});
