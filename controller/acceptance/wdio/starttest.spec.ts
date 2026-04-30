import { LogLevel, log } from "@fs/ppaas-common";
import {
  PAGE_CALENDAR,
  PAGE_START_TEST,
  PAGE_START_TEST_FORMAT,
  PAGE_TEST_HISTORY
} from "../../types";
import { assertNoPageError, getTestData } from "./util";
import path from "path";

const TEST_FOLDER = path.resolve("test");
const BASIC_YAML = path.join(TEST_FOLDER, "basic.yaml");
const BASIC_WITH_ENV_YAML = path.join(TEST_FOLDER, "basicwithenv.yaml");
const BASIC_WITH_FILES_YAML = path.join(TEST_FOLDER, "basicwithfiles.yaml");
const TEXT_FILE = path.join(TEST_FOLDER, "text.txt");
const TEXT_FILE_2 = path.join(TEST_FOLDER, "text2.txt");

describe("Start Test Submissions", () => {
  describe("Basic Test with Environment Variables", () => {
    it("submitting basicwithenv.yaml without env vars should display an error", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Upload the yaml file via the hidden file input
      const fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(BASIC_WITH_ENV_YAML);
      // Wait for file to appear in the file list
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("basicwithenv.yaml");
      }, { timeout: 5000, timeoutMsg: "Expected yaml file to appear in file list" });
      // Click submit without adding env vars
      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      // Should display error about missing environment variable (SERVICE_URL_AGENT)
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("Error") && text.includes("SERVICE_URL_AGENT");
      }, { timeout: 15000, timeoutMsg: "Expected error about missing SERVICE_URL_AGENT variable" });
      log("basicwithenv without env vars: got expected error", LogLevel.INFO);
    });

    it("submitting basicwithenv.yaml with env vars should succeed", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Upload the yaml file
      const fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(BASIC_WITH_ENV_YAML);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("basicwithenv.yaml");
      }, { timeout: 5000 });
      // Add required environment variables
      const addButton = await $("[data-testid='add-env-var-button']");
      await addButton.click();
      await addButton.click();
      await addButton.click();
      // Wait for 3 variable rows
      await browser.waitUntil(async () => {
        const vars = $$("[data-testid='env-vars-list'] input[data-testid^='env-var-name-']");
        return (await vars.length) >= 3;
      }, { timeout: 3000 });
      // Fill in the environment variable names and values
      const nameInputs = await $$("[data-testid='env-vars-list'] input[data-testid^='env-var-name-']");
      const valueInputs = await $$("[data-testid='env-vars-list'] input[data-testid^='env-var-value-']");
      // SERVICE_URL_AGENT
      await nameInputs[0].setValue("SERVICE_URL_AGENT");
      await valueInputs[0].setValue("127.0.0.1:8080");
      // TEST1
      await nameInputs[1].setValue("TEST1");
      await valueInputs[1].setValue("true");
      // TEST2
      await nameInputs[2].setValue("TEST2");
      await valueInputs[2].setValue("true");
      // Click submit
      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      // Should navigate to test history page on success
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes(PAGE_TEST_HISTORY) && url.includes("testId=");
      }, { timeout: 30000, timeoutMsg: "Expected navigation to test history with testId" });
      await assertNoPageError();
      log("basicwithenv with env vars: test submitted successfully", LogLevel.INFO);
    });
  });

  describe("Basic Test with Additional Files", () => {
    it("submitting basicwithfiles.yaml without additional files should display an error", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Upload the yaml file only
      const fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(BASIC_WITH_FILES_YAML);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("basicwithfiles.yaml");
      }, { timeout: 5000, timeoutMsg: "Expected yaml file to appear in file list" });
      // Click submit without adding required files
      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      // Should display error about missing files (text.txt, text2.txt)
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("Error") && text.includes("expecting files that were not provided");
      }, { timeout: 15000, timeoutMsg: "Expected error about missing additional files" });
      log("basicwithfiles without files: got expected error", LogLevel.INFO);
    });

    it("submitting basicwithfiles.yaml with additional files should succeed", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Upload the yaml file
      let fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(BASIC_WITH_FILES_YAML);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("basicwithfiles.yaml");
      }, { timeout: 5000 });
      // Upload additional files (text.txt and text2.txt)
      // After the first file upload, the dropzone re-renders so we need a fresh reference
      fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(TEXT_FILE);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("text.txt");
      }, { timeout: 5000 });
      fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(TEXT_FILE_2);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("text2.txt");
      }, { timeout: 5000 });
      // Click submit
      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      // Should navigate to test history page on success
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes(PAGE_TEST_HISTORY) && url.includes("testId=");
      }, { timeout: 30000, timeoutMsg: "Expected navigation to test history with testId" });
      await assertNoPageError();
      log("basicwithfiles with files: test submitted successfully", LogLevel.INFO);
    });
  });

  describe("Schedule Test for the Future", () => {
    it("scheduling a basic test should navigate to the calendar", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      // Upload the yaml file
      const fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(BASIC_YAML);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("basic.yaml");
      }, { timeout: 5000 });
      // Select "In the future" radio
      const futureRadio = await $("[data-testid='schedule-future-radio']");
      await futureRadio.click();
      // Date picker should appear — verify the schedule controls are visible
      const bodyText = await $("body").getText();
      expect(bodyText).toContain("In the future");
      // The default schedule date is pre-populated to the future, so submit should work
      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      // Should navigate to calendar page on success
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes(PAGE_CALENDAR) && url.includes("defaultDate=");
      }, { timeout: 30000, timeoutMsg: "Expected navigation to calendar with defaultDate" });
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Test Schedule");
      log("schedule test: test scheduled successfully", LogLevel.INFO);
    });
  });

  describe("Re-Run a Prior Test", () => {
    let priorTestId: string;

    before(async () => {
      const testData = await getTestData();
      priorTestId = testData.testId;
      log("re-run test: priorTestId", LogLevel.INFO, { priorTestId });
    });

    it("re-running a prior test should pre-populate and submit successfully", async () => {
      const url = PAGE_START_TEST_FORMAT(priorTestId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      // Verify prior test data is pre-populated
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(priorTestId);
      expect(bodyText).toContain("View Prior Yaml File");
      // The yaml file and other settings should be pre-populated from the prior test
      // Submit the re-run
      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      // Should navigate to test history page on success
      await browser.waitUntil(async () => {
        const currentUrl = await browser.getUrl();
        return currentUrl.includes(PAGE_TEST_HISTORY) && currentUrl.includes("testId=");
      }, { timeout: 30000, timeoutMsg: "Expected navigation to test history with testId" });
      await assertNoPageError();
      log("re-run test: test re-submitted successfully", LogLevel.INFO);
    });
  });
});
