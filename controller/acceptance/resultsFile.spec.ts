import { API_JSON, API_SEARCH, API_TEST, TestData } from "../types";
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

describe("ResultsFile API Integration", function () {
  let url: string;
  let yamlFile: string | undefined;
  let dateString: string | undefined;
  let resultsFile: string | undefined;

  // We can't use an arrow function here if we want to increase the timeout
  // https://stackoverflow.com/questions/41949895/how-to-set-timeout-on-before-hook-in-mocha
  before(async function (): Promise<void> {
    this.timeout(60000);
    url = integrationUrl + API_JSON;
    log("ResultsFile tests url=" + url, LogLevel.DEBUG);
    const ppaasTestId = await getPpaasTestId();
    yamlFile = ppaasTestId.yamlFile;
    dateString = ppaasTestId.dateString;
    const sharedTestData: TestData = await getTestData();
    if (sharedTestData.resultsFileLocation && sharedTestData.resultsFileLocation.length > 0) {
      // Initialize to one that will 302 for the build server
      resultsFile = sharedTestData.resultsFileLocation[0].split("/").pop();
    }
    try {
      const searchUrl: string = integrationUrl + API_SEARCH + "?s3Folder=&maxResults=100";
      const searchResponse: Response = await fetch(searchUrl);
      if (searchResponse.status !== 200) {
        throw new Error(`GET ${searchUrl} return status ${searchResponse.status}`);
      }
      log(`GET ${searchUrl} return status ${searchResponse.status}`, LogLevel.DEBUG, searchResponse.data);
      expect(Array.isArray(searchResponse.data)).to.equal(true);
      if (searchResponse.data.length > 0) {
        log("searchResponse.data[0]", LogLevel.DEBUG, searchResponse.data[0]);
        expect(typeof searchResponse.data[0]).to.equal("object");
        expect(typeof searchResponse.data[0].testId, JSON.stringify(searchResponse.data[0].testId)).to.equal("string");
        expect(typeof searchResponse.data[0].s3Folder, JSON.stringify(searchResponse.data[0].s3Folder)).to.equal("string");
      }
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
            expect(testResponse.data, "testResponse.data").to.not.equal(undefined);
            expect(typeof (testResponse.data as TestData).testId, "testId: " + JSON.stringify(testResponse.data)).to.equal("string");
            expect(typeof (testResponse.data as TestData).s3Folder, "s3Folder: " + JSON.stringify(testResponse.data)).to.equal("string");
            const testData: TestData = testResponse.data;
            log(`GET testUrl = ${testResponse.request?.url}`, LogLevel.DEBUG, { status: testResponse.status, body: testData });
            // Only Finished will actually have the file
            if (testResponse.status === 200 && testData.status === TestStatus.Finished
              && testData.resultsFileLocation && testData.resultsFileLocation.length > 0) {
              log(`foundResponse = ${testData}`, LogLevel.DEBUG, testData);
              const foundTestId = PpaasTestId.getFromTestId(testData.testId);
              yamlFile = foundTestId.yamlFile;
              dateString = foundTestId.dateString;
              resultsFile = testData.resultsFileLocation[0].split("/").pop();
              log(`resultsFile = ${resultsFile}`, LogLevel.WARN, { yamlFile, dateString, resultsFile });
              return;
            }
          }
        } catch (error) {
          // Swallow and try the next ones
          log("Could not Get Tests", LogLevel.ERROR, error);
        }
      } // End while
      log(`resultsFile = ${resultsFile}`, LogLevel.WARN, { yamlFile, dateString, resultsFile });
    } catch (error) {
      log("Could not Search and find Results", LogLevel.ERROR, error);
    }
});

  it("GET json should respond 404 Not Found", (done: Mocha.Done) => {
    fetch(url).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET json/yamlFile should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined) { done(new Error("No yamlFile")); return; }
    fetch(url + `/${yamlFile}`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET json/yamlFile/dateString should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET json/yamlFile/dateString/notjson should respond 400 Bad Request", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}/${yamlFile}.yaml`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(400);
      done();
    }).catch((error) => done(error));
  });

  it("GET json/yamlFile/dateString/notins3.json should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}/stats-notins3.json`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  const validateJson = (data: string) => {
    expect(data, "data").to.include("{\"test\":\"");
    expect(data, "res.data").to.include("\"bin\":\"");
    for (const line of (data as string).replace(/}{/g, "}\n{").split("\n")) {
      let json: any;
      try {
        json = JSON.parse(line);
      } catch (error) {
        const errorString = "Each line should JSON parsable: ";
        log(errorString, LogLevel.ERROR, error, { line });
        throw new Error(errorString + error);
      }
      expect(json, `json from [${line}]`).to.not.equal(undefined);
      expect(json, `json from [${line}]`).to.not.equal(null);
      if ("test" in json) {
        expect(typeof json.test, "typeof json.test").to.equal("string");
        expect(typeof json.bin, "typeof json.bin").to.equal("string");
        expect(typeof json.bucketSize, "typeof json.bucketSize").to.equal("number");
      } else if ("index" in json) {
        expect(typeof json.index, "typeof json.index").to.equal("number");
        expect(typeof json.tags, "typeof json.tags").to.equal("object");
        expect(typeof json.tags?._id, "typeof json.tags._id").to.equal("string");
        expect(typeof json.tags?.url, "typeof json.tags.url").to.equal("string");
      } else {
        expect("entries" in json, "\"entries\" in json").to.equal(true);
      }
    }
  };

  it("GET json/yamlFile/datestring/stats-ins3.json should respond 200", (done: Mocha.Done) => {
    if (resultsFile === undefined) { done(new Error("No resultsFile")); return; }
    log(url + `/${yamlFile}/${dateString}/${resultsFile}`, LogLevel.WARN);
    fetch(url + `/${yamlFile}/${dateString}/${resultsFile}`).then((res: Response) => {
      log(`GET ${url}/${yamlFile}/${dateString}/${resultsFile}`, LogLevel.DEBUG, { res });
      expect(res, "res").to.not.equal(undefined);
      // The build server will 404 because there won't be any completed tests, localhost should have some
      if (url.includes("localhost")) {
        log(`GET ${url}/${yamlFile}/${dateString}/${resultsFile}`, LogLevel.DEBUG, { data: res.data });
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
            validateJson(res.data as string);
            done();
          }).catch((error) => done(error));
        } else {
          expect(res.status, "status").to.equal(200);
          expect(res.data, "data").to.not.equal(undefined);
          expect(typeof res.data, "typeof res.data").to.equal("string");
          validateJson(res.data as string);
          done();
        }
      } else {
        expect(res.status, "status").to.equal(404);
        done();
      }
    }).catch((error) => done(error));
  });
});
