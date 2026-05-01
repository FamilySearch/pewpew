import {
  PAGE_ADMIN,
  PAGE_CALENDAR,
  PAGE_START_TEST,
  PAGE_TEST_HISTORY
} from "../../types";
import { assertNoPageError } from "./util";

describe("Navigation Links", () => {
  it("clicking 'New Test' should navigate to the start test page", async () => {
    await browser.url(PAGE_TEST_HISTORY);
    await assertNoPageError();
    const link = await $("[data-testid='nav-new-test']");
    await link.click();
    await browser.waitUntil(async () => (await browser.getUrl()).includes(PAGE_START_TEST));
    const heading = await $("h1");
    await expect(heading).toHaveText("Run a new test");
  });

  it("clicking 'Test History' should navigate to the test history page", async () => {
    await browser.url(PAGE_START_TEST);
    await assertNoPageError();
    const link = await $("[data-testid='nav-test-history']");
    await link.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith("/") || url.endsWith(PAGE_TEST_HISTORY);
    });
    const heading = await $("h1");
    await expect(heading).toHaveText("Check the Test Status");
  });

  it("clicking 'Calendar' should navigate to the calendar page", async () => {
    await browser.url(PAGE_TEST_HISTORY);
    await assertNoPageError();
    const link = await $("[data-testid='nav-calendar']");
    await link.click();
    await browser.waitUntil(async () => (await browser.getUrl()).includes(PAGE_CALENDAR));
    const heading = await $("h1");
    await expect(heading).toHaveText("Test Schedule");
  });

  it("clicking 'Admin' should navigate to the admin page", async () => {
    await browser.url(PAGE_TEST_HISTORY);
    await assertNoPageError();
    const link = await $("[data-testid='nav-admin']");
    await expect(link).toExist();
    await link.click();
    await browser.waitUntil(async () => (await browser.getUrl()).includes(PAGE_ADMIN));
    const heading = await $("h1");
    await expect(heading).toHaveText("Admin Page");
  });

  it("Logout link should be present", async () => {
    await browser.url(PAGE_TEST_HISTORY);
    await assertNoPageError();
    const logoutLink = await $("[data-testid='nav-logout']");
    await expect(logoutLink).toExist();
  });
});
