import * as path from "path";
import {
  ADDITIONAL_TAGS_ON_ALL,
  BUCKET_URL,
  KEYSPACE_PREFIX,
  deleteObject,
  getObjectTagging,
  listFiles
} from "../src/util/s3";
import { GetObjectTaggingCommandOutput, _Object as S3Object } from "@aws-sdk/client-s3";
import {
  LogLevel,
  PpaasS3File,
  PpaasS3FileOptions,
  PpaasTestId,
  log,
  s3
} from "../src/index";
import {
  MAX_POLL_WAIT,
  UNIT_TEST_FILENAME,
  UNIT_TEST_FILEPATH,
  UNIT_TEST_LOCAL_FILE_LOCATION,
  defaultTags,
  fullTestTags,
  initTags,
  testTags,
  validateTagMap,
  validateTagSet
} from "./s3.spec";
import { Stats } from "fs";
import { expect } from "chai";
import fs from "fs/promises";
import { poll } from "../src/util/util";

class PpaasS3FileUnitTest extends PpaasS3File {
  public constructor (options: PpaasS3FileOptions) {
    super(options);
  }

  public getLastModifiedLocal (): number {
    return this.lastModifiedLocal;
  }

  public setLastModifiedLocal (lastModifiedLocal: number) {
    this.lastModifiedLocal = lastModifiedLocal;
  }

  public getLastModifiedRemote (): Date {
    return this.lastModifiedRemote;
  }

  public setLastModifiedRemote (lastModifiedRemote: Date) {
    this.lastModifiedRemote = lastModifiedRemote;
  }
}

describe("PpaasS3File Integration", () => {
  let s3FileKey: string | undefined;
  let testPpaasS3FileUpload: PpaasS3FileUnitTest;
  let testPpaasS3FileDownload: PpaasS3FileUnitTest;
  let unitTestKeyPrefix: string;
  let expectedTags: Map<string, string>;

  before (() => {
    const ppaasTestId = PpaasTestId.makeTestId(UNIT_TEST_FILENAME);
    unitTestKeyPrefix = ppaasTestId.s3Folder;
  });

  beforeEach (() => {
    testPpaasS3FileUpload = new PpaasS3FileUnitTest({
      filename: UNIT_TEST_FILENAME,
      s3Folder: unitTestKeyPrefix,
      localDirectory: path.dirname(UNIT_TEST_FILEPATH),
      tags: testTags
    });
    testPpaasS3FileDownload = new PpaasS3FileUnitTest({
      filename: UNIT_TEST_FILENAME,
      s3Folder: unitTestKeyPrefix,
      localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
      tags: testTags
    });
    if (ADDITIONAL_TAGS_ON_ALL.size > 0) {
      for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
        defaultTags.set(key, value);
        fullTestTags.set(key, value);
      }
    }
    expectedTags = new Map(fullTestTags);
  });

  afterEach (async () => {
    // test
    if (s3FileKey) {
      try {
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const files = await listFiles(s3FileKey!);
          return (files && files.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        const tagging = await getObjectTagging(s3FileKey);
        expect(tagging.TagSet, "TagSet").to.not.equal(undefined);
        validateTagSet(tagging.TagSet!, expectedTags);
        await deleteObject(s3FileKey);
        s3FileKey = undefined;
      } catch (error) {
        log(`deleteObject ${s3FileKey} failed`, LogLevel.ERROR, error);
        throw error;
      }
    }
  });

  describe("existsLocal should work", () => {
    it("testPpaasS3FileUpload should exist local", (done: Mocha.Done) => {
      testPpaasS3FileUpload.existsLocal().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("testPpaasS3FileDownload should not exist local", (done: Mocha.Done) => {
      testPpaasS3FileDownload.existsLocal().then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });

    it("testPpaasS3FileDownload should not exist inS3", (done: Mocha.Done) => {
      testPpaasS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasS3File.existsInS3 should not exist inS3", (done: Mocha.Done) => {
      PpaasS3File.existsInS3(testPpaasS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });
  });

  describe("List PpaasS3File Empty in S3", () => {
    it("List PpaasS3File should always succeed even if empty", (done: Mocha.Done) => {
      PpaasS3File.getAllFilesInS3({ s3Folder: "bogus", localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("bogus", ${UNIT_TEST_LOCAL_FILE_LOCATION}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload File to S3", () => {
    let lastModified: number;
    beforeEach (async () => {
      try {
        const stats: Stats = await fs.stat(testPpaasS3FileUpload.localFilePath);
        lastModified = stats.mtimeMs;
        testPpaasS3FileUpload.setLastModifiedLocal(0);
        testPpaasS3FileUpload.remoteUrl = "";
        // As long as we don't throw, it passes
      } catch (error) {
        throw error;
      }
    });

    it("Upload a test file to S3", (done: Mocha.Done) => {
      testPpaasS3FileUpload.upload().then(() => {
        log("testPpaasS3FileUpload.upload succeeded}", LogLevel.DEBUG);
        s3FileKey = testPpaasS3FileUpload.key;
        // we should upload it and update the time
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.not.equal("");
        // Hasn't been downloaded so it shouldn't be set
        expect(testPpaasS3FileUpload.getLastModifiedRemote().getTime()).to.equal(new Date(0).getTime());
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("Upload a test file should upload changed files", (done: Mocha.Done) => {
      testPpaasS3FileUpload.setLastModifiedLocal(lastModified - 1000);
      testPpaasS3FileUpload.upload().then(() => {
        log("testPpaasS3FileDownload.upload() succeeded", LogLevel.DEBUG);
        s3FileKey = testPpaasS3FileUpload.key;
        // If it's older we should upload it and update the time
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.not.equal("");
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file should not upload unchanged files", (done: Mocha.Done) => {
      testPpaasS3FileUpload.setLastModifiedLocal(lastModified); // It checks exact
      testPpaasS3FileUpload.upload().then(() => {
        s3FileKey = undefined;
        log("testPpaasS3FileDownload.upload() succeeded", LogLevel.DEBUG);
        // If it's newer we should not upload it and keep the same time
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.equal("");
        listFiles(testPpaasS3FileUpload.key).then((s3Files: S3Object[] | undefined) => {
          expect(s3Files).to.not.equal(undefined);
          expect(s3Files!.length).to.equal(0);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("Upload a test file force should upload unchanged files", (done: Mocha.Done) => {
      testPpaasS3FileUpload.setLastModifiedLocal(lastModified);
      testPpaasS3FileUpload.upload(true).then(() => {
        s3FileKey = testPpaasS3FileUpload.key;
        log("testPpaasS3FileDownload.upload(true) succeeded", LogLevel.DEBUG);
        // If it's newer, but forced we should upload it and set the time to last modified
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.not.equal("");
        listFiles(testPpaasS3FileUpload.key).then((s3Files: S3Object[] | undefined) => {
          expect(s3Files).to.not.equal(undefined);
          expect(s3Files!.length).to.equal(1);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });
  });

  describe("List Files in S3", () => {
    beforeEach (async () => {
      try {
        await testPpaasS3FileUpload.upload(true);
        log("testPpaasS3FileUpload.upload() succeeded", LogLevel.DEBUG);
        s3FileKey = testPpaasS3FileUpload.key;
        // As long as we don't throw, it passes
      } catch (error) {
        throw error;
      }
    });

    it("testPpaasS3FileDownload should exist inS3", (done: Mocha.Done) => {
      testPpaasS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasS3File.existsInS3 should exist inS3", (done: Mocha.Done) => {
      PpaasS3File.existsInS3(testPpaasS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("getAllFilesInS3 should return files", (done: Mocha.Done) => {
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].remoteUrl).to.not.equal("");
        expect(result[0].remoteUrl).to.include(`${BUCKET_URL}/${KEYSPACE_PREFIX}${unitTestKeyPrefix}/${UNIT_TEST_FILENAME}`);
        expect(result[0].tags).to.not.equal(undefined);
        validateTagMap(result[0].tags!, expectedTags);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder should return files", (done: Mocha.Done) => {
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].s3Folder).to.equal(unitTestKeyPrefix);
        expect(result[0].filename).to.equal(UNIT_TEST_FILENAME);
        expect(result[0].remoteUrl).to.not.equal("");
        expect(result[0].remoteUrl).to.include(`${BUCKET_URL}/${KEYSPACE_PREFIX}${unitTestKeyPrefix}/${UNIT_TEST_FILENAME}`);
        expect(result[0].tags).to.not.equal(undefined);
        validateTagMap(result[0].tags!, expectedTags);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder by extension should return files", (done: Mocha.Done) => {
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: UNIT_TEST_FILENAME.slice(-3)
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].tags).to.not.equal(undefined);
        validateTagMap(result[0].tags!, expectedTags);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder wrong extension should not return files", (done: Mocha.Done) => {
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: "bad",
        maxFiles: 1000
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}", 1000) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;
    const testFilename: string = path.basename(UNIT_TEST_FILEPATH);
    let localFile: string | undefined;
    beforeEach (async () => {
      await testPpaasS3FileUpload.upload(true, true);
      s3FileKey = testPpaasS3FileUpload.key;
      // Reset this between tests
      testPpaasS3FileDownload.setLastModifiedRemote(new Date(0));
      // As long as we don't throw, it passes
      // Need time for eventual consistency to complete
      const s3Files: S3Object[] | undefined = await poll(async (): Promise<S3Object[] | undefined> => {
        const files = await listFiles(s3FileKey!);
        return (files && files.length > 0) ? files : undefined;
      }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
      if (s3Files && s3Files.length > 0) {
        lastModified = s3Files[0].LastModified || new Date();
      } else {
        lastModified = new Date(); // Set the time to now
      }
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
        expect(testPpaasS3FileDownload.tags?.size, "testPpaasS3FileDownload.tags?.size before").to.equal(testTags.size);
        testPpaasS3FileDownload.download().then((result: string) => {
          log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.not.equal(undefined);
          localFile = testPpaasS3FileDownload.localFilePath;
          expect(testPpaasS3FileDownload.tags, "testPpaasS3FileDownload.tags after").to.not.equal(undefined);
          validateTagMap(testPpaasS3FileDownload.tags!, expectedTags);
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
        expect(testPpaasS3FileDownload.tags?.size, "testPpaasS3FileDownload.tags?.size before").to.equal(testTags.size);
        // Set it before the last modified so it's changed
        testPpaasS3FileDownload.setLastModifiedRemote(new Date(lastModified.getTime() - 1000));
        testPpaasS3FileDownload.download().then((result: string) => {
          log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.not.equal(undefined);
          // The time should not be updated
          expect(testPpaasS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
          localFile = testPpaasS3FileDownload.localFilePath;
          expect(testPpaasS3FileDownload.tags, "testPpaasS3FileDownload.tags after").to.not.equal(undefined);
          validateTagMap(testPpaasS3FileDownload.tags!, expectedTags);
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
        expect(testPpaasS3FileDownload.tags?.size, "testPpaasS3FileDownload.tags?.size before").to.equal(testTags.size);
        // Set it to the last modified so it's unchanged
        testPpaasS3FileDownload.setLastModifiedRemote(lastModified);
        testPpaasS3FileDownload.download().then((result: string) => {
          log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.not.equal(undefined);
          // The time should be updated
          expect(testPpaasS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
          localFile = undefined;
          expect(testPpaasS3FileDownload.tags, "testPpaasS3FileDownload.tags after").to.not.equal(undefined);
          validateTagMap(testPpaasS3FileDownload.tags!, testTags);
          fs.stat(testPpaasS3FileDownload.localFilePath).then((stats: Stats) => {
            log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
            expect(stats).to.equal(undefined);
            done();
          }).catch((_error) => {
            // We shouldn't have a stats object
            done();
          });
        }).catch((error) => done(error));
      } else {
        done("No s3FileKey");
      }

    });

    it("Get File force should return unchanged files", (done: Mocha.Done) => {
      if (s3FileKey) {
        expect(testPpaasS3FileDownload.tags?.size, "testPpaasS3FileDownload.tags?.size before").to.equal(testTags.size);
        // Set it to the last modified so it's unchanged
        testPpaasS3FileDownload.setLastModifiedRemote(lastModified);
        // Then force download it
        testPpaasS3FileDownload.download(true).then((result: string) => {
          log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.not.equal(undefined);
          // The time should not be updated
          expect(testPpaasS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
          localFile = testPpaasS3FileDownload.localFilePath;
          expect(testPpaasS3FileDownload.tags, "testPpaasS3FileDownload.tags after").to.not.equal(undefined);
          validateTagMap(testPpaasS3FileDownload.tags!, expectedTags);
          fs.stat(localFile).then((stats: Stats) => {
            log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
            // We should have a stats object
            expect(stats).to.not.equal(undefined);
            done();
          }).catch((error) => done(error));
        }).catch((error) => done(error));
      } else {
        done("No s3FileKey");
      }
    });
  });

  describe("Update Tagging in S3", () => {
    const clearedTags = new Map<string, string>();

    beforeEach (async () => {
      try {
        const defaultTagKey = initTags();
        const uploadTags = new Map(testTags);
        // Change it so we verify clearing won't set it back
        uploadTags.set(defaultTagKey, "pewpewagent");
        clearedTags.set(defaultTagKey, "pewpewagent");
        testPpaasS3FileUpload.tags = uploadTags;
        await testPpaasS3FileUpload.upload(true);
        log("testPpaasS3FileUpload.upload() succeeded", LogLevel.DEBUG);
        s3FileKey = testPpaasS3FileUpload.key;
        // As long as we don't throw, it passes
        // Need time for eventual consistency to complete
        await poll(async (): Promise<boolean | undefined> => {
          const objects = await s3.listObjects(s3FileKey!);
          return (objects && objects.Contents && objects.Contents.length > 0);
        }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
        const expectedObject = await s3.getObject(s3FileKey);
        expect(expectedObject, "actualObject").to.not.equal(undefined);
        expect(expectedObject.TagCount, "TagCount").to.equal(uploadTags.size);
        const tagging: GetObjectTaggingCommandOutput = await getObjectTagging(s3FileKey);
        expect(tagging.TagSet, "tagging.TagSet").to.not.equal(undefined);
        validateTagSet(tagging.TagSet!, uploadTags);
        expectedTags = new Map(uploadTags);
      } catch (error) {
        log("updateTags beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("updateTags should put a tag", (done: Mocha.Done) => {
      expectedTags.set("additionalTag", "additionalValue");
      log("updateTags should put a tag", LogLevel.DEBUG, expectedTags);
      testPpaasS3FileUpload.tags = new Map(expectedTags);
      testPpaasS3FileUpload.updateTags().then(() => {
        done();
      }).catch((error) => done(error));
    });

    it("updateTags should clear tags", (done: Mocha.Done) => {
      testPpaasS3FileUpload.tags = new Map();
      expectedTags = new Map(clearedTags); // default will be set back
      log("updateTags should clear tags", LogLevel.DEBUG, expectedTags);
      testPpaasS3FileUpload.updateTags().then(() => {
        done();
      }).catch((error) => done(error));
    });
  });
});
