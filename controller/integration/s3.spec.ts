import { IncomingMessage, ServerResponse } from "http";
import { LogLevel, log, logger, s3 } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { Socket } from "net";
import { expect } from "chai";
import { getS3Response } from "../pages/api/util/s3";

logger.config.LogFileName = "ppaas-controller";

const GZIP_HEADER_NAME = "content-encoding";
const GZIP_HEADER_VALUE = "gzip";
const EXPECTED_HEADER_NAMES = [
  "content-disposition",
  // "content-length", // https://github.com/vercel/next.js/issues/53737#issuecomment-1688709093
  "cache-control",
  "content-type",
  "etag"
];

describe("S3 Integration", () => {
  let filename: string;
  let s3Folder: string;

  before(async () => {
    try {
      // Get file
      const testFolder = "createtest";
      const files = await s3.listFiles({ s3Folder: "createtest", extension: "yaml", maxKeys: 1 });
      if (!files || files.length === 0) {
        throw new Error(`No files found in [${testFolder}]. Please run "npm run createtest" from the agent project`);
      }
      const file = files[0];
      if (!file.Key) {
        throw new Error(`${testFolder} file did not have a key`);
      }
      const key = s3.KEYSPACE_PREFIX && file.Key.startsWith(s3.KEYSPACE_PREFIX)
        ? file.Key.replace(s3.KEYSPACE_PREFIX, "")
        : file.Key;
      const split = key.split("/");
      filename = split.pop()!;
      s3Folder = split.join("/");
      log("S3 Integration key", LogLevel.WARN, { filename, s3Folder, key, keyOrig: file.Key });
      expect(filename, "filename").to.not.equal(undefined);
      expect(filename.length, "filename.length").to.be.greaterThan(0);
      expect(s3Folder, "s3Folder").to.not.equal(undefined);
      expect(s3Folder.length, "s3Folder.length").to.be.greaterThan(0);
    } catch (error) {
      log("S3 Integration before could not find a file in S3", LogLevel.ERROR, error);
      throw error;
    }
  });

  describe("getS3Response", () => {
    let request: NextApiRequest;
    let response: NextApiResponse;
    let defaultStatusCode: number;
    let responseBody: unknown;

    beforeEach(() => {
      const incomingMessage = new IncomingMessage(new Socket());
      request = Object.assign(incomingMessage, {
        query: {},
        cookies: {},
        body: undefined,
        env: {},
        headers: {
          host: "localhost:3000"
        }
      });
      const serverResponse = new ServerResponse(incomingMessage);
      response = Object.assign(serverResponse, {
        send: (data: unknown) => { responseBody = data; return; },
        json: (data: any) => { serverResponse.end(JSON.stringify(data)); },
        status: (statusCode: number) => serverResponse.statusCode = statusCode,
        redirect: () => serverResponse as unknown as NextApiResponse,
        setDraftMode: () => serverResponse as unknown as NextApiResponse,
        setPreviewData: () => serverResponse as unknown as NextApiResponse,
        clearPreviewData: () => serverResponse as unknown as NextApiResponse,
        revalidate: (_data: any) => { return; }
      } as unknown as NextApiResponse);

      responseBody = undefined;
      defaultStatusCode = response.statusCode = 0; // Defaults to 200 otherwise
      log("getS3Response beforeEach", LogLevel.WARN, { defaultStatusCode, responseBody });
    });

    it("getS3Response no redirect should find s3 file and return 200", (done: Mocha.Done) => {
      const redirectToS3 = false;
      const unzipS3Objects = false;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(200);
        expect(responseBody, "responseBody").to.not.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.includes(GZIP_HEADER_NAME), `${JSON.stringify(headerNames)}.includes("${GZIP_HEADER_NAME}")`).to.equal(true);
        expect(response.getHeader(GZIP_HEADER_NAME), `res.getHeader("${GZIP_HEADER_NAME}")`).to.equal(GZIP_HEADER_VALUE);
        for (const expectedHeaderName of EXPECTED_HEADER_NAMES) {
          expect(headerNames.includes(expectedHeaderName), `${JSON.stringify(headerNames)}.includes("${expectedHeaderName}")`).to.equal(true);
        }
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3 });
        done(error);
      });
    });

    it("getS3Response no redirect should not find bogus file", (done: Mocha.Done) => {
      const redirectToS3 = false;
      const unzipS3Objects = false;
      getS3Response({ request, response, filename: "bogus.yaml", s3Folder, redirectToS3, unzipS3Objects }).then((result: boolean) => {
        expect(result, "result").to.equal(false);
        expect(response.statusCode, "res.statusCode").to.equal(defaultStatusCode);
        expect(responseBody, "responseBody").to.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.length, "headerNames.length").to.equal(0);
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename: "bogus.yaml", s3Folder, redirectToS3 });
        done(error);
      });
    });

    it("getS3Response unzip should find s3 file and return 200", (done: Mocha.Done) => {
      const redirectToS3 = false;
      const unzipS3Objects = true;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(200);
        expect(responseBody, "responseBody").to.not.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.includes(GZIP_HEADER_NAME), `${JSON.stringify(headerNames)}.includes("${GZIP_HEADER_NAME}")`).to.equal(false);
        for (const expectedHeaderName of EXPECTED_HEADER_NAMES) {
          expect(headerNames.includes(expectedHeaderName), `${JSON.stringify(headerNames)}.includes("${expectedHeaderName}")`).to.equal(true);
        }
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3 });
        done(error);
      });
    });

    it("getS3Response unzip should not find bogus file", (done: Mocha.Done) => {
      const redirectToS3 = false;
      const unzipS3Objects = true;
      getS3Response({ request, response, filename: "bogus.yaml", s3Folder, redirectToS3, unzipS3Objects }).then((result: boolean) => {
        expect(result, "result").to.equal(false);
        expect(response.statusCode, "res.statusCode").to.equal(defaultStatusCode);
        expect(responseBody, "responseBody").to.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.length, "headerNames.length").to.equal(0);
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename: "bogus.yaml", s3Folder, redirectToS3 });
        done(error);
      });
    });

    it("getS3Response with redirect should find s3 file and return 302", (done: Mocha.Done) => {
      const redirectToS3 = true;
      const unzipS3Objects = false;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(302);
        expect(responseBody, "responseBody").to.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.WARN, { headerNames, headers: response.getHeaders() });
        // The default writeHead only sets the statusCode. Headers are set elsewhere on the return
        // expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3 });
        done(error);
      });
    });

    it("getS3Response with redirect should not find bogus file", (done: Mocha.Done) => {
      const redirectToS3 = true;
      const unzipS3Objects = false;
      getS3Response({ request, response, filename: "bogus.yaml", s3Folder, redirectToS3, unzipS3Objects }).then((result: boolean) => {
        expect(result, "result").to.equal(false);
        expect(response.statusCode, "res.statusCode").to.equal(defaultStatusCode);
        expect(responseBody, "responseBody").to.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.length, "headerNames.length").to.equal(0);
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename: "bogus.yaml", s3Folder, redirectToS3 });
        done(error);
      });
    });
  });
});