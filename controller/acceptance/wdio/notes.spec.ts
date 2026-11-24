import { API_NOTES_FORMAT, PAGE_NOTES, PAGE_NOTES_FORMAT } from "../../types";
import { LogLevel, log } from "@fs/ppaas-common";
import { assertNoPageError, getTestData, integrationUrl } from "./util";
import _axios from "axios";

describe("GET /notes (Notes Page)", () => {
  let s3Folder: string;
  let yamlFile: string;
  let dateString: string;

  before(async () => {
    const testData = await getTestData();
    s3Folder = testData.s3Folder;
    // s3Folder is "yamlfilename/datestring"
    const parts = s3Folder.split("/");
    yamlFile = parts[0];
    dateString = parts[1];
    log("notes.spec testData", LogLevel.INFO, { s3Folder, yamlFile, dateString });
    // Create a note so search has something to find
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const notesUrl = `${integrationUrl}${API_NOTES_FORMAT(s3Folder)}`;
    try {
      await _axios.post(notesUrl, { content: "Acceptance test note" }, { headers });
      log("notes.spec: created test note", LogLevel.INFO, { notesUrl });
    } catch (error) {
      log("notes.spec: could not create test note (may already exist)", LogLevel.WARN, error);
    }
  });

  describe("Page Load", () => {
    it("should load the page with the notes heading", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Performance Test Notes");
    });

    it("should display the search form", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const searchInput = await $("#notes-search-input");
      await expect(searchInput).toExist();
      const searchButton = await $("[data-testid='notes-search-button']");
      await expect(searchButton).toExist();
    });

    it("should display the manual entry form", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const yamlInput = await $("#notes-yaml-file-input");
      await expect(yamlInput).toExist();
      const dateInput = await $("#notes-date-string-input");
      await expect(dateInput).toExist();
      const openButton = await $("[data-testid='notes-open-button']");
      await expect(openButton).toExist();
    });
  });

  describe("Query Parameters", () => {
    it("with ?s3Folder= should display the notes editor", async () => {
      const url = PAGE_NOTES_FORMAT(s3Folder);
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Test Notes");
      // Wait for the notes editor to finish loading
      const editor = await $("[data-testid='notes-editor']");
      await editor.waitForExist({ timeout: 15000, timeoutMsg: "Notes editor did not load" });
      // Verify yaml file and date string are displayed
      const yamlFileEl = await $("[data-testid='notes-yaml-file']");
      await expect(yamlFileEl).toHaveText(yamlFile);
      const dateStringEl = await $("[data-testid='notes-date-string']");
      await expect(dateStringEl).toHaveText(dateString);
      // Verify navigation links exist
      const viewTestLink = await $("[data-testid='notes-view-test-link']");
      await expect(viewTestLink).toExist();
      const backLink = await $("[data-testid='notes-back-link']");
      await expect(backLink).toExist();
    });

    it("with invalid s3Folder (no date string) should display error", async () => {
      const url = `${PAGE_NOTES}?s3Folder=invalidformat`;
      log(`navigating to ${url}`, LogLevel.DEBUG);
      await browser.url(url);
      const heading = await $("h1");
      await expect(heading).toHaveText("Invalid s3Folder format");
    });
  });

  describe("Interactions", () => {
    it("searching for a valid test name should display results", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const searchInput = await $("#notes-search-input");
      await searchInput.setValue(yamlFile);
      const searchButton = await $("[data-testid='notes-search-button']");
      await searchButton.click();
      // Wait for results to appear (we created a note in before() so there should be results)
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("Notes (");
      }, { timeout: 10000, timeoutMsg: "Expected search results with note count" });
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(yamlFile);
    });

    it("searching for a non-existent test should display not found message", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const searchInput = await $("#notes-search-input");
      await searchInput.setValue("nonexistenttestname");
      const searchButton = await $("[data-testid='notes-search-button']");
      await searchButton.click();
      // Wait for the no-results message
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes("No notes found matching");
      }, { timeout: 10000, timeoutMsg: "Expected 'no notes found' message" });
    });

    it("manual entry with yaml file and date string should navigate to notes editor", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const yamlInput = await $("#notes-yaml-file-input");
      const dateInput = await $("#notes-date-string-input");
      await yamlInput.setValue(yamlFile);
      await dateInput.setValue(dateString);
      const openButton = await $("[data-testid='notes-open-button']");
      await openButton.click();
      // Should navigate to /notes?s3Folder=yamlFile/dateString
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes("s3Folder=");
      }, { timeout: 5000, timeoutMsg: "Expected navigation to notes with s3Folder param" });
      const currentUrl = await browser.getUrl();
      expect(currentUrl).toContain(yamlFile);
      expect(currentUrl).toContain(dateString);
    });

    it("editing notes and saving should display success message", async () => {
      await browser.url(PAGE_NOTES_FORMAT(s3Folder));
      await assertNoPageError();
      // Wait for editor to load
      const editor = await $("[data-testid='notes-editor']");
      await editor.waitForExist({ timeout: 15000, timeoutMsg: "Notes editor did not load" });
      // Save button should be disabled (no unsaved changes)
      const saveButton = await $("[data-testid='notes-save-button']");
      await expect(saveButton).toHaveAttribute("disabled");
      // Dirty indicator should not be visible
      const dirtyBefore = await $("[data-testid='notes-dirty-indicator']");
      await expect(dirtyBefore).not.toExist();
      // Type into the editor
      const proseMirror = await $("[data-testid='notes-editor-layout'] .ProseMirror");
      await proseMirror.click();
      await browser.keys(["End"]); // Move to end of content
      await browser.keys(["Enter", "Acceptance test edit " + Date.now()]);
      // Dirty indicator should now appear
      await browser.waitUntil(async () => {
        const dirty = await $("[data-testid='notes-dirty-indicator']");
        return dirty.isExisting();
      }, { timeout: 3000, timeoutMsg: "Expected dirty indicator to appear" });
      // Save button should now be enabled
      await expect(saveButton).not.toHaveAttribute("disabled");
      // Click save
      await saveButton.click();
      // Wait for success message
      const message = await $("[data-testid='notes-message']");
      await message.waitForExist({ timeout: 10000, timeoutMsg: "Expected save success message" });
      const messageText = await message.getText();
      expect(messageText).toContain("Notes saved");
      // Dirty indicator should disappear after save
      const dirtyAfter = await $("[data-testid='notes-dirty-indicator']");
      await expect(dirtyAfter).not.toExist();
    });

    it("Open Notes button should be disabled without both fields filled", async () => {
      await browser.url(PAGE_NOTES);
      await assertNoPageError();
      const openButton = await $("[data-testid='notes-open-button']");
      // Should be disabled initially (no fields filled)
      await expect(openButton).toHaveAttribute("disabled");
      // Fill only yaml file
      const yamlInput = await $("#notes-yaml-file-input");
      await yamlInput.setValue("test.yaml");
      await expect(openButton).toHaveAttribute("disabled");
      // Fill date string too — should enable
      const dateInput = await $("#notes-date-string-input");
      await dateInput.setValue("20260415T120000000");
      await expect(openButton).not.toHaveAttribute("disabled");
    });
  });

  describe("Permissions", () => {
    // With authentication disabled every user is treated as Admin
    it("should display Save, Generate Template, and Delete buttons", async () => {
      await browser.url(PAGE_NOTES_FORMAT(s3Folder));
      await assertNoPageError();
      // Wait for the notes editor to finish loading
      const editor = await $("[data-testid='notes-editor']");
      await editor.waitForExist({ timeout: 15000, timeoutMsg: "Notes editor did not load" });
      const saveButton = await $("[data-testid='notes-save-button']");
      await expect(saveButton).toExist();
      const templateButton = await $("[data-testid='notes-generate-template-button']");
      await expect(templateButton).toExist();
      const deleteButton = await $("[data-testid='notes-delete-button']");
      await expect(deleteButton).toExist();
    });
  });
});
