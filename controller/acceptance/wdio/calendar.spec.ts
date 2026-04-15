import { PAGE_CALENDAR, PAGE_START_TEST } from "../../types";
import { assertNoPageError } from "./util";

describe("GET /calendar (Calendar Page)", () => {
  describe("Page Load", () => {
    it("should load the page with the test schedule heading", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Test Schedule");
    });
  });

  describe("Interactions", () => {
    it("clicking a calendar time slot should navigate to the start test page with scheduleDate", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      // FullCalendar uses timeGridWeek by default, wait for it to render (dynamically imported)
      const slot = await $(".fc-timegrid-slot-lane");
      await slot.waitForExist({ timeout: 10000, timeoutMsg: "Calendar time grid did not render" });
      await slot.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes(PAGE_START_TEST) && url.includes("scheduleDate=");
      }, { timeout: 5000, timeoutMsg: "Expected navigation to /test with scheduleDate param" });
      const heading = await $("h1");
      await expect(heading).toHaveText("Run a new test");
    });

    it("switching to month view should display a month grid", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      // Wait for calendar to render
      const monthButton = await $(".fc-dayGridMonth-button");
      await monthButton.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      await monthButton.click();
      // Month view renders day grid cells
      const dayCell = await $(".fc-daygrid-day");
      await expect(dayCell).toExist();
      // Title should contain month name
      const title = await $(".fc-toolbar-title");
      await expect(title).toExist();
    });

    it("switching to day view should display a single day time grid", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const dayButton = await $(".fc-timeGridDay-button");
      await dayButton.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      await dayButton.click();
      // Day view still uses time grid slots
      const slot = await $(".fc-timegrid-slot-lane");
      await expect(slot).toExist();
      // Should only show one day column header
      const colHeaders = $$(".fc-col-header-cell");
      const headerCount = await colHeaders.length;
      expect(headerCount).toBe(1);
    });

    it("switching back to week view should display multiple day columns", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const weekButton = await $(".fc-timeGridWeek-button");
      await weekButton.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      await weekButton.click();
      const colHeaders = $$(".fc-col-header-cell");
      const headerCount = await colHeaders.length;
      expect(headerCount).toBe(7);
    });

    it("clicking prev and next should change the displayed dates", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const title = await $(".fc-toolbar-title");
      await title.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      const initialTitle = await title.getText();
      // Click next
      const nextButton = await $(".fc-next-button");
      await nextButton.click();
      const nextTitle = await title.getText();
      expect(nextTitle).not.toBe(initialTitle);
      // Click prev twice to go to previous period
      const prevButton = await $(".fc-prev-button");
      await prevButton.click();
      await prevButton.click();
      const prevTitle = await title.getText();
      expect(prevTitle).not.toBe(initialTitle);
      // Click today to return
      const todayButton = await $(".fc-today-button");
      await todayButton.click();
      const todayTitle = await title.getText();
      expect(todayTitle).toBe(initialTitle);
    });

    it("as Admin should display the delete override message", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const heading = await $("h1");
      await expect(heading).toHaveText("Test Schedule");
      const adminAlert = await $("[data-testid='admin-override-alert']");
      await expect(adminAlert).toExist();
    });
  });
});
