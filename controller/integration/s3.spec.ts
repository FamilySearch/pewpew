import { IncomingMessage, ServerResponse } from "http";
import { LogLevel, log } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { cleanupAcceptanceFiles, uploadAcceptanceFiles } from "./util";
import { Socket } from "net";
import { expect } from "chai";
import { getS3Response } from "../src/s3";

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
  let largeS3File: string;

  before(async () => {
    try {
      // Upload files in case createtest hasn't run.
      const { yamlFile, ppaasTestId, largeS3File: uploadedLargeS3File, ...rest } = await uploadAcceptanceFiles();
      filename = yamlFile;
      s3Folder = ppaasTestId.s3Folder;
      largeS3File = uploadedLargeS3File;
      log("S3 Integration files", LogLevel.WARN, { filename, s3Folder, yamlFile, ppaasTestId, ...rest });
      expect(filename, "filename").to.not.equal(undefined);
      expect(filename.length, "filename.length").to.be.greaterThan(0);
      expect(s3Folder, "s3Folder").to.not.equal(undefined);
      expect(s3Folder.length, "s3Folder.length").to.be.greaterThan(0);
    } catch (error) {
      log("S3 Integration before could not find a file in S3", LogLevel.ERROR, error);
      throw error;
    }
  });
  after(async () => {
    try {
      await cleanupAcceptanceFiles();
    } catch (error) {
      log("S3 Integration after could not cleanup files in S3", LogLevel.ERROR, error);
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
        json: (data: any) => {
          responseBody = data;
          serverResponse.end(JSON.stringify(data));
          return response;
        },
        status: (statusCode: number) => {
          serverResponse.statusCode = statusCode;
          return response;
        },
        // Next.js writeHead lets us pass headers as an object, but ServerResponse wants a Map so override
        writeHead: (statusCode: number, headers?: any) => {
          serverResponse.statusCode = statusCode;
          if (headers) {
            // Next.js lets us use an object, ServerResponse wants a Map
            const headersMap = new Map<string, string>(Object.entries(headers));
            serverResponse.setHeaders(headersMap);
          }
          return serverResponse;
        },
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
        log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
        expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
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

    it("getS3Response with downloadFile=true and no redirect should set download headers", (done: Mocha.Done) => {
      const redirectToS3 = false;
      const unzipS3Objects = false;
      const downloadFile = true;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(200);
        expect(responseBody, "responseBody").to.not.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.includes("content-disposition"), `${JSON.stringify(headerNames)}.includes("content-disposition")`).to.equal(true);
        expect(response.getHeader("content-disposition"), "res.getHeader(\"content-disposition\")").to.equal(`attachment; filename="${filename}"`);
        for (const expectedHeaderName of EXPECTED_HEADER_NAMES) {
          expect(headerNames.includes(expectedHeaderName), `${JSON.stringify(headerNames)}.includes("${expectedHeaderName}")`).to.equal(true);
        }
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3, downloadFile });
        done(error);
      });
    });

    it("getS3Response with downloadFile=false and no redirect should set inline headers", (done: Mocha.Done) => {
      const redirectToS3 = false;
      const unzipS3Objects = false;
      const downloadFile = false;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(200);
        expect(responseBody, "responseBody").to.not.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, headerNames);
        expect(headerNames.includes("content-disposition"), `${JSON.stringify(headerNames)}.includes("content-disposition")`).to.equal(true);
        expect(response.getHeader("content-disposition"), "res.getHeader(\"content-disposition\")").to.equal("inline");
        for (const expectedHeaderName of EXPECTED_HEADER_NAMES) {
          expect(headerNames.includes(expectedHeaderName), `${JSON.stringify(headerNames)}.includes("${expectedHeaderName}")`).to.equal(true);
        }
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3, downloadFile });
        done(error);
      });
    });

    it("getS3Response with downloadFile=true and redirect should create presigned URL with download parameters", (done: Mocha.Done) => {
      const redirectToS3 = true;
      const unzipS3Objects = false;
      const downloadFile = true;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(302);
        expect(responseBody, "responseBody").to.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
        expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3, downloadFile });
        done(error);
      });
    });

    it("getS3Response with downloadFile=false and redirect should create presigned URL without download parameters", (done: Mocha.Done) => {
      const redirectToS3 = true;
      const unzipS3Objects = false;
      const downloadFile = false;
      getS3Response({ request, response, filename, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
        expect(result, "result").to.equal(true);
        expect(response.statusCode, "res.statusCode").to.equal(302);
        expect(responseBody, "responseBody").to.equal(undefined);
        const headerNames = response.getHeaderNames();
        log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
        expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
        done();
      }).catch((error) => {
        log("getS3Response failed", LogLevel.ERROR, error, { filename, s3Folder, redirectToS3, downloadFile });
        done(error);
      });
    });

    describe("Large file tests > MAX_API_SIZE", () => {
      it("getS3Response with large file and no redirect should return 413 (downloadFile=false)", (done: Mocha.Done) => {
        const redirectToS3 = false;
        const unzipS3Objects = false;
        const downloadFile = false;
        getS3Response({ request, response, filename: largeS3File, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
          log("Large file tests getS3Response", LogLevel.DEBUG, { redirectToS3, unzipS3Objects, downloadFile, statusCode: response.statusCode, location: response.getHeader("Location") });
          expect(result, "result").to.equal(true);
          expect(response.statusCode, "res.statusCode").to.equal(413);
          expect(responseBody, "responseBody").to.not.equal(undefined);
          const errorResponse = responseBody as any;
          expect(errorResponse.message, "error message").to.include("Reponse is too large");
          done();
        }).catch((error) => {
          log("getS3Response failed", LogLevel.ERROR, error, { filename: largeS3File, s3Folder, redirectToS3, downloadFile });
          done(error);
        });
      });

      it("getS3Response with large file and no redirect should return 302 (downloadFile=true)", (done: Mocha.Done) => {
        const redirectToS3 = false;
        const unzipS3Objects = false;
        const downloadFile = true;
        getS3Response({ request, response, filename: largeS3File, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
          log("Large file tests getS3Response", LogLevel.DEBUG, { redirectToS3, unzipS3Objects, downloadFile, statusCode: response.statusCode, location: response.getHeader("Location") });
          expect(result, "result").to.equal(true);
          expect(response.statusCode, "res.statusCode").to.equal(302);
          expect(responseBody, "responseBody").to.equal(undefined);
          const headerNames = response.getHeaderNames();
          log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
          expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
          done();
        }).catch((error) => {
          log("getS3Response failed", LogLevel.ERROR, error, { filename: largeS3File, s3Folder, redirectToS3, downloadFile });
          done(error);
        });
      });

      it("getS3Response with large file and redirect should return 302 (downloadFile=false)", (done: Mocha.Done) => {
        const redirectToS3 = true;
        const unzipS3Objects = false;
        const downloadFile = false;
        getS3Response({ request, response, filename: largeS3File, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
          log("Large file tests getS3Response", LogLevel.DEBUG, { redirectToS3, unzipS3Objects, downloadFile, statusCode: response.statusCode, location: response.getHeader("Location") });
          expect(result, "result").to.equal(true);
          expect(response.statusCode, "res.statusCode").to.equal(302);
          expect(responseBody, "responseBody").to.equal(undefined);
          const headerNames = response.getHeaderNames();
          log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
          expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
          done();
        }).catch((error) => {
          log("getS3Response failed", LogLevel.ERROR, error, { filename: largeS3File, s3Folder, redirectToS3, downloadFile });
          done(error);
        });
      });

      it("getS3Response with large file and redirect should return 302 (downloadFile=true)", (done: Mocha.Done) => {
        const redirectToS3 = true;
        const unzipS3Objects = false;
        const downloadFile = true;
        getS3Response({ request, response, filename: largeS3File, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
          log("Large file tests getS3Response", LogLevel.DEBUG, { redirectToS3, unzipS3Objects, downloadFile, statusCode: response.statusCode, location: response.getHeader("Location") });
          expect(result, "result").to.equal(true);
          expect(response.statusCode, "res.statusCode").to.equal(302);
          expect(responseBody, "responseBody").to.equal(undefined);
          const headerNames = response.getHeaderNames();
          log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
          expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
          done();
        }).catch((error) => {
          log("getS3Response failed", LogLevel.ERROR, error, { filename: largeS3File, s3Folder, redirectToS3, downloadFile });
          done(error);
        });
      });

      it("getS3Response with large file, unzip, and no redirect should return 413 (downloadFile=false)", (done: Mocha.Done) => {
        const redirectToS3 = false;
        const unzipS3Objects = true;
        const downloadFile = false;
        getS3Response({ request, response, filename: largeS3File, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
          log("Large file tests getS3Response", LogLevel.DEBUG, { redirectToS3, unzipS3Objects, downloadFile, statusCode: response.statusCode, location: response.getHeader("Location") });
          expect(result, "result").to.equal(true);
          expect(response.statusCode, "res.statusCode").to.equal(413);
          expect(responseBody, "responseBody").to.not.equal(undefined);
          const errorResponse = responseBody as any;
          expect(errorResponse.message, "error message").to.include("Reponse is too large");
          done();
        }).catch((error) => {
          log("getS3Response failed", LogLevel.ERROR, error, { filename: largeS3File, s3Folder, redirectToS3, downloadFile, unzipS3Objects });
          done(error);
        });
      });

      it("getS3Response with large file, unzip, and no redirect should return 302 (downloadFile=true)", (done: Mocha.Done) => {
        const redirectToS3 = false;
        const unzipS3Objects = true;
        const downloadFile = true;
        getS3Response({ request, response, filename: largeS3File, s3Folder, redirectToS3, unzipS3Objects, downloadFile }).then((result: boolean) => {
          log("Large file tests getS3Response", LogLevel.DEBUG, { redirectToS3, unzipS3Objects, downloadFile, statusCode: response.statusCode, location: response.getHeader("Location") });
          expect(result, "result").to.equal(true);
          expect(response.statusCode, "res.statusCode").to.equal(302);
          expect(responseBody, "responseBody").to.equal(undefined);
          const headerNames = response.getHeaderNames();
          log("headerNames", LogLevel.DEBUG, { headerNames, headers: response.getHeaders() });
          expect(headerNames.includes("location"), `${JSON.stringify(headerNames)}.includes("location")`).to.equal(true);
          done();
        }).catch((error) => {
          log("getS3Response failed", LogLevel.ERROR, error, { filename: largeS3File, s3Folder, redirectToS3, downloadFile, unzipS3Objects });
          done(error);
        });
      });
    });
  });
});