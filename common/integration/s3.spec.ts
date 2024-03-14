import * as path from "path";
import {
  ADDITIONAL_TAGS_ON_ALL,
  copyFile,
  copyObject,
  deleteObject,
  getFile,
  getFileContents,
  getObject,
  getObjectTagging,
  getTags,
  init as initS3,
  listFiles,
  listObjects,
  putObjectTagging,
  putTags,
  config as s3Config,
  setAccessCallback,
  uploadFile,
  uploadFileContents,
  uploadObject
} from "../src/util/s3";
import {
  CompleteMultipartUploadCommandOutput,
  CopyObjectCommandOutput,
  GetObjectCommandOutput,
  GetObjectTaggingCommandOutput,
  ListObjectsV2CommandOutput,
  PutObjectTaggingCommandOutput,
  _Object as S3Object,
  Tag as S3Tag
} from "@aws-sdk/client-s3";
import { LogLevel, S3File, log, util } from "../src/index";
import { Stats, createReadStream } from "fs";
import { expect } from "chai";
import fs from "fs/promises";
import { poll } from "../src/util/util";
import { promisify } from "util";
import { gunzip as zlibGunzip } from "zlib";

const gunzip = promisify(zlibGunzip);

export const UNIT_TEST_KEY_PREFIX: string = process.env.UNIT_TEST_KEY_PREFIX || "unittest";
export const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
export const UNIT_TEST_FILEPATH: string = process.env.UNIT_TEST_FILEPATH || ("test/" + UNIT_TEST_FILENAME);
const UNIT_TEST_KEY: string = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
export const UNIT_TEST_LOCAL_FILE_LOCATION: string = process.env.UNIT_TEST_LOCAL_FILE_LOCATION || process.env.TEMP || "/tmp";
export const MAX_POLL_WAIT: number = parseInt(process.env.MAX_POLL_WAIT || "0", 10) || 500;
// const LARGE_FILE_SIZE: number = parseInt(process.env.LARGE_FILE_SIZE || "0", 10) || 500000000;

export const unittestTagKey: string = "unittest";
export const unittestTagValue: string = "true";
export const testTags = new Map<string, string>([[unittestTagKey, unittestTagValue]]);
// These are set by the before after init()
export const defaultTags = new Map<string, string>();
export const fullTestTags = new Map<string, string>([...testTags]);

export function initTags (): string {
  let defaultKey: string | undefined;
  let defaultValue: string | undefined;
  if (ADDITIONAL_TAGS_ON_ALL.size > 0) {
    for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
      if (!defaultKey) {
        defaultKey = key;
        defaultValue = value;
      }
      defaultTags.set(key, value);
      fullTestTags.set(key, value);
    }
  } else {
    defaultKey = "application";
    defaultValue = util.APPLICATION_NAME;
    defaultTags.set(defaultKey, defaultValue);
    fullTestTags.set(defaultKey, defaultValue);
  }
  log("tags", LogLevel.DEBUG, { defaultKey, tags: Array.from(testTags.entries()), defaultTags: Array.from(defaultTags.entries()), allTags: Array.from(fullTestTags.entries()) });
  expect(defaultKey, "defaultKey").to.not.equal(undefined);
  return defaultKey!;
}

export const validateTagMap = (actual: Map<string, string>, expected: Map<string, string>) => {
  try {
    expect(actual.size, "validateTagMap actual.size").to.equal(expected.size);
    for (const [key, value] of expected) {
      expect(actual.has(key), `validateTagMap actual.has("${key}")`).to.equal(true);
      expect(actual.get(key), `validateTagMap actual.get("${key}")`).to.equal(value);
    }
  } catch (error) {
    log("validateTagMap Error", LogLevel.ERROR, error, { actual: [...actual], expected: [...expected] });
    throw error;
  }
};

export const validateTagSet = (actual: S3Tag[], expected: Map<string, string>) => {
  const actualMap = new Map<string, string>();
  try {
    expect(actual.length, "validateTagSet actual.length").to.equal(expected.size);
    for (const actualTag of actual) {
      expect(actualTag.Key, "actualTag.Key").to.not.equal(undefined);
      expect(actualTag.Value, "actualTag.Value").to.not.equal(undefined);
      actualMap.set(actualTag.Key!, actualTag.Value!);
    }
  } catch (error) {
    log("validateTagSet Error", LogLevel.ERROR, error, { actual, expected: [...expected] });
    throw error;
  }
  validateTagMap(actualMap, expected);
};

describe("S3Util Integration", () => {
  let s3FileKey: string | undefined;
  let healthCheckDate: Date | undefined;
  let defaultTagKey: string;

  before (async () => {
    // This test was failing until we reset everything. I don't know why and it bothers me.
    s3Config.s3Client = undefined as any;
    initS3();
    defaultTagKey = initTags();
    expect(defaultTagKey, "defaultTagKey").to.not.equal(undefined);
    // Set the access callback to test that healthchecks will be updated
    setAccessCallback((date: Date) => healthCheckDate = date);
    try {
      await Promise.all([
        `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`,
        `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`
      ].map((s3Path: string) => deleteObject(s3Path).catch((error) =>
        log("S3Util Integration before delete failed: " + s3Path, LogLevel.DEBUG, error))));
    } catch (error) {
      // Swallow
    }
  });

  beforeEach(() => {
    // Set the access callback back undefined
    healthCheckDate = undefined;
  });

  afterEach (async () => {
    // test
    if (s3FileKey) {
      try {
        await poll(async (): Promise<boolean | undefined> => {
          const files = await listFiles(s3FileKey!);
          return (files && files.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        await deleteObject(s3FileKey);
        s3FileKey = undefined;
      } catch (error) {
        log(`deleteObject ${s3FileKey} failed`, LogLevel.ERROR, error);
        throw error;
      }
    }
    // If this is still undefined the access callback failed and was not updated with the last access date
    log("afterEach healthCheckDate=" + healthCheckDate, healthCheckDate ? LogLevel.DEBUG : LogLevel.ERROR);
    expect(healthCheckDate).to.not.equal(undefined);
  });

  describe("List Objects Empty in S3", () => {
    it("List Objects should always succeed even if empty", (done: Mocha.Done) => {
      listObjects({ prefix: "bogus", maxKeys: 1}).then((result: ListObjectsV2CommandOutput) => {
        log(`listObjects("bogus", 1) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.Contents, "Contents").to.equal(undefined);
        expect(result.KeyCount, "KeyCount").to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("List Files Empty in S3", () => {
    it("List Files should always succeed even if empty", (done: Mocha.Done) => {
      listFiles("bogus").then((result: S3Object[]) => {
        log(`listFiles("bogus") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
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
      uploadObject(s3File).then((result: CompleteMultipartUploadCommandOutput) => {
        log(`uploadObject result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        s3FileKey = s3File.key;
        expect(result).to.not.equal(undefined);
        expect(result.Location).to.not.equal(undefined);
        expect(result.Location).to.include(s3FileKey);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload File to S3", () => {
    it("Upload a test file to S3", (done: Mocha.Done) => {
      uploadFile({ filepath: UNIT_TEST_FILEPATH, s3Folder: UNIT_TEST_KEY_PREFIX }).then((url: string) => {
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
        expect(url).to.not.equal(undefined);
        expect(url).to.include(s3FileKey);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload File Contents to S3", () => {
    it("Upload a test string to S3", (done: Mocha.Done) => {
      const filename: string = path.basename(UNIT_TEST_FILEPATH);
      uploadFileContents({ contents: "test", filename, s3Folder: UNIT_TEST_KEY_PREFIX }).then((url: string) => {
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
        expect(url).to.not.equal(undefined);
        expect(url).to.include(s3FileKey);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("List Files in S3", () => {
    beforeEach (async () => {
      try {
        const url: string = await uploadFile({ filepath: UNIT_TEST_FILEPATH, s3Folder: UNIT_TEST_KEY_PREFIX });
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
        await poll(async (): Promise<boolean | undefined> => {
          const objects = await listObjects(s3FileKey!);
          return (objects && objects.Contents && objects.Contents.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
      } catch (error) {
        log(`beforeEach error uploadFile(${UNIT_TEST_FILEPATH}, ${UNIT_TEST_KEY_PREFIX})`, LogLevel.ERROR, error);
        throw error;
      }
    });

    it("List Files should return files", (done: Mocha.Done) => {
      listFiles(UNIT_TEST_KEY_PREFIX).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.greaterThan(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with extension should return files", (done: Mocha.Done) => {
      listFiles({
        s3Folder: UNIT_TEST_KEY_PREFIX,
        extension: UNIT_TEST_FILENAME.slice(-3)
      }).then((result: S3Object[]) => {
        log(`listFiles("${UNIT_TEST_KEY_PREFIX}", undefined, ${UNIT_TEST_FILENAME.slice(-3)}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("List Files with not found extension should not return files", (done: Mocha.Done) => {
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
  });

  describe("Get Objects in S3", () => {
    let lastModified: Date;
    let expectedTags: Map<string, string>;

    beforeEach (async () => {
      try {
        const url: string = await uploadFile({
          filepath: UNIT_TEST_FILEPATH,
          s3Folder: UNIT_TEST_KEY_PREFIX,
          tags: testTags
        });
        lastModified = new Date();
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
        // As long as we don't throw, it passes
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const objects = await listObjects(s3FileKey!);
          return (objects && objects.Contents && objects.Contents.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        const s3Object: GetObjectCommandOutput = await getObject(s3FileKey);
        expect(s3Object, "s3Object").to.not.equal(undefined);
        expect(s3Object.LastModified, "LastModified").to.not.equal(undefined);
        expect(s3Object.TagCount, "TagCount").to.equal(fullTestTags.size);
        lastModified = s3Object.LastModified!;
        log("getObject beforeEach s3Object", LogLevel.DEBUG, { ...s3Object, Body: undefined });
        expectedTags = new Map(fullTestTags);
      } catch (error) {
        log("getObject beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("Get Object should return files", (done: Mocha.Done) => {
      if (s3FileKey) {
        getObject(s3FileKey).then(async (result: GetObjectCommandOutput | undefined) => {
          log(`getObject(${s3FileKey}) result`, LogLevel.DEBUG, result);
          expect(result).to.not.equal(undefined);
          expect(result!.Body).to.not.equal(undefined);
          // The defined one and the expected on all objects
          expect(result?.TagCount).to.equal(expectedTags.size);
          if (result!.ContentEncoding === "gzip" && result!.Body && typeof result!.Body != "string") {
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
      } else {
        done("No s3FileKey");
      }
    });

    it("Get Object should return changed files", (done: Mocha.Done) => {
      if (s3FileKey) {
        const testModified: Date = new Date(lastModified.getTime() - 1000);
        getObject(s3FileKey, testModified).then((result: GetObjectCommandOutput | undefined) => {
          log(`getObject(${s3FileKey}) result`, LogLevel.DEBUG, result);
          expect(result).to.not.equal(undefined);
          expect(result!.Body).to.not.equal(undefined);
          done();
        }).catch((error) => {
          done(error);
        });
      } else {
        done("No s3FileKey");
      }
    });

    it("Get Object should not return unchanged files", (done: Mocha.Done) => {
      if (s3FileKey) {
        const testModified: Date = new Date(lastModified.getTime());
        log("Get Object should not return unchanged files", LogLevel.DEBUG, { lastModified, testModified });
        getObject(s3FileKey, testModified).then((result: GetObjectCommandOutput | undefined) => {
          log("Should not succeed. We should get a Not Modified", LogLevel.WARN, { ...result, Body: undefined });
          done(new Error("Should not succeed. We should get a Not Modified"));
        }).catch((error) => {
          log(`getObject(${s3FileKey}) error = ${error}`, LogLevel.DEBUG, error);
          try {
            expect(error, "error").to.not.equal(undefined);
            expect(error?.name, "error?.name").to.equal("304");
            done();
          } catch (error2) {
            done(error2);
          }
        });
      } else {
        done("No s3FileKey");
      }
    });
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;
    const testFilename: string = path.basename(UNIT_TEST_FILEPATH);
    let localFile: string | undefined;

    beforeEach (async () => {
      lastModified = new Date();
      try {
        const url: string = await uploadFile({ filepath: UNIT_TEST_FILEPATH, s3Folder: UNIT_TEST_KEY_PREFIX });
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
        // As long as we don't throw, it passes
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const files = await listFiles(s3FileKey!);
          return (files && files.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        const s3Object: GetObjectCommandOutput = await getObject(s3FileKey);
        expect(s3Object).to.not.equal(undefined);
        expect(s3Object.LastModified).to.not.equal(undefined);
        lastModified = s3Object.LastModified!;
      } catch (error) {
        log("getFile beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
      localFile = undefined;
    });

    afterEach (async () => {
      // Delete the local file
      if (localFile) {
        await fs.unlink(localFile)
        .catch((error) => log("Could not delete " + localFile, LogLevel.WARN, error));
      }
    });

    it("Get File should return files", (done: Mocha.Done) => {
      if (s3FileKey) {
        getFile({
          filename: testFilename,
          s3Folder: UNIT_TEST_KEY_PREFIX,
          localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
        }).then((downloadedLastModified: Date | undefined) => {
          log(`getFile(${testFilename}) result = ${lastModified}`, LogLevel.DEBUG);
          expect(downloadedLastModified).to.not.equal(undefined);
          localFile = path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename);
          fs.stat(localFile).then((stats: Stats) => {
            log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
            expect(stats).to.not.equal(undefined);
            done();
          }).catch((error) => done(error));
        }).catch((error) => done(error));
      } else {
        done("No s3FileKey");
      }
    });

    it("Get File should return changed files", (done: Mocha.Done) => {
      if (s3FileKey) {
        const testModified: Date = new Date(lastModified.getTime() - 1000);
        getFile({
          filename: testFilename,
          s3Folder: UNIT_TEST_KEY_PREFIX,
          localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
          lastModified: testModified
        }).then((downloadedLastModified: Date | undefined) => {
          log(`getFile(${s3FileKey}) result = ${JSON.stringify(downloadedLastModified)}`, LogLevel.DEBUG);
          expect(downloadedLastModified).to.not.equal(undefined);
          localFile = path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename);
          fs.stat(localFile).then((stats: Stats) => {
            log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
            expect(stats).to.not.equal(undefined);
            done();
          }).catch((error) => done(error));
        }).catch((error) => done(error));
      } else {
        done("No s3FileKey");
      }
    });

    it("Get File should not return unchanged files", (done: Mocha.Done) => {
      if (s3FileKey) {
        const testModified: Date = new Date(lastModified.getTime());
        log("Get File should not return unchanged files", LogLevel.DEBUG, { lastModified, testModified });
        getFile({
          filename: testFilename,
          s3Folder: UNIT_TEST_KEY_PREFIX,
          localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
          lastModified: testModified
        }).then((downloadedLastModified: Date | undefined) => {
          log(`getFile(${s3FileKey}) result = ${JSON.stringify(downloadedLastModified)}`, LogLevel.DEBUG);
          localFile = path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename);
          expect(downloadedLastModified, "downloadedLastModified").to.equal(undefined);
          localFile = undefined;
          fs.stat(path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename)).then((stats: Stats) => {
            localFile = path.join(UNIT_TEST_LOCAL_FILE_LOCATION, testFilename);
            log(`fs.stat(${testFilename}) stats`, LogLevel.WARN, { stats });
            expect(stats).to.equal(undefined);
            done(new Error("Should not have found a file"));
          }).catch((_error) => {
            // We shouldn't have a stats object
            done();
          });
        }).catch((error) => {
          log("Get File should not return unchanged files", LogLevel.WARN, error);
          done(error);
        });
      } else {
        done("No s3FileKey");
      }
    });
  });

  describe("Get File Contents in S3", () => {
    let lastModified: Date;
    const testFilename: string = path.basename(UNIT_TEST_FILEPATH);
    const expectedContents: string = "This is only a test";

    beforeEach (async () => {
      const url: string = await uploadFileContents({
        contents: expectedContents,
        filename: UNIT_TEST_FILEPATH,
        s3Folder: UNIT_TEST_KEY_PREFIX
      });
      lastModified = new Date();
      log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
      s3FileKey = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_FILENAME}`;
      // As long as we don't throw, it passes
      // Need time for eventual consistency to complete
      await poll(async (): Promise<boolean | undefined> => {
        const files = await listFiles(s3FileKey!);
        return (files && files.length > 0);
      }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
      const s3Object: GetObjectCommandOutput = await getObject(s3FileKey);
      expect(s3Object).to.not.equal(undefined);
      expect(s3Object.LastModified).to.not.equal(undefined);
      lastModified = s3Object.LastModified!;
    });

    it("getFileContents should return contents", (done: Mocha.Done) => {
      getFileContents({ filename: testFilename, s3Folder: UNIT_TEST_KEY_PREFIX }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(expectedContents);
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents maxLength should return contents", (done: Mocha.Done) => {
      getFileContents({ filename: testFilename, s3Folder: UNIT_TEST_KEY_PREFIX, maxLength: 5000 }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(expectedContents);
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents maxLength should truncate contents", (done: Mocha.Done) => {
      const maxLength = 5;
      getFileContents({ filename: testFilename, s3Folder: UNIT_TEST_KEY_PREFIX, maxLength }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.not.equal(undefined);
        expect(contents?.length).to.equal(maxLength);
        expect(contents).to.equal(expectedContents.substring(0, maxLength));
        done();
      }).catch((error) => done(error));
    });

    it("getFileContents should return changed contents", (done: Mocha.Done) => {
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
      const testModified: Date = new Date(lastModified.getTime());
      log("getFileContents should not return unchanged contents", LogLevel.DEBUG, { lastModified, testModified });
      getFileContents({
        filename: testFilename,
        s3Folder: UNIT_TEST_KEY_PREFIX,
        lastModified: testModified
      }).then((contents: string | undefined) => {
        log(`getFileContents(${testFilename}) result = ${JSON.stringify(contents)}`, LogLevel.DEBUG);
        expect(contents).to.equal(undefined);
        done();
      }).catch((error) => {
        log("getFileContents should not return unchanged contents", LogLevel.WARN, error, { lastModified, testModified });
        done(error);
      });
    });
  });

  describe("Copy Objects in S3", () => {
    let s3CopyKey: string | undefined;
    let lastModified: Date;
    const filename: string = UNIT_TEST_FILENAME;
    const sourceS3Folder: string = UNIT_TEST_KEY_PREFIX;
    const destinationS3Folder: string = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_KEY_PREFIX}`;
    let expectedObject: GetObjectCommandOutput;
    let expectedTags: Map<string, string>;

    beforeEach (async () => {
      try {
        const url: string = await uploadFile({
          filepath: UNIT_TEST_FILEPATH,
          s3Folder: sourceS3Folder,
          tags: testTags
        });
        lastModified = new Date();
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${sourceS3Folder}/${filename}`;
        // As long as we don't throw, it passes
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const objects = await listObjects(s3FileKey!);
          return (objects && objects.Contents && objects.Contents.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        expectedObject = await getObject(s3FileKey);
        expect(expectedObject, "actualObject").to.not.equal(undefined);
        expect(expectedObject.LastModified, "LastModified").to.not.equal(undefined);
        expect(expectedObject.ContentType, "ContentType").to.not.equal(undefined);
        expect(expectedObject.ContentEncoding, "ContentEncoding").to.not.equal(undefined);
        expect(expectedObject.CacheControl, "CacheControl").to.not.equal(undefined);
        expect(expectedObject.TagCount, "TagCount").to.equal(fullTestTags.size);
        const tagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3FileKey);
        expect(tagging.TagSet, "tagging.TagSet").to.not.equal(undefined);
        validateTagSet(tagging.TagSet!, fullTestTags);
        lastModified = expectedObject.LastModified!;
        expectedTags = new Map(fullTestTags);
      } catch (error) {
        log("copyObject beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    });

    afterEach (async () => {
      // test
      if (s3CopyKey) {
        try {
          await poll(async (): Promise<boolean | undefined> => {
            const files = await listFiles(s3CopyKey!);
            return (files && files.length > 0);
          }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3CopyKey} in s3`);
          const actualObject: GetObjectCommandOutput = await getObject(s3CopyKey);
          expect(actualObject, "actualObject").to.not.equal(undefined);
          expect(actualObject.LastModified, "actualObject.LastModified").to.not.equal(undefined);
          expect(actualObject.LastModified!.getTime(), "actualObject.LastModified").to.be.greaterThanOrEqual(lastModified.getTime());
          expect(actualObject.ContentType, "actualObject.ContentType").to.equal(expectedObject.ContentType);
          expect(actualObject.ContentEncoding, "actualObject.ContentEncoding").to.equal(expectedObject.ContentEncoding);
          expect(actualObject.CacheControl, "actualObject.CacheControl").to.equal(expectedObject.CacheControl);
          expect(actualObject.TagCount, "actualObject.TagCount").to.equal(expectedTags.size);
          const actualTagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3CopyKey);
          expect(actualTagging.TagSet, "TagSet").to.not.equal(undefined);
          validateTagSet(actualTagging.TagSet!, expectedTags);
          await deleteObject(s3CopyKey);
          s3CopyKey = undefined;
        } catch (error) {
          log(`deleteObject ${s3CopyKey} failed`, LogLevel.ERROR, error);
          throw error;
        }
      }
    });

    it("Copy Object should copy object and properties", (done: Mocha.Done) => {
      if (s3FileKey) {
        const sourceFile: S3File = {
          key: s3FileKey,
          contentType: "application/json"
        };
        const destinationFile: S3File = {
          key: `${destinationS3Folder}/${filename}`,
          contentType: "application/json"
        };

        copyObject({ sourceFile, destinationFile }).then((result: CopyObjectCommandOutput | undefined) => {
          log(`copyObject(${s3FileKey}, ${destinationFile.key}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
          s3CopyKey = destinationFile.key;
          expect(result, "result").to.not.equal(undefined);
          expect(result?.CopyObjectResult, "CopyObjectResult").to.not.equal(undefined);
          expect(result?.CopyObjectResult?.LastModified, "LastModified").to.not.equal(undefined);
          expect(result?.CopyObjectResult?.LastModified?.getTime(), "LastModified").to.be.greaterThanOrEqual(lastModified.getTime());
          done();
        }).catch((error) => {
          done(error);
        });
      } else {
        done("No s3FileKey");
      }
    });

    it("Copy Object should change properties", (done: Mocha.Done) => {
      if (s3FileKey) {
        const sourceFile: S3File = {
          key: `${sourceS3Folder}/${filename}`,
          contentType: "application/json"
        };
        const destinationFile: S3File = {
          key: `${destinationS3Folder}/${filename}`,
          contentType: "text/plain"
        };

        // Change tags
        expectedTags.set(defaultTagKey, "pewpewagent");
        expectedTags.set("unittest", "false");
        expectedTags.set("additionaltag", "additionalvalue");
        const tags = new Map(expectedTags);
        expect(expectedTags.size, "expectedTags.size before").to.equal(3); // Make sure there aren't some others we don't know about

        copyObject({ sourceFile, destinationFile, tags }).then((result: CopyObjectCommandOutput | undefined) => {
          log(`copyObject(${s3FileKey}, ${destinationFile.key}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
          s3CopyKey = destinationFile.key;
          expect(result).to.not.equal(undefined);
          expect(result?.CopyObjectResult, "CopyObjectResult").to.not.equal(undefined);
          expect(result?.CopyObjectResult?.LastModified, "LastModified").to.not.equal(undefined);
          expect(result?.CopyObjectResult?.LastModified?.getTime(), "LastModified").to.be.greaterThanOrEqual(lastModified.getTime());
          expectedObject.ContentType = "text/plain";
          done();
        }).catch((error) => {
          done(error);
        });
      } else {
        done("No s3FileKey");
      }
    });
  });

  describe("Copy Files in S3", () => {
    let s3CopyKey: string | undefined;
    let lastModified: Date;
    const filename: string = UNIT_TEST_FILENAME;
    const sourceS3Folder: string = UNIT_TEST_KEY_PREFIX;
    const destinationS3Folder: string = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_KEY_PREFIX}`;
    const destinationFilename: string = "bogus.txt";
    let expectedObject: GetObjectCommandOutput;
    let expectedTags: Map<string, string>;

    beforeEach (async () => {
      try {
        const url: string = await uploadFile({ filepath: UNIT_TEST_FILEPATH, s3Folder: sourceS3Folder, tags: testTags });
        lastModified = new Date();
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${sourceS3Folder}/${filename}`;
        // As long as we don't throw, it passes
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const objects = await listObjects(s3FileKey!);
          return (objects && objects.Contents && objects.Contents.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        expectedObject = await getObject(s3FileKey);
        expect(expectedObject, "actualObject").to.not.equal(undefined);
        expect(expectedObject.LastModified, "LastModified").to.not.equal(undefined);
        expect(expectedObject.ContentType, "ContentType").to.not.equal(undefined);
        expect(expectedObject.ContentEncoding, "ContentEncoding").to.not.equal(undefined);
        expect(expectedObject.CacheControl, "CacheControl").to.not.equal(undefined);
        expect(expectedObject.TagCount, "TagCount").to.equal(fullTestTags.size);
        const tagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3FileKey);
        expect(tagging.TagSet, "tagging.TagSet").to.not.equal(undefined);
        validateTagSet(tagging.TagSet!, fullTestTags);
        lastModified = expectedObject.LastModified!;
        expectedTags = new Map(fullTestTags);
      } catch (error) {
        log("copyObject beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    });

    afterEach (async () => {
      // test
      if (s3CopyKey) {
        try {
          await poll(async (): Promise<boolean | undefined> => {
            const files = await listFiles(s3CopyKey!);
            return (files && files.length > 0);
          }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3CopyKey} in s3`);
          const actualObject: GetObjectCommandOutput = await getObject(s3CopyKey);
          expect(actualObject, "actualObject").to.not.equal(undefined);
          expect(actualObject.LastModified, "actualObject.LastModified").to.not.equal(undefined);
          expect(actualObject.LastModified!.getTime(), "actualObject.LastModified").to.be.greaterThanOrEqual(lastModified.getTime());
          expect(actualObject.ContentType, "actualObject.ContentType").to.equal(expectedObject.ContentType);
          expect(actualObject.ContentEncoding, "actualObject.ContentEncoding").to.equal(expectedObject.ContentEncoding);
          expect(actualObject.CacheControl, "actualObject.CacheControl").to.equal(expectedObject.CacheControl);
          expect(actualObject.TagCount, "actualObject.TagCount").to.equal(expectedTags.size);
          const actualTagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3CopyKey);
          expect(actualTagging.TagSet, "TagSet").to.not.equal(undefined);
          validateTagSet(actualTagging.TagSet!, expectedTags);
          await deleteObject(s3CopyKey);
          s3CopyKey = undefined;
        } catch (error) {
          log(`deleteObject ${s3CopyKey} failed`, LogLevel.ERROR, error);
          throw error;
        }
      }
    });

    it("Copy File should return files", (done: Mocha.Done) => {
      if (s3FileKey) {
        copyFile({ filename, sourceS3Folder, destinationS3Folder }).then((downloadedLastModified: Date | undefined) => {
          s3CopyKey = `${destinationS3Folder}/${filename}`;
          log(`copyFile({ ${filename}, ${sourceS3Folder}, ${destinationS3Folder} }) result = ${downloadedLastModified}`, LogLevel.DEBUG);
          expect(downloadedLastModified, "LastModified").to.not.equal(undefined);
          expect(downloadedLastModified?.getTime(), "LastModified").to.be.greaterThanOrEqual(lastModified.getTime());
          done();
        }).catch((error) => done(error));
      } else {
        done("No s3FileKey");
      }
    });

    it("Copy File should change name", (done: Mocha.Done) => {
      if (s3FileKey) {
        // Change tags
        expectedTags.set(defaultTagKey, "pewpewagent");
        expectedTags.set(unittestTagKey, "false");
        expectedTags.set("additionaltag", "additionalvalue");
        const tags = new Map(expectedTags);
        expect(expectedTags.size, "expectedTags.size before").to.equal(3); // Make sure there aren't some others we don't know about

        copyFile({ filename, sourceS3Folder, destinationS3Folder, destinationFilename, tags }).then((downloadedLastModified: Date | undefined) => {
          s3CopyKey = `${destinationS3Folder}/${destinationFilename}`;
          log(`copyFile({ ${filename}, ${sourceS3Folder}, ${destinationS3Folder} }) result = ${downloadedLastModified}`, LogLevel.DEBUG);
          expect(downloadedLastModified, "LastModified").to.not.equal(undefined);
          expect(downloadedLastModified?.getTime(), "LastModified").to.be.greaterThanOrEqual(lastModified.getTime());
          done();
        }).catch((error) => done(error));
      } else {
        done("No s3FileKey");
      }
    });

  });

  describe("Get Object Tagging in S3", () => {
    const filename: string = UNIT_TEST_FILENAME;
    const sourceS3Folder: string = UNIT_TEST_KEY_PREFIX;
    let expectedObject: GetObjectCommandOutput;
    let expectedTags: Map<string, string>;

    describe("Get Object Tagging populated", () => {

      beforeEach (async () => {
        try {
          const url: string = await uploadFile({
            filepath: UNIT_TEST_FILEPATH,
            s3Folder: sourceS3Folder,
            tags: testTags
          });
          log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
          s3FileKey = `${sourceS3Folder}/${filename}`;
          // As long as we don't throw, it passes
          // Need time for eventual consistency to complete
          await poll(async (): Promise<boolean | undefined> => {
            const objects = await listObjects(s3FileKey!);
            return (objects && objects.Contents && objects.Contents.length > 0);
          }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
          expectedObject = await getObject(s3FileKey);
          expect(expectedObject, "actualObject").to.not.equal(undefined);
          expect(expectedObject.LastModified, "LastModified").to.not.equal(undefined);
          expect(expectedObject.ContentType, "ContentType").to.not.equal(undefined);
          expect(expectedObject.ContentEncoding, "ContentEncoding").to.not.equal(undefined);
          expect(expectedObject.CacheControl, "CacheControl").to.not.equal(undefined);
          expect(expectedObject.TagCount, "TagCount").to.equal(fullTestTags.size);
          const tagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3FileKey);
          expect(tagging.TagSet, "tagging.TagSet").to.not.equal(undefined);
          validateTagSet(tagging.TagSet!, fullTestTags);
          expectedTags = new Map(fullTestTags);
        } catch (error) {
          log("copyObject beforeEach error", LogLevel.ERROR, error);
          throw error;
        }
      });

      it("getObjectTagging should get a tag", (done: Mocha.Done) => {
        getObjectTagging(UNIT_TEST_KEY).then((result: GetObjectTaggingCommandOutput) => {
          expect(result).to.not.equal(undefined);
          expect(result.TagSet, "result.TagSet").to.not.equal(undefined);
          validateTagSet(result.TagSet!, expectedTags);
          done();
        }).catch((error) => done(error));
      });

      it("getTags should get a tag", (done: Mocha.Done) => {
        getTags({
          filename: UNIT_TEST_FILENAME,
          s3Folder: UNIT_TEST_KEY_PREFIX
        }).then((result: Map<string, string> | undefined) => {
          expect(result).to.not.equal(undefined);
          validateTagMap(result!, expectedTags);
          done();
        }).catch((error) => done(error));
      });
    });

    describe("Get Object Tagging empty", () => {
      beforeEach (async () => {
        try {
          const url: string = await uploadFile({
            filepath: UNIT_TEST_FILEPATH,
            s3Folder: sourceS3Folder,
            tags: undefined
          });
          log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
          s3FileKey = `${sourceS3Folder}/${filename}`;
          // As long as we don't throw, it passes
          // Need time for eventual consistency to complete
          await poll(async (): Promise<boolean | undefined> => {
            const objects = await listObjects(s3FileKey!);
            return (objects && objects.Contents && objects.Contents.length > 0);
          }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
          expectedObject = await getObject(s3FileKey);
          expect(expectedObject, "actualObject").to.not.equal(undefined);
          expect(expectedObject.LastModified, "LastModified").to.not.equal(undefined);
          expect(expectedObject.ContentType, "ContentType").to.not.equal(undefined);
          expect(expectedObject.ContentEncoding, "ContentEncoding").to.not.equal(undefined);
          expect(expectedObject.CacheControl, "CacheControl").to.not.equal(undefined);
          // Default only
          expect(expectedObject.TagCount, "TagCount").to.equal(defaultTags.size);
        } catch (error) {
          log("copyObject beforeEach error", LogLevel.ERROR, error);
          throw error;
        }
      });

      it("getObjectTagging should get no tags", (done: Mocha.Done) => {
        getObjectTagging(UNIT_TEST_KEY).then((result: GetObjectTaggingCommandOutput) => {
          expect(result).to.not.equal(undefined);
          expect(result.TagSet).to.not.equal(undefined);
          // There's always the default set
          expect(result.TagSet, "result.TagSet").to.not.equal(undefined);
          validateTagSet(result.TagSet!, defaultTags);
          done();
        }).catch((error) => done(error));
      });

      it("getTags should get no tags", (done: Mocha.Done) => {
        getTags({
          filename: UNIT_TEST_FILENAME,
          s3Folder: UNIT_TEST_KEY_PREFIX
        }).then((result: Map<string, string> | undefined) => {
          expect(result).to.not.equal(undefined);
          // There's always the default set
          validateTagMap(result!, defaultTags);
          done();
        }).catch((error) => done(error));
      });
    });
  });

  describe("Put Object Tagging in S3", () => {
    const filename: string = UNIT_TEST_FILENAME;
    const s3Folder: string = UNIT_TEST_KEY_PREFIX;
    let expectedTags: Map<string, string>;

    beforeEach (async () => {
      try {
        const uploadTags = new Map(testTags);
        // Change it so clearing will set it back
        uploadTags.set(defaultTagKey, "pewpewagent");
        const url: string = await uploadFile({
          filepath: UNIT_TEST_FILEPATH,
          s3Folder,
          tags: uploadTags
        });
        log(`uploadResults url = ${JSON.stringify(url)}`, LogLevel.DEBUG);
        s3FileKey = `${s3Folder}/${filename}`;
        // As long as we don't throw, it passes
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const objects = await listObjects(s3FileKey!);
          return (objects && objects.Contents && objects.Contents.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        const expectedObject = await getObject(s3FileKey);
        expect(expectedObject, "actualObject").to.not.equal(undefined);
        expect(expectedObject.TagCount, "TagCount").to.equal(uploadTags.size);
        const tagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3FileKey);
        expect(tagging.TagSet, "tagging.TagSet").to.not.equal(undefined);
        validateTagSet(tagging.TagSet!, uploadTags);
        expectedTags = new Map(uploadTags);
      } catch (error) {
        log("putObjectTagging beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    });

    afterEach (async () => {
      try {
        if (s3FileKey) {
          const tagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3FileKey);
          expect(tagging.TagSet, "tagging.TagSet").to.not.equal(undefined);
          validateTagSet(tagging.TagSet!, expectedTags);
        }
      } catch (error) {
        log("putObjectTagging beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("putObjectTagging should put a tag", (done: Mocha.Done) => {
      expectedTags.set("additionalTag", "additionalValue");
      log("putObjectTagging should put a tag", LogLevel.DEBUG, expectedTags);
      const tags = new Map(expectedTags);
      putObjectTagging({ key: s3FileKey!, tags }).then((result: PutObjectTaggingCommandOutput) => {
        expect(result).to.not.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("putTags should put a tag", (done: Mocha.Done) => {
      expectedTags.set("additionalTag", "additionalValue");
      log("putTags should put a tag", LogLevel.DEBUG, expectedTags);
      const tags = new Map(expectedTags);
      putTags({ filename, s3Folder, tags }).then(() => {
        done();
      }).catch((error) => done(error));
    });

    it("putObjectTagging should clear tags", (done: Mocha.Done) => {
      const tags = new Map();
      expectedTags = new Map(defaultTags); // default will be set back
      log("putObjectTagging should clear tags", LogLevel.DEBUG, expectedTags);
      putObjectTagging({ key: s3FileKey!, tags }).then((result: PutObjectTaggingCommandOutput) => {
        expect(result).to.not.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("putTags should clear tags", (done: Mocha.Done) => {
      const tags = new Map();
      expectedTags = new Map(defaultTags); // default will be set back
      log("putTags should clear tags", LogLevel.DEBUG, expectedTags);
      putTags({ filename, s3Folder, tags }).then(() => {
        done();
      }).catch((error) => done(error));
    });
  });

  // describe("Copy Files Performance", () => {
  //   let s3CopyKey: string | undefined;
  //   const filename: string = UNIT_TEST_FILENAME;
  //   const sourceS3Folder: string = UNIT_TEST_KEY_PREFIX;
  //   const destinationS3Folder: string = `${UNIT_TEST_KEY_PREFIX}/${UNIT_TEST_KEY_PREFIX}`;
  //   const expectedContents: string = "a".repeat(LARGE_FILE_SIZE);

  //   beforeEach (async () => {
  //     try {
  //       const timeBefore = Date.now();
  //       await uploadFileContents(expectedContents, UNIT_TEST_FILEPATH, UNIT_TEST_KEY_PREFIX);
  //       log("uploadFileContents duration: " + (Date.now() - timeBefore), LogLevel.WARN);
  //       s3FileKey = `${sourceS3Folder}/${filename}`;
  //       // As long as we don't throw, it passes
  //       // Need time for eventual consistency to complete
  //       await poll(async (): Promise<boolean | undefined> => {
  //         const objects = await listObjects(s3FileKey!);
  //         return (objects && objects.Contents && objects.Contents.length > 0);
  //       }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
  //     } catch (error) {
  //       log("copyObject beforeEach error", LogLevel.ERROR, error);
  //       throw error;
  //     }
  //   });

  //   afterEach (async () => {
  //     // test
  //     if (s3CopyKey) {
  //       try {
  //         await poll(async (): Promise<boolean | undefined> => {
  //           const files = await listFiles(s3CopyKey!);
  //           return (files && files.length > 0);
  //         }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3CopyKey} in s3`);
  //         await deleteObject(s3CopyKey);
  //         s3CopyKey = undefined;
  //       } catch (error) {
  //         log(`deleteObject ${s3CopyKey} failed`, LogLevel.ERROR, error);
  //         throw error;
  //       }
  //     }
  //   });

  //   it("Copy File should return files", (done: Mocha.Done) => {
  //     if (s3FileKey) {
  //       const timeBefore = Date.now();
  //       copyFile({ filename, sourceS3Folder, destinationS3Folder }).then((downloadedLastModified: Date | undefined) => {
  //         log("copyFile duration: " + (Date.now() - timeBefore), LogLevel.WARN);
  //         s3CopyKey = `${destinationS3Folder}/${filename}`;
  //         log(`copyFile({ ${filename}, ${sourceS3Folder}, ${destinationS3Folder} }) result = ${downloadedLastModified}`, LogLevel.DEBUG);
  //         expect(downloadedLastModified, "LastModified").to.not.equal(undefined);
  //         done();
  //       }).catch((error) => done(error));
  //     } else {
  //       done("No s3FileKey");
  //     }
  //   });
  // });
});
