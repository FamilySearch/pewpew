import { LogLevel, log } from "@fs/ppaas-common";
import {
  PAGE_START_TEST,
  PAGE_START_TEST_FORMAT
} from "../../types";
import { assertNoPageError, getTestData } from "./util";

describe("GET /test (Start Test Page)", () => {
  let testId: string;

  before(async () => {
    const testData = await getTestData();
    testId = testData.testId;
    log("test.spec testData", LogLevel.INFO, { testId });
  });

  describe("Page Load", () => {
    it("should load the page with the start test heading", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Run a new test");
    });
  });

  describe("Query Parameters", () => {
    it("with ?testId= should pre-populate with previous test data", async () => {
      const url = PAGE_START_TEST_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Run a new test");
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(testId);
    });
  });

  describe("Interactions", () => {
    it("clicking 'Add Environment Variable' should add a new variable row", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Click the Add Environment Variable button
      const addButton = await $("[data-testid='add-env-var-button']");
      await expect(addButton).toExist();
      await addButton.click();
      // Each env var row has an input with name ending in _variableName
      await browser.waitUntil(async () => {
        const vars = $$("[data-testid='env-vars-list'] input[data-testid^='env-var-name-']");
        return (await vars.length) >= 1;
      }, { timeout: 3000, timeoutMsg: "Expected a new environment variable row to be added" });
      // Verify the warning message appears
      const envWarning = await $("[data-testid='env-vars-warning']");
      await expect(envWarning).toExist();
    });

    it("clicking 'Add Environment Variable' twice should add two variable rows", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const addButton = await $("[data-testid='add-env-var-button']");
      await addButton.click();
      await addButton.click();
      // Each env var row has an input with name ending in _variableName
      await browser.waitUntil(async () => {
        const vars = $$("[data-testid='env-vars-list'] input[data-testid^='env-var-name-']");
        return (await vars.length) >= 2;
      }, { timeout: 3000, timeoutMsg: "Expected at least 2 environment variable rows" });
    });

    it("clicking 'Restart on Failure' toggle should change its state", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const label = await $("[data-testid='checkbox-restartOnFailure']");
      await expect(label).toExist();
      // Default is N (off)
      await expect(label).toHaveText("N");
      await label.click();
      await expect(label).toHaveText("Y");
      // Click again to toggle back
      await label.click();
      await expect(label).toHaveText("N");
    });

    it("selecting 'In the future' should reveal the schedule date picker and recurring option", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const bodyText = await $("body").getText();
      // "In the future" radio should be visible
      expect(bodyText).toContain("In the future");
      // Recurring should not be visible yet
      expect(bodyText).not.toContain("Recurring");
      // Click the "In the future" radio
      const futureRadio = await $("[data-testid='schedule-future-radio']");
      await futureRadio.click();
      // Date picker should appear (react-datepicker renders an input)
      const datePicker = await $(".react-datepicker__input-container input");
      await expect(datePicker).toExist();
      // Recurring option should now be visible
      const updatedText = await $("body").getText();
      expect(updatedText).toContain("Recurring");
      expect(updatedText).toContain("Run Date");
      // End Date and Days Of Week should not be visible yet (Recurring defaults to No)
      expect(updatedText).not.toContain("End Date");
      expect(updatedText).not.toContain("Days Of Week");
    });

    it("selecting 'Recurring Yes' should reveal end date and days of week", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Select "In the future" first
      const futureRadio = await $("[data-testid='schedule-future-radio']");
      await futureRadio.click();
      // Verify Recurring option appeared
      const recurringText = await $("body").getText();
      expect(recurringText).toContain("Recurring");
      // Click the "Recurring Yes" radio
      const recurringYesRadio = await $("[data-testid='recurring-yes-radio']");
      await recurringYesRadio.click();
      // End Date and Days Of Week should now be visible
      const updatedText = await $("body").getText();
      expect(updatedText).toContain("End Date");
      expect(updatedText).toContain("Days Of Week");
      // Day buttons should be visible (Su, Mo, Tu, etc.)
      const suButton = await $("[data-testid='checkbox-Su']");
      await expect(suButton).toExist();
      const allButton = await $("[data-testid='checkbox-All']");
      await expect(allButton).toExist();
    });

    it("with ?testId= re-run should show prior yaml file viewer", async () => {
      const url = PAGE_START_TEST_FORMAT(testId);
      await browser.url(url);
      await assertNoPageError();
      // "View Prior Yaml File" section should be visible
      const bodyText = await $("body").getText();
      expect(bodyText).toContain("View Prior Yaml File");
      // Click the expand button to toggle yaml viewer
      const expandButton = await $("[data-testid='expand-yaml-button']");
      await expandButton.click();
      // Wait for yaml content to load
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("View Prior Yaml File");
      }, { timeout: 5000 });
    });

    it("queue selector should have at least one option", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const queueSelect = await $("[data-testid='queue-select']");
      await expect(queueSelect).toExist();
      // Wait for queues to load (they're fetched server-side)
      const options = queueSelect.$$("option");
      const optionCount = await options.length;
      expect(optionCount).toBeGreaterThan(0);
    });

    it("pewpew version selector should have at least one option", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const versionSelect = await $("[data-testid='pewpew-version-select']");
      await expect(versionSelect).toExist();
      const options = versionSelect.$$("option");
      const optionCount = await options.length;
      expect(optionCount).toBeGreaterThan(0);
    });

    it("should display the upload button and bypass parser", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Run a new test");
      const submitButton = await $("[data-testid='submit-test-button']");
      await expect(submitButton).toExist();
      const bypassSection = await $("[data-testid='bypass-parser-section']");
      await expect(bypassSection).toExist();
      const notAuthorized = await $("[data-testid='not-authorized-message']");
      await expect(notAuthorized).not.toExist();
    });
  });
});
