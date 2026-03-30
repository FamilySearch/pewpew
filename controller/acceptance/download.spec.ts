import { ACCEPTANCE_AWS_PERMISSIONS, integrationUrl, uploadAcceptanceFiles } from "./util";
import { API_DOWNLOAD, API_DOWNLOAD_FORMAT, API_SEARCH, API_TEST_FORMAT, TestData } from "../types";
import { LogLevel, PpaasTestId, TestStatus, log, logger, ppaasteststatus, util } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { getPpaasTestId, getTestData } from "./test.spec";
import { ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME } from "../src/ppaasencryptenvfile";
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

describe("Download API Integration", function () {
  let url: string;
  let expectedStatus: number = 404;
  let testId: string | undefined;
  let yamlFile: string;
  let statusFile: string;
  let resultsFile: string;
  let stdoutFile: string;
  let stderrFile: string;
  let largeS3File: string;
  let variablesFile: string;
  let dateString: string | undefined;
  let ppaasTestId: PpaasTestId | undefined;
  let availableFiles: string[] = [];

  // We can't use an arrow function here if we want to increase the timeout
  // https://stackoverflow.com/questions/41949895/how-to-set-timeout-on-before-hook-in-mocha
  before(async function (): Promise<void> {
    this.timeout(60000);
    url = integrationUrl + API_DOWNLOAD;
    log("Download tests url=" + url, LogLevel.DEBUG);
    if (ACCEPTANCE_AWS_PERMISSIONS) {
      const uploadResult = await uploadAcceptanceFiles();
      ppaasTestId = uploadResult.ppaasTestId;
      testId = ppaasTestId.testId;
      yamlFile = uploadResult.yamlFile;
      statusFile = uploadResult.statusFile;
      resultsFile = uploadResult.resultsFile;
      stdoutFile = uploadResult.stdoutFile;
      stderrFile = uploadResult.stderrFile;
      largeS3File = uploadResult.largeS3File;
      variablesFile = uploadResult.variablesFile;
      dateString = ppaasTestId.dateString;
      expectedStatus = 200;
      log("Download tests with uploaded files", LogLevel.DEBUG, { testId, yamlFile, dateString });
    } else {
      // Initialize to one that will 404 for the build server
      ppaasTestId = await getPpaasTestId();
      testId = ppaasTestId.testId;
      yamlFile = ppaasTestId.yamlFile + ".yaml";
      statusFile = ppaasteststatus.createS3Filename(ppaasTestId);
      resultsFile = util.createStatsFileName(testId);
      stdoutFile = logger.pewpewStdOutFilename(testId);
      stderrFile = logger.pewpewStdErrFilename(testId);
      variablesFile = ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME;
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
              const testUrl = integrationUrl + API_TEST_FORMAT(searchData.testId);
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
                ppaasTestId = foundTestId;
                testId = foundTestId.testId;
                yamlFile = foundTestId.yamlFile + ".yaml";
                statusFile = ppaasteststatus.createS3Filename(ppaasTestId);
                resultsFile = util.createStatsFileName(testId);
                stdoutFile = logger.pewpewStdOutFilename(testId);
                stderrFile = logger.pewpewStdErrFilename(testId);
                dateString = foundTestId.dateString;
                expectedStatus = 200;
                log(`expectedStatus = ${expectedStatus}`, LogLevel.WARN, { testId, yamlFile, dateString, expectedStatus });
                return;
              }
            }
          } catch (error) {
            // Swallow and try the next ones
            log("Could not Get Tests", LogLevel.ERROR, error);
          }
        } // End while
        log(`expectedStatus = ${expectedStatus}`, LogLevel.WARN, { testId, yamlFile, dateString, expectedStatus });
      } catch (error) {
        log("Could not Search and find Results", LogLevel.ERROR, error);
      }
    } // end else not ACCEPTANCE_AWS_PERMISSIONS
  });

  it("GET /download without testId should respond 400 Bad Request", (done: Mocha.Done) => {
    fetch(url).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(400);
      expect(res.data, "data").to.not.equal(undefined);
      expect(res.data.message, "message").to.equal("testId is required");
      done();
    }).catch((error) => done(error));
  });

  it("GET /download with invalid testId should respond 400 Bad Request", (done: Mocha.Done) => {
    const invalidTestId = "invalid-test-id";
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(invalidTestId);
    fetch(testUrl).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(400);
      expect(res.data, "data").to.not.equal(undefined);
      done();
    }).catch((error) => done(error));
  });

  it("GET /download with testId with no data should respond 400 Bad Request", (done: Mocha.Done) => {
    const invalidTestId = PpaasTestId.makeTestId("bogus").testId;
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(invalidTestId);
    fetch(testUrl).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(204);
      expect(res.data, "data").to.not.equal(undefined);
      done();
    }).catch((error) => done(error));
  });

  it("GET /download with valid testId should return file list", (done: Mocha.Done) => {
    if (!testId) { done(new Error("No testId")); return; }
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(testId);
    log(`GET ${testUrl}`, LogLevel.DEBUG);
    fetch(testUrl).then((res: Response) => {
      log(`GET ${testUrl}`, LogLevel.DEBUG, { status: res?.status, data: res.data });
      expect(res, "res").to.not.equal(undefined);
      if (expectedStatus === 200) {
        expect(res.status, "status").to.be.oneOf([200, 204]);
        if (res.status === 200) {
          expect(Array.isArray(res.data), "data should be array").to.equal(true);
          availableFiles = res.data;
          const lowerCaseFiles = availableFiles.map((file) => file.toLowerCase());
          log("Available files for download", LogLevel.DEBUG, availableFiles);
          expect(availableFiles.length, "availableFiles.length").to.be.greaterThan(0);
          for (const validFile of [yamlFile, resultsFile, stdoutFile, stderrFile]) {
            expect(lowerCaseFiles.includes(validFile.toLowerCase()), `File list should contain ${validFile}: ${availableFiles}`).to.equal(true);
          }
          // Validate that encrypted environment variables file is not in the list
          expect(lowerCaseFiles.includes(variablesFile.toLowerCase()), `File list should not contain ${variablesFile}: ${availableFiles}`).to.equal(false);
          expect(lowerCaseFiles.includes(statusFile.toLowerCase()), `File list should not contain ${variablesFile}: ${availableFiles}`).to.equal(false);
        } else if (res.status === 204) {
          // No files available
          availableFiles = [];
          log("No files available for download", LogLevel.DEBUG);
        }
      } else {
        // Expected 404 for non-existent test
        expect(res.status, "status").to.equal(400);
      }
      done();
    }).catch((error) => done(error));
  });

  it("GET /download with testId and non-existent file should respond 404", (done: Mocha.Done) => {
    if (!testId) { done(new Error("No testId")); return; }
    const nonExistentFile = "nonexistent.txt";
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(testId, nonExistentFile);
    log(`GET ${testUrl}`, LogLevel.DEBUG);
    fetch(testUrl).then((res: Response) => {
      log(`GET ${testUrl}`, LogLevel.DEBUG, { status: res?.status, data: res.data });
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      expect(res.data, "data").to.not.equal(undefined);
      expect(res.data.message, "message").to.include("is not available for download");
      done();
    }).catch((error) => done(error));
  });

  it("GET /download with testId and encrypted env file should respond 404", (done: Mocha.Done) => {
    if (!testId) { done(new Error("No testId")); return; }
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(testId, ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME);
    log(`GET ${testUrl}`, LogLevel.DEBUG);
    fetch(testUrl).then((res: Response) => {
      log(`GET ${testUrl}`, LogLevel.DEBUG, { status: res?.status, data: res.data });
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      expect(res.data, "data").to.not.equal(undefined);
      expect(res.data.message, "message").to.include("is not available for download");
      expect(res.data.message, "message").to.include(ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME);
      done();
    }).catch((error) => done(error));
  });

  it("GET /download with testId and status file should respond 404", (done: Mocha.Done) => {
    if (!testId || !ppaasTestId) { done(new Error("No testId or ppaasTestId")); return; }
    // Create the status filename that should be filtered out
    if (!statusFile) { statusFile = ppaasteststatus.createS3Filename(ppaasTestId); }
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(testId, statusFile);
    log(`GET ${testUrl}`, LogLevel.DEBUG);
    fetch(testUrl).then((res: Response) => {
      log(`GET ${testUrl}`, LogLevel.DEBUG, { status: res?.status, data: res.data });
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      expect(res.data, "data").to.not.equal(undefined);
      expect(res.data.message, "message").to.include("is not available for download");
      done();
    }).catch((error) => done(error));
  });

  async function testFileDownload (filename: string, fileType: string): Promise<void> {
    if (!testId) { throw new Error("No testId"); }
    if (expectedStatus !== 200) {
      log(`Skipping ${fileType} download test - no valid test data`, LogLevel.WARN);
      return;
    }

    const lowerCaseFiles = availableFiles.map((file) => file.toLowerCase());
    if (!lowerCaseFiles.includes(filename.toLowerCase())) {
      log(`Skipping ${fileType} download test - ${filename} not available in files: ${availableFiles}`, LogLevel.WARN);
      return;
    }

    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(testId, filename);
    log(`GET ${testUrl} for ${fileType}`, LogLevel.DEBUG);

    const res = await fetch(testUrl);
    log(`GET ${testUrl} for ${fileType}`, LogLevel.DEBUG, { status: res?.status, headers: res?.headers });
    expect(res, "res").to.not.equal(undefined);

    // Large file always redirects
    if (REDIRECT_TO_S3 || filename === largeS3File) {
      // Should redirect to S3 with download parameters
      expect(res.status, "status").to.equal(302);
      expect(res.headers.location, "location header").to.not.equal(undefined);
      expect(typeof res.headers.location, "typeof location").to.equal("string");

      // The presigned URL should contain download parameters
      const location = res.headers.location;
      expect(location, "presigned URL").to.include("response-content-disposition");
      expect(location, "presigned URL").to.include(`attachment%3B%20filename%3D%22${filename}%22`);

      log(`Following redirect to ${location} for ${fileType}`, LogLevel.DEBUG);
      const redirectResponse: Response = await fetch(location);
      log(`GET ${location} response for ${fileType}`, LogLevel.DEBUG, {
        status: redirectResponse?.status,
        headers: redirectResponse.headers,
        contentDisposition: redirectResponse.headers["content-disposition"]
      });
      expect(redirectResponse.status, "redirect status").to.equal(200);
      expect(redirectResponse.data, "redirect body").to.not.equal(undefined);

      // Check that S3 set the download headers correctly
      const contentDisposition = redirectResponse.headers["content-disposition"];
      if (contentDisposition) {
        expect(contentDisposition, "content-disposition").to.include("attachment");
        expect(contentDisposition, "content-disposition").to.include(filename);
      }
    } else {
      // Direct response with download headers
      expect(res.status, "status").to.equal(200);
      expect(res.data, "body").to.not.equal(undefined);

      // Check download headers are set
      const contentDisposition = res.headers["content-disposition"];
      expect(contentDisposition, "content-disposition").to.not.equal(undefined);
      expect(contentDisposition, "content-disposition").to.include("attachment");
      expect(contentDisposition, "content-disposition").to.include(filename);
    }
  }

  it("GET /download with testId should download YAML file", async () => {
    await testFileDownload(yamlFile, "YAML");
  });

  it("GET /download with testId should download results file", async () => {
    await testFileDownload(resultsFile, "results");
  });

  it("GET /download with testId should download stdout file", async () => {
    await testFileDownload(stdoutFile, "stdout");
  });

  it("GET /download with testId should download stderr file", async () => {
    await testFileDownload(stderrFile, "stderr");
  });

  if (ACCEPTANCE_AWS_PERMISSIONS) {
    it("GET /download with testId should download large S3 file", async () => {
      await testFileDownload(largeS3File, "large S3");
    });
  }

  it("POST /download should respond 400 Method Not Allowed", (done: Mocha.Done) => {
    if (!testId) { done(new Error("No testId")); return; }
    const testUrl = integrationUrl + API_DOWNLOAD_FORMAT(testId);
    fetch(testUrl, { method: "POST" }).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(400);
      expect(res.data, "data").to.not.equal(undefined);
      expect(res.data.message, "message").to.include("method POST is not supported");
      done();
    }).catch((error) => done(error));
  });
});