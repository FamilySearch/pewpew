import { PAGE_CALENDAR, PAGE_START_TEST } from "../../types";
import { assertNoPageError } from "./util";

// A date 3 months out so we never land on the current week during tests
const futureDate = new Date();
futureDate.setMonth(futureDate.getMonth() + 3);
futureDate.setDate(1);
futureDate.setHours(0, 0, 0, 0);
const FUTURE_TIMESTAMP = futureDate.getTime();

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

    it("switching to month view should display a month grid and update the URL", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      // Wait for calendar to render
      const monthButton = await $(".fc-dayGridMonth-button");
      await monthButton.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      await monthButton.click();
      // Month view renders day grid cells
      const dayCell = await $(".fc-daygrid-day");
      await expect(dayCell).toExist();
      // URL should reflect month view
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes("defaultView=dayGridMonth") && url.includes("defaultDate=");
      }, { timeout: 5000, timeoutMsg: "URL did not update to defaultView=dayGridMonth" });
    });

    it("switching to day view should display a single day time grid and update the URL", async () => {
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
      // URL should reflect day view
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes("defaultView=timeGridDay") && url.includes("defaultDate=");
      }, { timeout: 5000, timeoutMsg: "URL did not update to defaultView=timeGridDay" });
    });

    it("switching back to week view should display multiple day columns and update the URL", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const weekButton = await $(".fc-timeGridWeek-button");
      await weekButton.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      await weekButton.click();
      const colHeaders = $$(".fc-col-header-cell");
      const headerCount = await colHeaders.length;
      expect(headerCount).toBe(7);
      // URL should reflect week view
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes("defaultView=timeGridWeek") && url.includes("defaultDate=");
      }, { timeout: 5000, timeoutMsg: "URL did not update to defaultView=timeGridWeek" });
    });

    it("clicking prev and next should change the displayed dates and update defaultDate in the URL", async () => {
      await browser.url(PAGE_CALENDAR);
      await assertNoPageError();
      const title = await $(".fc-toolbar-title");
      await title.waitForExist({ timeout: 10000, timeoutMsg: "Calendar toolbar did not render" });
      const initialTitle = await title.getText();

      // Click next — URL should gain defaultDate
      const nextButton = await $(".fc-next-button");
      await nextButton.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes("defaultDate=");
      }, { timeout: 5000, timeoutMsg: "URL did not update defaultDate after clicking next" });
      const nextTitle = await title.getText();
      expect(nextTitle).not.toBe(initialTitle);

      // Record the defaultDate after going forward
      const urlAfterNext = await browser.getUrl();
      const dateAfterNext = new URL(urlAfterNext).searchParams.get("defaultDate");

      // Click prev twice to go to previous period
      const prevButton = await $(".fc-prev-button");
      await prevButton.click();
      await prevButton.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        const date = new URL(url).searchParams.get("defaultDate");
        return !!date && date !== dateAfterNext;
      }, { timeout: 5000, timeoutMsg: "URL defaultDate did not change after clicking prev" });
      const prevTitle = await title.getText();
      expect(prevTitle).not.toBe(initialTitle);

      // Click today — URL should update defaultDate back toward the original period
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

  describe("URL Query Params", () => {
    it("loading with defaultView=dayGridMonth should pre-select month view", async () => {
      await browser.url(`${PAGE_CALENDAR}?defaultView=dayGridMonth&defaultDate=${FUTURE_TIMESTAMP}`);
      await assertNoPageError();
      // Month view renders day grid cells (not time grid)
      const dayCell = await $(".fc-daygrid-day");
      await dayCell.waitForExist({ timeout: 10000, timeoutMsg: "Month view did not render from URL param" });
      await expect(dayCell).toExist();
      const timeSlot = await $(".fc-timegrid-slot-lane");
      await expect(timeSlot).not.toExist();
    });

    it("loading with defaultView=timeGridDay should pre-select day view", async () => {
      await browser.url(`${PAGE_CALENDAR}?defaultView=timeGridDay&defaultDate=${FUTURE_TIMESTAMP}`);
      await assertNoPageError();
      const slot = await $(".fc-timegrid-slot-lane");
      await slot.waitForExist({ timeout: 10000, timeoutMsg: "Day view did not render from URL param" });
      const colHeaders = $$(".fc-col-header-cell");
      const headerCount = await colHeaders.length;
      expect(headerCount).toBe(1);
    });

    it("clicking the Calendar nav link from a parameterized URL should reset to default week view", async () => {
      await browser.url(`${PAGE_CALENDAR}?defaultView=dayGridMonth&defaultDate=${FUTURE_TIMESTAMP}`);
      await assertNoPageError();
      const dayCell = await $(".fc-daygrid-day");
      await dayCell.waitForExist({ timeout: 10000, timeoutMsg: "Month view did not render before nav link click" });

      // Click the Calendar nav link (strips query params)
      const navLink = await $("[data-testid='nav-calendar']");
      await navLink.click();

      // URL should be plain /calendar with no params
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.endsWith(PAGE_CALENDAR) && !url.includes("defaultView=") && !url.includes("defaultDate=");
      }, { timeout: 5000, timeoutMsg: "URL still contains query params after clicking Calendar nav link" });

      // Should have reverted to week view (7 col headers)
      await browser.waitUntil(async () => await $$(".fc-col-header-cell").length === 7,
        { timeout: 5000, timeoutMsg: "Calendar did not revert to week view after nav link click" });
    });

    it("clicking back after nav link should restore previous view and URL params", async () => {
      await browser.url(`${PAGE_CALENDAR}?defaultView=dayGridMonth&defaultDate=${FUTURE_TIMESTAMP}`);
      await assertNoPageError();
      const dayCell = await $(".fc-daygrid-day");
      await dayCell.waitForExist({ timeout: 10000, timeoutMsg: "Month view did not render before nav link click" });

      // Click Calendar nav link to reset to plain /calendar
      const navLink = await $("[data-testid='nav-calendar']");
      await navLink.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.endsWith(PAGE_CALENDAR) && !url.includes("defaultView=");
      }, { timeout: 5000, timeoutMsg: "URL still contains params after clicking nav link" });

      // Go back — should restore params and month view
      await browser.back();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes("defaultView=dayGridMonth");
      }, { timeout: 5000, timeoutMsg: "URL did not restore defaultView=dayGridMonth after back" });
      const restoredDayCell = await $(".fc-daygrid-day");
      await restoredDayCell.waitForExist({ timeout: 10000, timeoutMsg: "Month view did not restore after back navigation" });
    });
  });
});
