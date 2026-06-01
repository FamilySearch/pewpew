import { LogLevel, log } from "@fs/ppaas-common";
import { assertNoPageError, getTestData } from "./util";
import {
  PAGE_TEST_HISTORY
} from "../../types";

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
    it("with ?search= partial s3Folder should display search results", async () => {
      const partialSearch = s3Folder.split("/")[0];
      const url = `${PAGE_TEST_HISTORY}?search=${encodeURIComponent(partialSearch)}`;
      log(`navigating to ${url}`, LogLevel.INFO);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Check the Test Status");
      const searchHeading = await $("[data-testid='search-results']");
      await expect(searchHeading).toExist();
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
      const searchHeading = await $("[data-testid='search-results']");
      await expect(searchHeading).toExist();
      const searchResultLink = await $(`button[name='${testId}']`);
      await expect(searchResultLink).toExist();
    });
  });

  describe("Interactions", () => {
    it("typing in the search box and submitting should display results", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const searchInput = await $("[data-testid='search-input']");
      const partialSearch = s3Folder.split("/")[0];
      await searchInput.setValue(partialSearch);
      await browser.keys("Enter");
      const searchHeading = await $("[data-testid='search-results']");
      await searchHeading.waitForExist({ timeout: 10000, timeoutMsg: "Expected search results to appear" });
      const searchResultLink = await $(`button[name='${testId}']`);
      await expect(searchResultLink).toExist();
    });

    it("searching for a non-existent test should display not found message", async () => {
      await browser.url(PAGE_TEST_HISTORY);
      await assertNoPageError();
      const searchInput = await $("[data-testid='search-input']");
      await searchInput.setValue("nonexistenttestname");
      await browser.keys("Enter");
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("No s3Folders found starting with");
      }, { timeout: 10000, timeoutMsg: "Expected 'no results found' message" });
    });
  });
});
