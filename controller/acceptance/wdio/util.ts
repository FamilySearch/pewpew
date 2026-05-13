import { API_SEARCH, API_TEST_FORMAT, TestData } from "../../types";
import { LogLevel, TestStatus, log } from "@fs/ppaas-common";
import _axios from "axios";
import { integrationUrl } from "../util";

export { integrationUrl };

let sharedTestData: TestData | undefined;
let sharedTestDataWithResults: TestData | undefined;

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

/**
 * Searches up to 100 tests to find a finished one with resultsFileLocation.
 * Returns undefined if none found. Caches the result for reuse across specs.
 */
export async function getTestDataWithResults (): Promise<TestData | undefined> {
  if (sharedTestDataWithResults) { return sharedTestDataWithResults; }
  const searchUrl = `${integrationUrl}${API_SEARCH}?s3Folder=&maxResults=100`;
  log("wdio getTestDataWithResults searchUrl=" + searchUrl, LogLevel.DEBUG);
  const searchResponse = await _axios.get(searchUrl);
  const body: unknown = searchResponse.data;
  if (!Array.isArray(body) || body.length === 0) { return undefined; }
  const testDataArray: TestData[] = [...body];
  while (testDataArray.length > 0) {
    const batch: TestData[] = testDataArray.splice(0, 10);
    const responses = await Promise.all(batch.map((t: TestData) =>
      _axios.get(`${integrationUrl}${API_TEST_FORMAT(t.testId)}`).catch(() => null)
    ));
    for (const res of responses) {
      if (!res || res.status !== 200) { continue; }
      const td: TestData = res.data;
      if (td.status === TestStatus.Finished && td.resultsFileLocation && td.resultsFileLocation.length > 0) {
        sharedTestDataWithResults = td;
        log("wdio getTestDataWithResults found", LogLevel.INFO, { testId: td.testId });
        return td;
      }
    }
  }
  log("wdio getTestDataWithResults: no finished test with results found", LogLevel.WARN);
  return undefined;
}

/** Asserts no server-side error content is present in the page */
export async function assertNoPageError (): Promise<void> {
  const bodyText = await $("body").getText();
  expect(bodyText).not.toContain("Application error");
  expect(bodyText).not.toContain("Internal Server Error");
  expect(bodyText).not.toContain("500 Internal Server Error");
}
