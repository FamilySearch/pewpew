import { API_STOP, TestManagerMessage } from "../types";
import { LogLevel, PpaasTestId, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { expect } from "chai";
import { getPpaasTestId } from "./test.spec";
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

describe("Stop API Integration", () => {
  let testId: string | undefined;
  let url: string;

  before(async () => {
    url = integrationUrl + API_STOP;
    log("smoke tests url=" + url, LogLevel.DEBUG);
    const ppaasTestId = await getPpaasTestId();
    testId = ppaasTestId.testId;
  });

  describe("GET /stop", () => {
    it("GET /stop should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url).then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("GET /stop?testId=invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url + "?testId=invalid").then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("GET /stop?testId=validButNotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
      const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").testId;
      log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      fetch(url + "?testId=" + validButNotInS3).then((res: Response) => {
        expect(res.status).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    it("GET /stop?testId=validInS3 should respond 200 OK", (done: Mocha.Done) => {
      if (testId) {
        log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
        fetch(url + "?testId=" + testId).then((res: Response) => {
          log ("validInS3 response", LogLevel.DEBUG, res);
          expect(res.status, JSON.stringify(res.data)).to.equal(200);
          const body: unknown = res.data;
          expect(body).to.not.equal(undefined);
          expect(typeof body, "typeof body").to.equal("object");
          expect(typeof (body as TestManagerMessage).message, "typeof message").to.equal("string");
          expect((body as TestManagerMessage).message, "message").to.include("Stop TestId " + testId);
          expect(typeof (body as TestManagerMessage).messageId, "typeof messageId").to.equal("string");
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No testId"));
      }
    });

    it("GET /stop?testId=validInS3&kill=true should respond 200 OK", (done: Mocha.Done) => {
      if (testId) {
        log("validInS3 kill testId: " + testId, LogLevel.DEBUG, testId);
        fetch(`${url}?testId=${testId}&kill=true`).then((res: Response) => {
          log ("validInS3 kill response", LogLevel.DEBUG, res);
          expect(res.status, JSON.stringify(res.data)).to.equal(200);
          const body: unknown = res.data;
          expect(body).to.not.equal(undefined);
          expect(typeof body, "typeof body").to.equal("object");
          expect(typeof (body as TestManagerMessage).message, "typeof message").to.equal("string");
          expect((body as TestManagerMessage).message, "message").to.include("Kill TestId " + testId);
          expect(typeof (body as TestManagerMessage).messageId, "typeof messageId").to.equal("string");
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No testId"));
      }
    });

    it("GET /stop?testId=validInS3&testId=validInS3 should respond 400 BadRequest", (done: Mocha.Done) => {
      if (testId) {
        log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
        fetch(url + "?testId=" + testId + "&testId=" + testId).then((res: Response) => {
          expect(res.status).to.equal(400);
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No testId"));
      }
    });
  });

  describe("PUT /stop", () => {
    it("PUT /stop should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url, { method: "PUT" }).then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("PUT /stop?testId=invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url + "?testId=invalid", { method: "PUT" }).then((res: Response) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("PUT /stop?testId=validButNotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
      const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").testId;
      log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      fetch(url + "?testId=" + validButNotInS3, { method: "PUT" }).then((res: Response) => {
        expect(res.status).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    it("PUT /stop?testId=validInS3 should respond 200 OK", (done: Mocha.Done) => {
      if (testId) {
        log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
        fetch(url + "?testId=" + testId, { method: "PUT" }).then((res: Response) => {
          log ("validInS3 response", LogLevel.DEBUG, res);
          expect(res.status).to.equal(200);
          expect(res.status, JSON.stringify(res.data)).to.equal(200);
          const body: unknown = res.data;
          expect(body).to.not.equal(undefined);
          expect(typeof body, "typeof body").to.equal("object");
          expect(typeof (body as TestManagerMessage).message, "typeof message").to.equal("string");
          expect((body as TestManagerMessage).message, "message").to.include("Stop TestId " + testId);
          expect(typeof (body as TestManagerMessage).messageId, "typeof messageId").to.equal("string");
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No testId"));
      }
    });

    it("PUT /stop?testId=validInS3&kill=true should respond 200 OK", (done: Mocha.Done) => {
      if (testId) {
        log("validInS3 kill testId: " + testId, LogLevel.DEBUG, testId);
        fetch(`${url}?testId=${testId}&kill=true`, { method: "PUT" }).then((res: Response) => {
          log ("validInS3 kill response", LogLevel.DEBUG, res);
          expect(res.status).to.equal(200);
          expect(res.status, JSON.stringify(res.data)).to.equal(200);
          const body: unknown = res.data;
          expect(body).to.not.equal(undefined);
          expect(typeof body, "typeof body").to.equal("object");
          expect(typeof (body as TestManagerMessage).message, "typeof message").to.equal("string");
          expect((body as TestManagerMessage).message, "message").to.include("Kill TestId " + testId);
          expect(typeof (body as TestManagerMessage).messageId, "typeof messageId").to.equal("string");
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No testId"));
      }
    });

    it("PUT /stop?testId=validInS3&testId=validInS3 should respond 400 BadRequest", (done: Mocha.Done) => {
      if (testId) {
        log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
        fetch(url + "?testId=" + testId + "&testId=" + testId, { method: "PUT" }).then((res: Response) => {
          expect(res.status).to.equal(400);
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No testId"));
      }
    });
  });
});
