import { LogLevel, log } from "@fs/ppaas-common";
import { PAGE_START_TEST, PAGE_TEST_HISTORY } from "../../types";
import { assertNoPageError } from "./util";
import path from "path";

const TEST_FOLDER = path.resolve("test");
const SCRIPTING_WITH_ENV_YAML = path.join(TEST_FOLDER, "scriptingwithenv.yaml");
const SCRIPTING_VERSION_REGEX = /^0\.6\./;

const getVersionOptions = async (): Promise<string[]> => {
  const versionSelect = await $("[data-testid='pewpew-version-select']");
  await expect(versionSelect).toExist();
  const options = await versionSelect.$$("option");
  const values: string[] = [];
  for (const option of options) {
    values.push(await option.getValue());
  }
  return values;
};

describe("Scripting Test Submission", () => {
  describe("Version Dropdown", () => {
    it("should contain both a legacy and a scripting (0.6.x) version", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();
      const versions = await getVersionOptions();
      log("pewpew version options", LogLevel.INFO, { versions });
      const scriptingVersions = versions.filter((v) => SCRIPTING_VERSION_REGEX.test(v));
      const legacyVersions = versions.filter((v) => v !== "latest" && !SCRIPTING_VERSION_REGEX.test(v));
      expect(scriptingVersions.length).toBeGreaterThan(0);
      expect(legacyVersions.length).toBeGreaterThan(0);
    });
  });

  describe("Submit scriptingwithenv.yaml with scripting version", () => {
    it("should select a scripting version, submit, and navigate to test history", async () => {
      await browser.url(PAGE_START_TEST);
      await assertNoPageError();

      const versions = await getVersionOptions();
      const scriptingVersion = versions.find((v) => SCRIPTING_VERSION_REGEX.test(v));
      expect(scriptingVersion).toBeDefined();
      log("selecting scriptingVersion", LogLevel.INFO, { scriptingVersion });
      const versionSelect = await $("[data-testid='pewpew-version-select']");
      await versionSelect.selectByAttribute("value", scriptingVersion!);
      await expect(versionSelect).toHaveValue(scriptingVersion!);

      const fileInput = await $("[data-testid='dropzone-file-input']");
      await fileInput.setValue(SCRIPTING_WITH_ENV_YAML);
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("scriptingwithenv.yaml");
      }, { timeout: 5000, timeoutMsg: "Expected scriptingwithenv.yaml to appear in file list" });

      const addButton = await $("[data-testid='add-env-var-button']");
      await addButton.click();
      await addButton.click();
      await addButton.click();
      await browser.waitUntil(async () => {
        const vars = $$("[data-testid='env-vars-list'] input[data-testid^='env-var-name-']");
        return (await vars.length) >= 3;
      }, { timeout: 3000 });
      const nameInputs = await $$("[data-testid='env-vars-list'] input[data-testid^='env-var-name-']");
      const valueInputs = await $$("[data-testid='env-vars-list'] input[data-testid^='env-var-value-']");
      await nameInputs[0].setValue("SERVICE_URL_AGENT");
      await valueInputs[0].setValue("127.0.0.1:8080");
      await nameInputs[1].setValue("TEST1");
      await valueInputs[1].setValue("true");
      await nameInputs[2].setValue("TEST2");
      await valueInputs[2].setValue("true");

      const submitButton = await $("[data-testid='submit-test-button']");
      await submitButton.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes(PAGE_TEST_HISTORY) && url.includes("testId=");
      }, { timeout: 30000, timeoutMsg: "Expected navigation to test history with testId" });
      await assertNoPageError();
      log("scriptingwithenv with scripting version: test submitted successfully", LogLevel.INFO);
    });
  });
});
