import {
  ACCEPTANCE_AWS_PERMISSIONS,
  integrationUrl,
  uploadAcceptanceFiles
} from "./util";
import {
  API_LOGIN,
  PAGE_ADMIN,
  PAGE_CALENDAR,
  PAGE_LOGIN,
  PAGE_START_TEST,
  PAGE_START_TEST_FORMAT,
  PAGE_TEST_HISTORY,
  PAGE_TEST_HISTORY_FORMAT,
  PAGE_TEST_UPDATE,
  PAGE_TEST_UPDATE_FORMAT
} from "../types";
import { LogLevel, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { expect } from "chai";
import { getTestData } from "./test.spec";

/** Fetches a URL without following redirects so we can assert on 3xx status codes */
function fetchNoRedirects (url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
  return _axios.get(url, {
    ...(config || {}),
    maxRedirects: 0,
    validateStatus: () => true
  });
}

/** Asserts no server-side error content is present in the rendered HTML */
function assertNoPageError (html: string): void {
  expect(html, "no 'Application error'").to.not.include("Application error");
  expect(html, "no 'Internal Server Error'").to.not.include("Internal Server Error");
  expect(html, "no '500'").to.not.include("500 Internal Server Error");
}

describe("Web Page Acceptance Tests", () => {
  let testId: string;
  let s3Folder: string;

  before(async () => {
    if (ACCEPTANCE_AWS_PERMISSIONS) {
      // Populate a finished result
      const { ppaasTestId } = await uploadAcceptanceFiles();
      testId = ppaasTestId.testId;
      s3Folder = ppaasTestId.s3Folder;
    } else {
      const testData = await getTestData();
      testId = testData.testId;
      s3Folder = testData.s3Folder;
    }
    log("Web Page Acceptance testData", LogLevel.INFO, { s3Folder, testId });
    expect(testId, "testId").to.not.equal(undefined);
    expect(s3Folder, "s3Folder").to.not.equal(undefined);
  });

  // =====================
  // GET / (index - test history)
  // =====================
  describe(`GET ${PAGE_TEST_HISTORY}`, () => {
    it("should respond 200 with the test status heading", async () => {
      const res: AxiosResponse = await fetchNoRedirects(integrationUrl + PAGE_TEST_HISTORY);
      log(`GET ${PAGE_TEST_HISTORY} status=${res.status}`, LogLevel.DEBUG);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Check the Test Status").to.include("Check the Test Status");
      expect(html, "search input").to.include("name=\"testIdSearch\"");
      expect(html, "search label").to.include("Search for S3Folder:");
    });

    it("with ?search= partial s3Folder should respond 200 with search results", async () => {
      const partialSearch = s3Folder.split("/")[0];
      const url = `${integrationUrl}${PAGE_TEST_HISTORY}?search=${encodeURIComponent(partialSearch)}`;
      log(`GET ${url}`, LogLevel.WARN);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Check the Test Status").to.include("Check the Test Status");
      expect(html, "Tests Found in S3 heading").to.include("Tests Found in S3");
      expect(html, `s3Folder '${s3Folder}' in results`).to.include(s3Folder);
    });

    it("with ?search= full s3Folder should respond 200 with search results", async () => {
      const url = `${integrationUrl}${PAGE_TEST_HISTORY}?search=${encodeURIComponent(s3Folder)}`;
      log(`GET ${url}`, LogLevel.WARN);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Check the Test Status").to.include("Check the Test Status");
      expect(html, "Tests Found in S3 heading").to.include("Tests Found in S3");
      expect(html, `s3Folder '${s3Folder}' in results`).to.include(s3Folder);
    });

    it("with ?testId= should respond 200 with test data in the HTML", async () => {
      const url = integrationUrl + PAGE_TEST_HISTORY_FORMAT(testId);
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Check the Test Status").to.include("Check the Test Status");
      expect(html, `testId '${testId}' in page`).to.include(testId);
    });
  });

  // =====================
  // GET /test (start new test)
  // =====================
  describe(`GET ${PAGE_START_TEST}`, () => {
    it("should respond 200 with the start test heading", async () => {
      const res: AxiosResponse = await fetchNoRedirects(integrationUrl + PAGE_START_TEST);
      log(`GET ${PAGE_START_TEST} status=${res.status}`, LogLevel.DEBUG);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Run a new test").to.include("Run a new test");
    });

    it("with ?testId= should respond 200 with previous test data pre-populated", async () => {
      const url = integrationUrl + PAGE_START_TEST_FORMAT(testId);
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Run a new test").to.include("Run a new test");
      expect(html, `testId '${testId}' in page`).to.include(testId);
    });
  });

  // =====================
  // GET /testupdate
  // =====================
  describe(`GET ${PAGE_TEST_UPDATE}`, () => {
    it("with no testId should respond 200 with the missing testId error", async () => {
      const res: AxiosResponse = await fetchNoRedirects(integrationUrl + PAGE_TEST_UPDATE);
      log(`GET ${PAGE_TEST_UPDATE} status=${res.status}`, LogLevel.DEBUG);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      expect(html, "missing testId error").to.include("Must provide a TestId to this page");
    });

    it("with ?testId= should respond 200 with the update heading and testId", async () => {
      const url = integrationUrl + PAGE_TEST_UPDATE_FORMAT(testId);
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Update Yaml file for testId").to.include("Update Yaml file for testId");
      expect(html, `testId '${testId}' in heading`).to.include(testId);
      expect(html, "Update Yaml File button").to.include("Update Yaml File");
    });
  });

  // =====================
  // GET /admin
  // =====================
  describe(`GET ${PAGE_ADMIN}`, () => {
    it("should respond 200 with the admin heading", async () => {
      const res: AxiosResponse = await fetchNoRedirects(integrationUrl + PAGE_ADMIN);
      log(`GET ${PAGE_ADMIN} status=${res.status}`, LogLevel.DEBUG);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Admin Page").to.include("Admin Page");
    });
  });

  // =====================
  // GET /calendar
  // =====================
  describe(`GET ${PAGE_CALENDAR}`, () => {
    it("should respond 200 with the test schedule heading", async () => {
      const res: AxiosResponse = await fetchNoRedirects(integrationUrl + PAGE_CALENDAR);
      log(`GET ${PAGE_CALENDAR} status=${res.status}`, LogLevel.DEBUG);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      assertNoPageError(html);
      expect(html, "h1: Test Schedule").to.include("Test Schedule");
    });
  });

  // =====================
  // GET /login
  // =====================
  describe(`GET ${PAGE_LOGIN}`, () => {
    it("with ?error= should respond 200 and display the error on the login page", async () => {
      const errorValue = "access_denied";
      const url = `${integrationUrl}${PAGE_LOGIN}?error=${encodeURIComponent(errorValue)}`;
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      expect(html, "h1: Login Status").to.include("Login Status");
      expect(html, `error value '${errorValue}' in page`).to.include(errorValue);
    });

    it("with ?error= and ?error_description= should respond 200 and display both", async () => {
      const errorValue = "access_denied";
      const errorDescription = "User denied access";
      const url = `${integrationUrl}${PAGE_LOGIN}?error=${encodeURIComponent(errorValue)}&error_description=${encodeURIComponent(errorDescription)}`;
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(200);
      const html: string = res.data;
      expect(html, "h1: Login Status").to.include("Login Status");
      expect(html, `error '${errorValue}' in page`).to.include(errorValue);
      expect(html, `error_description '${errorDescription}' in page`).to.include(errorDescription);
    });

    it("with no params should redirect to the login API with state", async () => {
      const url = integrationUrl + PAGE_LOGIN;
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(307);
      expect(res.headers.location, "redirect location header").to.not.equal(undefined);
      expect(res.headers.location, "redirect to API_LOGIN").to.include(API_LOGIN);
      expect(res.headers.location, "redirect includes state").to.include("state=");
    });

    it("with ?state= should pass the state to the login API redirect", async () => {
      const stateValue = "/test";
      const url = `${integrationUrl}${PAGE_LOGIN}?state=${encodeURIComponent(stateValue)}`;
      log(`GET ${url}`, LogLevel.DEBUG);
      const res: AxiosResponse = await fetchNoRedirects(url);
      expect(res.status, "status").to.equal(307);
      expect(res.headers.location, "redirect location header").to.not.equal(undefined);
      expect(res.headers.location, "redirect to API_LOGIN").to.include(API_LOGIN);
      expect(res.headers.location, "redirect includes state value").to.include(stateValue);
    });
  });
});
