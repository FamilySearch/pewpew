import { PAGE_ADMIN } from "../../types";
import { assertNoPageError } from "./util";

describe("GET /admin (Admin Page)", () => {
  describe("Page Load", () => {
    it("should load the page with the admin heading", async () => {
      await browser.url(PAGE_ADMIN);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Admin Page");
    });
  });

  describe("Interactions", () => {
    it("should display the Upload PewPew and Remove PewPew sections", async () => {
      await browser.url(PAGE_ADMIN);
      await assertNoPageError();
      const bodyText = await $("body").getText();
      expect(bodyText).toContain("Upload a new version of PewPew");
      expect(bodyText).toContain("Remove old version of PewPew");
    });

    it("clicking Upload PewPew with no file should display an error", async () => {
      await browser.url(PAGE_ADMIN);
      await assertNoPageError();
      const uploadButton = await $("[data-testid='upload-pewpew-button']");
      await expect(uploadButton).toExist();
      await expect(uploadButton).toHaveText("Upload PewPew");
      await uploadButton.click();
      // Should display error about missing file
      const errorMsg = await $("[data-testid='admin-error']");
      await errorMsg.waitForExist({ timeout: 3000, timeoutMsg: "Expected error about missing pewpew file" });
    });

    it("setLatestVersion toggle should change its state", async () => {
      await browser.url(PAGE_ADMIN);
      await assertNoPageError();
      const label = await $("[data-testid='checkbox-setLatestVersion']");
      await expect(label).toExist();
      // Get initial state
      const initialText = await label.getText();
      await label.click();
      // Should toggle
      const newText = await label.getText();
      expect(newText).not.toBe(initialText);
      // Toggle back
      await label.click();
      const resetText = await label.getText();
      expect(resetText).toBe(initialText);
    });

    it("pewpew version dropdown should have at least one option", async () => {
      await browser.url(PAGE_ADMIN);
      await assertNoPageError();
      const versionSelect = await $("[data-testid='pewpew-version-select']");
      await expect(versionSelect).toExist();
      const options = versionSelect.$$("option");
      const optionCount = await options.length;
      expect(optionCount).toBeGreaterThan(0);
    });

    it("dropzone should be present for file upload", async () => {
      await browser.url(PAGE_ADMIN);
      await assertNoPageError();
      const dropzone = await $("[data-testid='dropzone']");
      await expect(dropzone).toExist();
      const dropzoneText = await dropzone.getText();
      expect(dropzoneText).toContain("Drop files here");
    });
  });
});
