import { LogLevel, log } from "@fs/ppaas-common";
import {
  PAGE_TEST_UPDATE,
  PAGE_TEST_UPDATE_FORMAT
} from "../../types";
import { assertNoPageError, getTestData } from "./util";

describe("GET /testupdate (Test Update Page)", () => {
  let testId: string;

  before(async () => {
    const testData = await getTestData();
    testId = testData.testId;
    log("testupdate.spec testData", LogLevel.INFO, { testId });
  });

  describe("Page Load", () => {
    it("with no testId should display the missing testId error", async () => {
      await browser.url(PAGE_TEST_UPDATE);
      const errorMsg = await $("[data-testid='missing-testid-error']");
      await expect(errorMsg).toExist();
    });

    it("with ?testId= should display the update heading and testId", async () => {
      const url = PAGE_TEST_UPDATE_FORMAT(testId);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText(expect.stringContaining("Update Yaml file for testId"));
      const updateButton = await $("[data-testid='update-yaml-button']");
      await expect(updateButton).toExist();
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(testId);
    });
  });

  it("should display the bypass parser option", async () => {
    const url = PAGE_TEST_UPDATE_FORMAT(testId);
    await browser.url(url);
    await assertNoPageError();
    const updateButton = await $("[data-testid='update-yaml-button']");
    await expect(updateButton).toExist();
    const bypassSection = await $("[data-testid='bypass-parser-section']");
    await expect(bypassSection).toExist();
  });
});
