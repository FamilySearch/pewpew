import { API_ERROR, API_SEARCH, API_TEST, TestData } from "../types";
import { LogLevel, PpaasTestId, TestStatus, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { getPpaasTestId, getTestData, integrationUrl } from "./test.spec";
import { expect } from "chai";

const REDIRECT_TO_S3: boolean = process.env.REDIRECT_TO_S3 === "true";

async function fetch (
  url: string,
  config?: AxiosRequestConfig
): Promise<Response> {
  try {
    const response: Response = await _axios({
      method: config?.method || "get",
      url,
      maxRedirects: 0,
      validateStatus: (status) => status < 500, // Resolve only if the status code is less than 500
      ...(config || {})
    });
    return response;
  } catch (error) {
    throw error;
  }
}

describe("ErrorFile API Integration", function () {
  let url: string;
  let expectedStatus: number = 404;
  let yamlFile: string | undefined;
  let dateString: string | undefined;

  // We can't use an arrow function here if we want to increase the timeout
  // https://stackoverflow.com/questions/41949895/how-to-set-timeout-on-before-hook-in-mocha
  before(async function (): Promise<void> {
    this.timeout(60000);
    url = integrationUrl + API_ERROR;
    log("ErrorFile tests url=" + url, LogLevel.DEBUG);
    // Initialize to one that will 404 for the build server
    const ppaasTestId = await getPpaasTestId();
    yamlFile = ppaasTestId.yamlFile;
    dateString = ppaasTestId.dateString;
    const sharedTestData: TestData = await getTestData();
    if (sharedTestData.status === TestStatus.Finished) {
      expectedStatus = 200;
      return;
    }
    try {
      const searchUrl: string = integrationUrl + API_SEARCH + "?s3Folder=&maxResults=100";
      const searchResponse: Response = await fetch(searchUrl);
      if (searchResponse.status !== 200) {
        throw new Error(`GET ${searchUrl} return status ${searchResponse.status}`);
      }
      log(`GET ${searchUrl} return status ${searchResponse.status}`, LogLevel.DEBUG, searchResponse.data);
      const testDataArray: TestData[] = searchResponse.data;
      log("testDataArray", LogLevel.DEBUG, testDataArray);
      // Search/remove up to 10 at a time
      while (testDataArray.length > 0) {
        const searchArray: TestData[] = testDataArray.splice(0, 10);
        // The search TestData only has the testId, s3Folder, startTime, and status unknown. We need the full data
        try {
          const testResponses: Response[] = await Promise.all(searchArray.map((searchData: TestData) => {
            const testUrl = integrationUrl + API_TEST + "?testId=" + searchData.testId;
            log(`GET testUrl = ${testUrl}`, LogLevel.DEBUG);
            return fetch(testUrl);
          }));
          for (const testResponse of testResponses) {
            const testData: TestData = testResponse.data;
            log(`GET testUrl = ${testResponse.request?.url}`, LogLevel.DEBUG, { status: testResponse.status, body: testData });
            // Only Finished will actually have the file
            if (testResponse.status === 200 && testData.status === TestStatus.Finished) {
              log(`foundResponse = ${testData}`, LogLevel.DEBUG, testData);
              const foundTestId = PpaasTestId.getFromTestId(testData.testId);
              yamlFile = foundTestId.yamlFile;
              dateString = foundTestId.dateString;
              expectedStatus = 200;
              log(`expectedStatus = ${expectedStatus}`, LogLevel.WARN, { yamlFile, dateString, expectedStatus });
              return;
            }
          }
        } catch (error) {
          // Swallow and try the next ones
          log("Could not Get Tests", LogLevel.ERROR, error);
        }
      } // End while
      log(`expectedStatus = ${expectedStatus}`, LogLevel.WARN, { yamlFile, dateString, expectedStatus });
    } catch (error) {
      log("Could not Search and find Results", LogLevel.ERROR, error);
    }
  });

  it("GET /error should respond 404 Not Found", (done: Mocha.Done) => {
    fetch(url).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET /error/yamlFile should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined) { done(new Error("No yamlFile")); return; }
    fetch(url + `/${yamlFile}`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET error/yamlFile/datestring/ trailing slash should respond 308 redirect", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    const s3Folder = `${yamlFile}/${dateString}`;
    fetch(`${url}/${s3Folder}/`).then((res: Response) => {
      log(`GET ${url}/${s3Folder}/`, LogLevel.DEBUG, { status: res?.status, headers: res?.headers, res });
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(308);
      expect(res.headers.location, "headers.location").to.not.equal(undefined);
      expect(res.headers.location?.endsWith(s3Folder), `${res.headers.location} endsWith ${s3Folder}`).to.equal(true);
      done();
    }).catch((error) => done(error));
  });

  it("GET error/yamlFile/dateString notins3 should respond 404 Not Found", (done: Mocha.Done) => {
    const ppaasTestId = PpaasTestId.makeTestId("notins3");
    log("notins3", LogLevel.DEBUG, ppaasTestId);
    fetch(url + `/${ppaasTestId.yamlFile}/${ppaasTestId.dateString}`).then((res: Response) => {
      log(`GET ${url}/${ppaasTestId.yamlFile}/${ppaasTestId.dateString}`, LogLevel.DEBUG, { status: res?.status, res });
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET error/yamlFile/datestring ins3 should respond 200", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    log(url + `/${yamlFile}/${dateString}`, LogLevel.WARN);
    fetch(url + `/${yamlFile}/${dateString}`).then((res: Response) => {
      log(`GET ${url}/${yamlFile}/${dateString}`, LogLevel.DEBUG, { status: res?.status, res });
      expect(res, "res").to.not.equal(undefined);
      if (expectedStatus === 200) {
        log(`GET ${url}/${yamlFile}/${dateString}`, LogLevel.DEBUG, { status: res?.status, data: res.data });
        if (REDIRECT_TO_S3) {
          expect(res.status, "status").to.equal(302);
          expect(res.headers.location, "location").to.not.equal(undefined);
          expect(typeof res.headers.location, "typeof location").to.equal("string");
          const location = res.headers.location;
          log(`GET ${location}`, LogLevel.DEBUG);
          fetch(location).then((redirectResponse: Response) => {
            log(`GET ${location} response`, LogLevel.DEBUG, { status: redirectResponse?.status, headers: redirectResponse.headers, data: redirectResponse.data });
            expect(redirectResponse.status, "status").to.equal(200);
            expect(redirectResponse.data, "body").to.not.equal(undefined);
            expect(typeof redirectResponse.data, "typeof redirectResponse.data").to.equal("string");
            done();
          }).catch((error) => done(error));
        } else {
          expect(res.status, "status").to.equal(200);
          expect(res.data, "body").to.not.equal(undefined);
          expect(typeof res.data, "typeof res.data").to.equal("string");
          done();
        }
      } else {
        expect(res.status, "status").to.equal(404);
        expect(res.data, "body").to.not.equal(undefined);
        log("expectedStatus was " + expectedStatus, LogLevel.WARN);
        done();
      }
    }).catch((error) => done(error));
  });
});
