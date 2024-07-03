import { API_SEARCH, API_TEST_STATUS, TestData, TestManagerMessage } from "../types";
import { LogLevel, PpaasTestId, TestStatus, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { expect } from "chai";
import { getTestData } from "./test.spec";
import { integrationUrl } from "./util";

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

let sharedSearchResults: TestData[] | undefined;

async function getSearchResults (): Promise<TestData[]> {
  if (sharedSearchResults) { return sharedSearchResults; }
  await initSharedSearchResults();
  return sharedSearchResults!;
}

async function initSharedSearchResults (): Promise<void> {
  if (!sharedSearchResults) {
    const url: string = integrationUrl + API_SEARCH;
    log("initSharedSearchResults url=" + url, LogLevel.DEBUG);
    try {
      const response: Response = await fetch(`${url}?s3Folder=&maxResults=100`);
      log("GET /search res", LogLevel.DEBUG, response);
      const body: unknown = response.data;
      log("body: " + body, LogLevel.DEBUG, body);
      expect(body, "body").to.not.equal(undefined);
      expect(Array.isArray(body), "isArray").to.equal(true);
      expect((body as unknown[]).length, "body.length").to.be.greaterThan(0);
      const testElement: unknown = (body as unknown[])[0];
      expect("testId" in (testElement as TestData), "testId in element").to.equal(true);
      expect("s3Folder" in (testElement as TestData), "s3Folder in element").to.equal(true);
      expect("status" in (testElement as TestData), "status in element").to.equal(true);
      // Search a few of them and see if any are finished
      sharedSearchResults = body as TestData[];
    } catch (error) {
      log("GET /search error", LogLevel.ERROR, error);
      throw error;
    }
  }
}

describe("Search API Integration", () => {
  let s3Folder: string | undefined;
  let url: string;

  before(async () => {
    url = integrationUrl + API_SEARCH;
    log("search tests url=" + url, LogLevel.DEBUG);
    const testData = await getTestData();
    s3Folder = testData.s3Folder;
  });

  describe("GET /search", () => {
    it("GET /search should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url).then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("GET /search?s3Folder=NotInS3 should respond 204 No Content", (done: Mocha.Done) => {
      const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").s3Folder;
      log("validButNotInS3 s3Folder: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      fetch(url + "?s3Folder=" + validButNotInS3).then((res: Response) => {
        expect(res.status).to.equal(204);
        done();
      }).catch((error) => done(error));
    });

    it("GET /search?s3Folder=. character should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url + "?s3Folder=.").then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("GET /search?s3Folder=validInS3 should respond 200 OK", (done: Mocha.Done) => {
      if (s3Folder) {
        log("validInS3 s3Folder: " + s3Folder, LogLevel.DEBUG, s3Folder);
        fetch(url + "?s3Folder=" + s3Folder).then((res: Response) => {
          log ("validInS3 response", LogLevel.DEBUG, res);
          expect(res.status, JSON.stringify(res.data)).to.equal(200);
          const body: unknown = res.data;
          expect(body).to.not.equal(undefined);
          expect(Array.isArray(body), "isArray").to.equal(true);
          const results = body as unknown[];
          expect(results.length).to.be.greaterThan(0);
          const result: unknown = results[0];
          expect(typeof result).to.equal("object");
          expect(typeof (result as TestData).testId, "typeof testId").to.equal("string");
          expect(typeof (result as TestData).s3Folder, "typeof s3Folder").to.equal("string");
          expect(typeof (result as TestData).status, "typeof status").to.equal("string");
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No s3Folder"));
      }
    });

    it("GET /search?s3Folder= empty should respond 200 OK", (done: Mocha.Done) => {
      log("validInS3 s3Folder: ", LogLevel.DEBUG, s3Folder);
      fetch(url + "?s3Folder=").then((res: Response) => {
        log ("validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.data)).to.equal(200);
        const body: unknown = res.data;
        expect(body).to.not.equal(undefined);
        expect(Array.isArray(body), "isArray").to.equal(true);
        const results = body as unknown[];
        expect(results.length).to.be.greaterThan(0);
        const result: unknown = results[0];
        expect(typeof result).to.equal("object");
        expect(typeof (result as TestData).testId, "typeof testId").to.equal("string");
        expect(typeof (result as TestData).s3Folder, "typeof s3Folder").to.equal("string");
        expect(typeof (result as TestData).status, "typeof status").to.equal("string");
        done();
      }).catch((error) => done(error));
    });

    it("GET /search?s3Folder=validInS3&s3Folder=validInS3 should respond 400 BadRequest", (done: Mocha.Done) => {
      if (s3Folder) {
        log("validInS3 s3Folder: " + s3Folder, LogLevel.DEBUG, s3Folder);
        fetch(url + "?s3Folder=" + s3Folder + "&s3Folder=" + s3Folder).then((res: Response) => {
          expect(res.status).to.equal(400);
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No s3Folder"));
      }
    });
  });

  describe("PUT /search", () => {
    it("PUT /search should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url, { method: "PUT" }).then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("PUT /search?s3Folder=NotInS3 should respond 204 No Content", (done: Mocha.Done) => {
      const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").s3Folder;
      log("validButNotInS3 s3Folder: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      fetch(url + "?s3Folder=" + validButNotInS3, { method: "PUT" }).then((res: Response) => {
        expect(res.status).to.equal(204);
        done();
      }).catch((error) => done(error));
    });

    it("PUT /search?s3Folder=validInS3 should respond 200 OK", (done: Mocha.Done) => {
      if (s3Folder) {
        log("validInS3 s3Folder: " + s3Folder, LogLevel.DEBUG, s3Folder);
        fetch(url + "?s3Folder=" + s3Folder, { method: "PUT" }).then((res: Response) => {
          log ("validInS3 response", LogLevel.DEBUG, res);
          expect(res.status, JSON.stringify(res.data)).to.equal(200);
          const body: unknown = res.data;
          expect(body).to.not.equal(undefined);
          expect(Array.isArray(body), "isArray").to.equal(true);
          const results = body as unknown[];
          expect(results.length).to.be.greaterThan(0);
          const result: unknown = results[0];
          expect(typeof result).to.equal("object");
          expect(typeof (result as TestData).testId, "typeof testId").to.equal("string");
          expect(typeof (result as TestData).s3Folder, "typeof s3Folder").to.equal("string");
          expect(typeof (result as TestData).status, "typeof status").to.equal("string");
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No s3Folder"));
      }
    });

    it("PUT /search?s3Folder=validInS3&s3Folder=validInS3 should respond 400 BadRequest", (done: Mocha.Done) => {
      if (s3Folder) {
        log("validInS3 s3Folder: " + s3Folder, LogLevel.DEBUG, s3Folder);
        fetch(url + "?s3Folder=" + s3Folder + "&s3Folder=" + s3Folder, { method: "PUT" }).then((res: Response) => {
          expect(res.status).to.equal(400);
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No s3Folder"));
      }
    });
  });
});

describe("TestStatus API Integration", () => {
  let createdTestData: TestData | undefined;
  let searchedTestData: TestData | undefined;
  let url: string;

  before(async () => {
    url = integrationUrl + API_TEST_STATUS;
    log("teststatus tests url=" + url, LogLevel.DEBUG);
    createdTestData = await getTestData();
    const searchResults = await getSearchResults();
    expect(searchResults.length).to.be.greaterThan(0);
    searchedTestData = searchResults[0];
  });

  it("GET /teststatus should respond 400 Bad Request", (done: Mocha.Done) => {
    fetch(url).then((res: Response) => {
      expect(res.status).to.equal(400);
      done();
    }).catch((error) => done(error));
  });

  it("GET /teststatus?testId=NotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
    const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").testId;
    log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
    fetch(url + "?testId=" + validButNotInS3).then((res: Response) => {
      expect(res.status).to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET /teststatus?testId=createdInS3 should respond 200 OK", (done: Mocha.Done) => {
    if (createdTestData) {
      log("createdInS3 testId: " + createdTestData.testId, LogLevel.DEBUG, createdTestData);
      fetch(url + "?testId=" + createdTestData.testId).then((res: Response) => {
        log ("createdInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.data)).to.equal(200);
        const body: unknown = res.data;
        expect(body).to.not.equal(undefined);
        expect(typeof body, "typeof body").to.equal("object");
        expect(typeof (body as TestManagerMessage).message, "typeof message").to.equal("string");
          const status: string = (body as TestManagerMessage).message;
          expect((Object.values(TestStatus) as string[]).includes(status), "status is TestStatus").to.equal(true);
          expect(status, "status").to.equal(createdTestData!.status);
          done();
      }).catch((error) => done(error));
    } else {
      done(new Error("No testId"));
    }
  });

  it("GET /teststatus?testId=foundInS3 should respond 200 OK", (done: Mocha.Done) => {
    if (searchedTestData) {
      log("foundInS3 testId: " + searchedTestData.testId, LogLevel.DEBUG, searchedTestData);
      fetch(url + "?testId=" + searchedTestData.testId).then((res: Response) => {
        log ("foundInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.data)).to.equal(200);
        const body: unknown = res.data;
        expect(body).to.not.equal(undefined);
        expect(typeof body, "typeof body").to.equal("object");
        expect(typeof (body as TestManagerMessage).message, "typeof message").to.equal("string");
        const status: string = (body as TestManagerMessage).message;
        expect((Object.values(TestStatus) as string[]).includes(status), "status is TestStatus").to.equal(true);
        expect(status, "status").to.not.equal(TestStatus.Unknown);
        if (searchedTestData && searchedTestData.status !== TestStatus.Unknown) {
          expect(status, "status").to.equal(searchedTestData!.status);
        }
        done();
      }).catch((error) => done(error));
    } else {
      done(new Error("No testId"));
    }
  });

  it("GET /teststatus?testId=validInS3&testId=validInS3 should respond 400 BadRequest", (done: Mocha.Done) => {
    if (createdTestData) {
      const createdTestId = createdTestData.testId;
      log("validInS3 testId: " + createdTestId, LogLevel.DEBUG, createdTestId);
      fetch(url + "?testId=" + createdTestId + "&testId=" + createdTestId).then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    } else {
      done(new Error("No testId"));
    }
  });
});
