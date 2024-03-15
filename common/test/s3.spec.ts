import * as path from "path";
import {
  CompleteMultipartUploadCommandOutput,
  CopyObjectCommandOutput,
  GetObjectCommandOutput,
  GetObjectTaggingCommandOutput,
  ListObjectsV2CommandOutput,
  PutObjectTaggingCommandOutput,
  _Object as S3Object
} from "@aws-sdk/client-s3";
import { LogLevel, S3File, log } from "../src/index";
import { Stats, createReadStream } from "fs";
import {
  UNIT_TEST_KEYSPACE_PREFIX,
  mockCopyObject,
  mockGetObject,
  mockGetObjectError,
  mockGetObjectTagging,
  mockListObjects,
  mockS3,
  mockUploadObject,
  resetMockS3
} from "./mock";
import {
  copyFile,
  copyObject,
  defaultTestFileTags,
  getFile,
  getFileContents,
  getObject,
  getObjectTagging,
  getTags,
  listFiles,
  listObjects,
  putObjectTagging,
  putTags,
  setAccessCallback,
  uploadFile,
  uploadFileContents,
  uploadObject
} from "../src/util/s3";
import { constants as bufferConstants } from "node:buffer";
import { expect } from "chai";
import fs from "fs/promises";
import { promisify } from "util";
import { gunzip as zlibGunzip } from "zlib";

const gunzip = promisify(zlibGunzip);
const { MAX_STRING_LENGTH } = bufferConstants;

export const UNIT_TEST_KEY_PREFIX: string = process.env.UNIT_TEST_KEY_PREFIX || "unittest";
export const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
export const UNIT_TEST_FILEPATH: string = process.env.UNIT_TEST_FILEPATH || ("test/" + UNIT_TEST_FILENAME);
export const UNIT_TEST_LOCAL_FILE_LOCATION: string = process.env.UNIT_TEST_LOCAL_FILE_LOCATION || process.env.TEMP || "/tmp";
export const MAX_POLL_WAIT: number = parseInt(process.env.MAX_POLL_WAIT || "0", 10) || 500;

const UNIT_TEST_KEY: string = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;

const s3TestObject: S3Object = {
  Key: UNIT_TEST_KEY,
  LastModified: new Date(),
  Size: 1,
  StorageClass: "STANDARD"
};

describe("S3Util", () => {
  let healthCheckDate: Date | undefined;

  before ( () => {
    mockS3();
    // Set the access callback to test that healthchecks will be updated
    setAccessCallback((date: Date) => healthCheckDate = date);
  });

  after(() => {
    // Reset the mock
    resetMockS3();
  });

  beforeEach( () => {
    // Set the access callback back undefined
    healthCheckDate = undefined;
  });

  afterEach ( () => {
    // If this is still undefined the access callback failed and was not updated with the last access date
    log("afterEach healthCheckDate=" + healthCheckDate, healthCheckDate ? LogLevel.DEBUG : LogLevel.ERROR);
    expect(healthCheckDate, "healthCheckDate").to.not.equal(undefined);
  });

  describe("TEST_FILE_TAGS", () => {
    it("should have key test", (done: Mocha.Done) => {
      try {
        expect(defaultTestFileTags()).to.not.equal(undefined);
        expect(defaultTestFileTags().size).to.equal(1);
        expect(defaultTestFileTags().has("test")).to.equal(true);
        expect(defaultTestFileTags().get("test")).to.equal("true");
        // This won't be set on failures, set it so the afterEach doesn't throw
        healthCheckDate = new Date();
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should should not be modifiable", (done: Mocha.Done) => {
      try {
        defaultTestFileTags().set("unittest", "true");
        defaultTestFileTags().delete("test");
        expect(defaultTestFileTags()).to.not.equal(undefined);
        expect(defaultTestFileTags().size).to.equal(1);
        expect(defaultTestFileTags().has("test")).to.equal(true);
        expect(defaultTestFileTags().get("test")).to.equal("true");
        // This won't be set on failures, set it so the afterEach doesn't throw
        healthCheckDate = new Date();
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("List Objects Empty in S3", () => {
    it("List Objects should always succeed even if empty", (done: Mocha.Done) => {
      mockListObjects([]);
      listObjects({ prefix: "bogus", maxKeys: 1}).then((result: ListObjectsV2CommandOutput) => {
        log(`listObjects("bogus", 1) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.Contents).to.not.equal(undefined);
        expect(result.Contents!.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("List Files", () => {
    it("List Files should always succeed even if empty", (done: Mocha.Done) => {
      mockListObjects([]);
      listFiles("bogus").then((result: S3Object[]) => {
        log(`listFiles("bogus") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files should return files", (done: Mocha.Done) => {
      mockListObjects([s3TestObject]);
      listFiles(UNIT_TEST_KEY_PREFIX).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.equal(1);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with extension should return files", (done: Mocha.Done) => {
      mockListObjects([s3TestObject]);
      listFiles({
        s3Folder: UNIT_TEST_KEY_PREFIX,
        extension: UNIT_TEST_FILENAME.slice(-3)
      }).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}", undefined, "${UNIT_TEST_FILENAME.slice(-3)}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with not found extension should not return files", (done: Mocha.Done) => {
      mockListObjects([s3TestObject]);
      listFiles({
        s3Folder: UNIT_TEST_KEY_PREFIX,
        extension: "bad"
      }).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}", undefined, "bad") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with extension array first should return files", (done: Mocha.Done) => {
      mockListObjects([s3TestObject]);
      listFiles({
        s3Folder: UNIT_TEST_KEY_PREFIX,
        extension: [UNIT_TEST_FILENAME.slice(-3), "bogus"]
      }).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}", undefined, ["${UNIT_TEST_FILENAME.slice(-3)}", "bogus"]) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with extension array second should return files", (done: Mocha.Done) => {
      mockListObjects([s3TestObject]);
      listFiles({
        s3Folder: UNIT_TEST_KEY_PREFIX,
        extension: ["bogus", UNIT_TEST_FILENAME.slice(-3)]
      }).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}", undefined, ["bogus", "${UNIT_TEST_FILENAME.slice(-3)}"]) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with not found extension array should not return files", (done: Mocha.Done) => {
      mockListObjects([s3TestObject]);
      listFiles({
        s3Folder: UNIT_TEST_KEY_PREFIX,
        extension: ["bad", "bogus"]
      }).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}", undefined, ["bad", "bogus"]) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload Object to S3", () => {
    it("Upload a test object to S3", (done: Mocha.Done) => {
      const baseName: string = path.basename(UNIT_TEST_FILEPATH);
      const s3File: S3File = {
        body: createReadStream(UNIT_TEST_FILEPATH),
        key: `${UNIT_TEST_KEY_PREFIX}/${baseName}`,
        contentType: "application/json"
      };
      const expectedLocation = mockUploadObject({ filename: baseName, folder: UNIT_TEST_KEY_PREFIX });
      uploadObject(s3File).then((result: CompleteMultipartUploadCommandOutput) => {
        log(`uploadObject result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.Location).to.equal(expectedLocation);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("should not modify existing tags", (done: Mocha.Done) => {
      const tags = new Map<string, string>([["unittest", "true"]]);
      const tagsBefore = tags.size;
      const baseName: string = path.basename(UNIT_TEST_FILEPATH);
      const s3File: S3File = {
        body: createReadStream(UNIT_TEST_FILEPATH),
        key: `${UNIT_TEST_KEY_PREFIX}/${baseName}`,
        contentType: "application/json",
        tags
      };
      const expectedLocation = mockUploadObject({ filename: baseName, folder: UNIT_TEST_KEY_PREFIX });
      uploadObject(s3File).then((result: CompleteMultipartUploadCommandOutput) => {
        log(`uploadObject result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.Location).to.equal(expectedLocation);
        // The additional default tag should not modify the existing object
        expect(tags.size).to.equal(tagsBefore);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload File to S3", () => {
    it("Upload a test file to S3", (done: Mocha.Done) => {
      const expectedLocation = mockUploadObject({ filename: path.basename(UNIT_TEST_FILEPATH), folder: UNIT_TEST_KEY_PREFIX });
      uploadFile({ filepath: UNIT_TEST_FILEPATH, s3Folder: UNIT_TEST_KEY_PREFIX }).then((url: string) => {
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        expect(url).to.equal(expectedLocation);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload File Contents to S3", () => {
    it("Upload a test string to S3", (done: Mocha.Done) => {
      const filename: string = path.basename(UNIT_TEST_FILEPATH);
      const expectedLocation = mockUploadObject({ filename, folder: UNIT_TEST_KEY_PREFIX });
      uploadFileContents({ contents: "test", filename, s3Folder: UNIT_TEST_KEY_PREFIX }).then((url: string) => {
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        expect(url).to.equal(expectedLocation);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Get Objects in S3", () => {
    let lastModified: Date;
    beforeEach ( () => {
      lastModified = new Date();
    });

    it("Get Object should return files", (done: Mocha.Done) => {
      mockGetObject();
      getObject(UNIT_TEST_KEY).then(async (result: GetObjectCommandOutput | undefined) => {
        log(`getObject(${UNIT_TEST_KEY}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result!.Body).to.not.equal(undefined);
        if (result!.ContentEncoding === "gzip" && result!.Body && typeof result!.Body == "object") {
          const body: Buffer = Buffer.from(await result!.Body.transformToByteArray());
          const zresult: Buffer = await gunzip(body);
          log(`result.Body = ${zresult.toString()}`, LogLevel.DEBUG);
          done();
      } else {
          log(`result.Body = ${await result!.Body!.transformToString()}`, LogLevel.DEBUG);
          done();
        }
      }).catch((error) => {
        done(error);
      });
    });

    it("Get Object should return changed files", (done: Mocha.Done) => {
      mockGetObject();
      const testModified: Date = new Date(lastModified.getTime() - 1000);
      getObject(UNIT_TEST_KEY, testModified).then((result: GetObjectCommandOutput | undefined) => {
        log(`getObject(${UNIT_TEST_KEY}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result!.Body).to.not.equal(undefined);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("Get Object should not return unchanged files", (done: Mocha.Done) => {
      mockGetObjectError(304);
      const testModified: Date = new Date(lastModified.getTime() + 1000);
      getObject(UNIT_TEST_KEY, testModified).then((_result: GetObjectCommandOutput | undefined) => {
        done(new Error("Should not succeed. We should get a Not Modified"));
      }).catch((error) => {
        log(`getObject(${UNIT_TEST_KEY}) error = ${error}`, LogLevel.DEBUG, error);
        try {
          expect(error, "error").to.not.equal(undefined);
          expect(error?.name, "error?.name").to.equal("304");
          done();
        } catch (error2) {
          done(error2);
        }
      });
    });
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;
    const testFilename: string = path.basename(UNIT_TEST_FILEPATH);
    let localFile: string | undefined;

    beforeEach (() => {
      lastModified = new Date();
    });

    afterEach (async () => {
      // Delete the local file
      if (localFile) {
        await fs.unlink(localFile)
        .catch((error) => log("Could not delete " + localFile, LogLevel.WARN, error));
      }
    });

    it("Get File should return files", (done: Mocha.Done) => {
      mockGetObject();
      getFile({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      }).then((downloadedLastModified: Date | undefined) => {
        log(`getFile(${testFilename}) result = ${JSON.stringify(downloadedLastModified)}`, LogLevel.DEBUG);
        expect(downloadedLastModified).to.not.equal(undefined);
        localFile = path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename);
        fs.stat(localFile).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          expect(stats).to.not.equal(undefined);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("Get File should return changed files", (done: Mocha.Done) => {
      mockGetObject();
      const testModified: Date = new Date(lastModified.getTime() - 1000);
      getFile({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        lastModified: testModified
      }).then((downloadedLastModified: Date | undefined) => {
        log(`getFile(${testFilename}) result = ${JSON.stringify(downloadedLastModified)}`, LogLevel.DEBUG);
        expect(downloadedLastModified).to.not.equal(undefined);
        localFile = path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename);
        fs.stat(localFile).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          expect(stats).to.not.equal(undefined);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("Get File should not return unchanged files", (done: Mocha.Done) => {
      mockGetObjectError(304);
      const testModified: Date = new Date(lastModified.getTime() + 1000);
      getFile({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        lastModified: testModified
      }).then((downloadedLastModified: Date | undefined) => {
        log(`getFile(${testFilename}) result = ${JSON.stringify(downloadedLastModified)}`, LogLevel.DEBUG);
        expect(downloadedLastModified).to.equal(undefined);
        localFile = undefined;
        fs.stat(path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename)).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          expect(stats).to.equal(undefined);
          done();
        }).catch((_error) => {
          // We shouldn't have a stats object
          done();
        });
      }).catch((error) => done(error));
    });
  });

  describe("Get File Contents in S3", () => {
    let lastModified: Date;
    const testFilename: string = path.basename(UNIT_TEST_FILEPATH);
    const expectedContents: string = "This is only a test";

    beforeEach ( () => {
      lastModified = new Date();
    });

    it("getFileContents should return contents", (done: Mocha.Done) => {
      mockGetObject(expectedContents);
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(expectedContents);
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents maxLength should return contents", (done: Mocha.Done) => {
      mockGetObject(expectedContents);
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        maxLength: 5000
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(expectedContents);
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents maxLength should truncate contents", (done: Mocha.Done) => {
      mockGetObject(expectedContents);
      const maxLength = 5;
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        maxLength
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(expectedContents.substring(0, maxLength));
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents should return changed contents", (done: Mocha.Done) => {
      mockGetObject(expectedContents);
      const testModified: Date = new Date(lastModified.getTime() - 1000);
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        lastModified: testModified
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(expectedContents);
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents should not return unchanged contents", (done: Mocha.Done) => {
      mockGetObjectError(304);
      const testModified: Date = new Date(lastModified.getTime() + 1000);
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        lastModified: testModified
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents should throw on not found", (done: Mocha.Done) => {
      mockGetObjectError(404);
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        done(new Error("getFileContents should have thrown"));
      }).catch((error) => {
        log(`${error}`, LogLevel.ERROR);
        try {
          try {
            expect(error, "error").to.not.equal(undefined);
            expect(error?.name, "error?.name").to.equal("404");
            // This won't be set on failures, set it so the afterEach doesn't throw
            healthCheckDate = new Date();
            done();
          } catch (error3) {
            done(error3);
          }
        } catch (error2) {
          done(error2);
        }
      });
    });

    it("getFileContents too large should fail", (done: Mocha.Done) => {
      mockGetObject(MAX_STRING_LENGTH + 10);
      const maxLength = MAX_STRING_LENGTH + 1;
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        maxLength
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents?.length)}`, LogLevel.DEBUG);
        done(new Error("Should have thrown"));
      }).catch((error) => {
        expect(`${error}`).to.include("Cannot create a string longer than");
        done();
      });
    });

    it("getFileContents too large should return truncated contents", (done: Mocha.Done) => {
      mockGetObject(MAX_STRING_LENGTH + 10);
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents?.length)}`, LogLevel.DEBUG);
        expect(contents).to.not.equal(undefined);
        expect(contents?.length).to.equal(MAX_STRING_LENGTH);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("Copy Objects in S3", () => {
    const sourceFile: S3File = {
      key: `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`,
      contentType: "application/json"
    };
    const destinationFile: S3File = {
      key: `bogus/${UNIT_TEST_FILENAME}`,
      contentType: "application/json"
    };

    it("Copy Object should copy object", (done: Mocha.Done) => {
      const expectedLastModified = new Date();
      mockCopyObject(expectedLastModified);
      copyObject({ sourceFile, destinationFile }).then((result: CopyObjectCommandOutput | undefined) => {
        log(`copyObject(${sourceFile.key}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result, "result").to.not.equal(undefined);
        expect(result?.CopyObjectResult, "CopyObjectResult").to.not.equal(undefined);
        expect(result?.CopyObjectResult?.LastModified, "LastModified").to.equal(expectedLastModified);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Copy Files in S3", () => {
    const filename: string = UNIT_TEST_FILENAME;
    const sourceS3Folder: string = UNIT_TEST_KEY_PREFIX;
    const destinationS3Folder: string = "bogus";
    const destinationFilename: string = "bogus";

    it("Copy File should copy file", (done: Mocha.Done) => {
      mockCopyObject();
      copyFile({ filename, sourceS3Folder, destinationS3Folder }).then(() => {
        done();
      }).catch((error) => done(error));
    });

    it("Copy File should change filename", (done: Mocha.Done) => {
      const expectedLastModified = new Date();
      mockCopyObject(expectedLastModified);
      copyFile({ filename, sourceS3Folder, destinationS3Folder, destinationFilename }).then((lastModified: Date | undefined) => {
        expect(lastModified).to.equal(expectedLastModified);
        done();
      }).catch((error) => done(error));
    });

    it("Copy File to same folder should fail", (done: Mocha.Done) => {
      mockCopyObject();
      copyFile({ filename, sourceS3Folder, destinationS3Folder: sourceS3Folder }).then(() => {
        done("Should have failed");
      }).catch((error) => {
        expect(`${error}`).to.include("copyFile cannot copy to itself");
        // This won't be set on failures, set it so the afterEach doesn't throw
        healthCheckDate = new Date();
        done();
      });
    });

    it("Copy File to same filename should fail", (done: Mocha.Done) => {
      mockCopyObject();
      copyFile({ filename, sourceS3Folder, destinationS3Folder: sourceS3Folder, destinationFilename: filename }).then(() => {
        done("Should have failed");
      }).catch((error) => {
        expect(`${error}`).to.include("copyFile cannot copy to itself");
        // This won't be set on failures, set it so the afterEach doesn't throw
        healthCheckDate = new Date();
        done();
      });
    });
  });

  describe("Get Object Tagging in S3", () => {
    it("getObjectTagging should get a tag", (done: Mocha.Done) => {
      const tags = new Map<string, string>([["unittest", "true"]]);
      mockGetObjectTagging(tags);
      getObjectTagging(UNIT_TEST_KEY).then((result: GetObjectTaggingCommandOutput) => {
        expect(result).to.not.equal(undefined);
        expect(result.TagSet).to.not.equal(undefined);
        expect(result.TagSet).to.not.equal(undefined);
        expect(result.TagSet!.length).to.equal(1);
        expect(result.TagSet![0].Key).to.equal("unittest");
        expect(result.TagSet![0].Value).to.equal("true");
        done();
      }).catch((error) => done(error));
    });

    it("getObjectTagging should get no tags", (done: Mocha.Done) => {
      mockGetObjectTagging(undefined);
      getObjectTagging(UNIT_TEST_KEY).then((result: GetObjectTaggingCommandOutput) => {
        expect(result).to.not.equal(undefined);
        expect(result.TagSet).to.not.equal(undefined);
        expect(result.TagSet).to.not.equal(undefined);
        expect(result.TagSet!.length).to.equal(0);
        done();
      }).catch((error) => done(error));
    });

    it("getTags should get a tag", (done: Mocha.Done) => {
      const tags = new Map<string, string>([["unittest", "true"]]);
      mockGetObjectTagging(tags);
      getTags({
        filename: UNIT_TEST_FILENAME,
        s3Folder: UNIT_TEST_KEYSPACE_PREFIX
      }).then((result: Map<string, string> | undefined) => {
        expect(result).to.not.equal(undefined);
        expect(result?.size).to.equal(1);
        expect(result?.get("unittest")).to.equal("true");
        done();
      }).catch((error) => done(error));
    });

    it("getTags should get no tags", (done: Mocha.Done) => {
      mockGetObjectTagging(undefined);
      getTags({
        filename: UNIT_TEST_FILENAME,
        s3Folder: UNIT_TEST_KEYSPACE_PREFIX
      }).then((result: Map<string, string> | undefined) => {
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("Put Object Tagging in S3", () => {
    const tags = new Map<string, string>([["unittest", "true"]]);
    it("putObjectTagging should not throw", (done: Mocha.Done) => {
      putObjectTagging({ key: UNIT_TEST_KEY, tags }).then((result: PutObjectTaggingCommandOutput) => {
        expect(result).to.not.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("putTags should not throw", (done: Mocha.Done) => {
      putTags({
        filename: UNIT_TEST_FILENAME,
        s3Folder: UNIT_TEST_KEYSPACE_PREFIX,
        tags
      }).then(() => {
        done();
      }).catch((error) => done(error));
    });
  });
});
