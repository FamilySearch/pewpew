import { API_SEARCH, TestData } from "../../types";
import { LogLevel, log } from "@fs/ppaas-common";
import _axios from "axios";
import { integrationUrl } from "../util";

export { integrationUrl };

let sharedTestData: TestData | undefined;

/**
 * Fetches test data via the search API. Caches the result for reuse across specs.
 * This avoids importing from test.spec.ts which would register its mocha tests
 * in the wdio runner and cause "done is not a function" errors.
 */
export async function getTestData (): Promise<TestData> {
  if (sharedTestData) { return sharedTestData; }
  const url = `${integrationUrl}${API_SEARCH}?s3Folder=&maxResults=1`;
  log("wdio getTestData url=" + url, LogLevel.DEBUG);
  const response = await _axios.get(url);
  const body: unknown = response.data;
  if (!Array.isArray(body) || body.length === 0) {
    throw new Error("wdio getTestData: no test data found via search API");
  }
  sharedTestData = body[0] as TestData;
  log("wdio getTestData result", LogLevel.INFO, { testId: sharedTestData.testId, s3Folder: sharedTestData.s3Folder });
  return sharedTestData;
}

/** Asserts no server-side error content is present in the page */
export async function assertNoPageError (): Promise<void> {
  const bodyText = await $("body").getText();
  expect(bodyText).not.toContain("Application error");
  expect(bodyText).not.toContain("Internal Server Error");
  expect(bodyText).not.toContain("500 Internal Server Error");
}
