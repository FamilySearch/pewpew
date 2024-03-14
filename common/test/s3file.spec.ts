import {
  LogLevel,
  PpaasS3File,
  PpaasTestId,
  S3File,
  log,
  s3
} from "../src/index";
import {
  UNIT_TEST_BUCKET_NAME,
  UNIT_TEST_FILENAME,
  UNIT_TEST_FILEPATH,
  UNIT_TEST_KEYSPACE_PREFIX,
  UNIT_TEST_LOCAL_FILE_LOCATION,
  mockCopyObject,
  mockGetObject,
  mockGetObjectError,
  mockGetObjectTagging,
  mockListObject,
  mockListObjects,
  mockS3,
  mockUploadObject,
  resetMockS3
} from "./mock";
import { PpaasS3FileOptions } from "../src/s3file";
import { Stats } from "fs";
import { expect } from "chai";
import fs from "fs/promises";
import path from "path";

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

  public setLastModifiedRemote (lastModifiedRemote: Date) {
    this.lastModifiedRemote = lastModifiedRemote;
  }
}

describe("PpaasS3File", () => {
  // let s3FileKey: string | undefined;
  let testPpaasS3FileUpload: PpaasS3FileUnitTest;
  let testPpaasS3FileDownload: PpaasS3FileUnitTest;
  let fullPpaasS3File: PpaasS3FileUnitTest;
  let unitTestKeyPrefix: string;
  let fullS3File: Required<S3File>;
  const tags = new Map<string, string>([["unittest", "true"]]);
  const tagsSize = tags.size;
  const testFileTags = new Map<string, string>(s3.defaultTestFileTags());
  const testFileTagsSize = testFileTags.size;

  before (() => {
    mockS3();
    s3.setAccessCallback((_date: Date) => {/* no-op */});

    const ppaasTestId = PpaasTestId.makeTestId(UNIT_TEST_FILENAME);
    unitTestKeyPrefix = ppaasTestId.s3Folder;
  });

  beforeEach (() => {
    testPpaasS3FileUpload = new PpaasS3FileUnitTest({
      filename: UNIT_TEST_FILENAME,
      s3Folder: unitTestKeyPrefix,
      localDirectory: path.dirname(UNIT_TEST_FILEPATH),
      tags
    });
    testPpaasS3FileDownload = new PpaasS3FileUnitTest({
      filename: UNIT_TEST_FILENAME,
      s3Folder: unitTestKeyPrefix,
      localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
      tags
    });
    fullS3File = {
      body: "test",
      key: testPpaasS3FileDownload.key,
      contentEncoding: "encoding",
      contentType: testPpaasS3FileDownload.contentType,
      publicRead: true,
      tags,
      storageClass: "STANDARD"
    };
    fullPpaasS3File = new PpaasS3FileUnitTest({
      filename: UNIT_TEST_FILENAME,
      localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
      s3Folder: unitTestKeyPrefix,
      publicRead: true,
      tags
    });
    Object.assign(fullPpaasS3File, fullS3File);
    for (const key in fullS3File) {
      expect(JSON.stringify(fullPpaasS3File.getS3File()[key as keyof S3File]), "fullPpaasS3File." + key).to.equal(JSON.stringify(fullS3File[key as keyof S3File]));
    }
  });

  after (() => {
    resetMockS3();
    s3.setAccessCallback(undefined as any);
  });

  describe("Constructor should set the file type", () => {
    it("stats.json should be json", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats-test.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.contentType).to.equal("application/json");
      done();
    });

    it("stats.csv should be csv", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats-test.csv",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.contentType).to.equal("text/csv");
      done();
    });

    it("stats.yaml should be yaml", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats-test.yaml",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.contentType).to.equal("text/x-yaml");
      done();
    });

    it("stats.txt should be text", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats-test.txt",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.contentType).to.equal("text/plain");
      done();
    });

    it("pewpew should be octet-stream", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "pewpew",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.contentType).to.equal("application/octet-stream");
      done();
    });

    it("should be set public-read", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.publicRead).to.equal(undefined);
      done();
    });

    it("should be set public-read false", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        publicRead: false
      });
      expect(ppaasS3File.publicRead).to.equal(false);
      done();
    });

    it("should be set public-read true", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        publicRead: true
      });
      expect(ppaasS3File.publicRead).to.equal(true);
      done();
    });

    it("should set default tags", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      });
      expect(ppaasS3File.tags).to.not.equal(undefined);
      expect(ppaasS3File.tags?.size).to.equal(testFileTagsSize);
      expect(JSON.stringify([...(ppaasS3File.tags || [])])).to.equal(JSON.stringify([...testFileTags]));
      done();
    });

    it("should override default tags with empty", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        tags: new Map()
      });
      expect(ppaasS3File.tags).to.not.equal(undefined);
      expect(ppaasS3File.tags?.size).to.equal(0);
      expect(JSON.stringify([...(ppaasS3File.tags || [])])).to.equal(JSON.stringify([]));
      done();
    });

    it("should override default tags with populated", (done: Mocha.Done) => {
      const ppaasS3File: PpaasS3File = new PpaasS3File({
        filename: "stats.json",
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        tags
      });
      expect(ppaasS3File.tags).to.not.equal(undefined);
      expect(ppaasS3File.tags?.size).to.equal(tagsSize);
      expect(JSON.stringify([...(ppaasS3File.tags || [])])).to.equal(JSON.stringify([...tags]));
      done();
    });

  });

  it("getS3File should have all properties of a S3File", (done: Mocha.Done) => {
    const actualS3File = fullPpaasS3File.getS3File();
    expect(Object.keys(actualS3File).length, Object.keys(actualS3File).toString() + " length").to.equal(Object.keys(fullS3File).length);
    for (const key in actualS3File) {
      expect(JSON.stringify(actualS3File[key as keyof S3File]), "actualS3File." + key).to.equal(JSON.stringify(fullS3File[key as keyof S3File]));
    }
    done();
  });

  it("sanitizedCopy should only be an extended S3File", (done: Mocha.Done) => {
    const extendedKeys = [
      "s3Folder",
      "filename",
      "localDirectory",
      "localFilePath",
      "remoteUrl",
      "lastModifiedLocal",
      "lastModifiedRemote"
    ];
    const actualS3File = fullPpaasS3File.sanitizedCopy();
    expect(Object.keys(actualS3File).length, Object.keys(actualS3File).toString() + " length").to.equal(Object.keys(fullS3File).length + extendedKeys.length - 1);
    for (const key in actualS3File) {
      if (extendedKeys.includes(key)) {
        expect(JSON.stringify(actualS3File[key as keyof S3File]), key).to.equal(JSON.stringify((fullPpaasS3File as any)[key as keyof S3File]));
      } else {
        expect(JSON.stringify(actualS3File[key as keyof S3File]), key).to.equal(JSON.stringify(fullS3File[key as keyof S3File]));
      }
    }
    done();
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
  });

  describe("List Files in S3", () => {
    it("testPpaasS3FileDownload should not exist inS3", (done: Mocha.Done) => {
      mockListObjects([]);
      testPpaasS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasS3File.existsInS3 should not exist inS3", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasS3File.existsInS3(testPpaasS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });

    it("List PpaasS3File should always succeed even if empty", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasS3File.getAllFilesInS3({ s3Folder: "bogus", localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("bogus", ${UNIT_TEST_LOCAL_FILE_LOCATION}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("testPpaasS3FileDownload should exist inS3", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      testPpaasS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasS3File.existsInS3 should exist inS3", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      PpaasS3File.existsInS3(testPpaasS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("getAllFilesInS3 should return files", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      mockGetObjectTagging(tags);
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix,
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].remoteUrl).to.not.equal(undefined);
        expect(result[0].remoteUrl, `${JSON.stringify(result[0].remoteUrl)}.include("${UNIT_TEST_BUCKET_NAME}")`).to.include(UNIT_TEST_BUCKET_NAME);
        const expectedUrl = `/${UNIT_TEST_KEYSPACE_PREFIX}${unitTestKeyPrefix}/${UNIT_TEST_FILENAME}`;
        expect(result[0].remoteUrl, `${JSON.stringify(result[0].remoteUrl)}.include("${expectedUrl}")`).to.include(expectedUrl);
        expect(result[0].tags).to.not.equal(undefined);
        expect(result[0].tags?.size).to.equal(1);
        expect(result[0].tags?.has("test")).to.equal(false);
        expect(result[0].tags?.get("unittest")).to.equal("true");
        done();
      }).catch((error) => {
        log("getAllFilesInS3 should return files error", LogLevel.WARN, error);
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder should return files", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      mockGetObjectTagging(tags);
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
        expect(result[0].remoteUrl).to.not.equal(undefined);
        expect(result[0].remoteUrl, `${JSON.stringify(result[0].remoteUrl)}.include("${UNIT_TEST_BUCKET_NAME}")`).to.include(UNIT_TEST_BUCKET_NAME);
        const expectedUrl = `/${UNIT_TEST_KEYSPACE_PREFIX}${unitTestKeyPrefix}/${UNIT_TEST_FILENAME}`;
        expect(result[0].remoteUrl, `${JSON.stringify(result[0].remoteUrl)}.include("${expectedUrl}")`).to.include(expectedUrl);
        expect(result[0].tags).to.not.equal(undefined);
        expect(result[0].tags?.size).to.equal(1);
        expect(result[0].tags?.has("test")).to.equal(false);
        expect(result[0].tags?.get("unittest")).to.equal("true");
        done();
      }).catch((error) => {
        log("getAllFilesInS3 partial folder should return files error", LogLevel.WARN, error);
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder by extension should return files", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      mockGetObjectTagging(tags);
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: UNIT_TEST_FILENAME.slice(-3)
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}", "${UNIT_TEST_FILENAME.slice(-3)}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].tags).to.not.equal(undefined);
        expect(result[0].tags?.size).to.equal(1);
        expect(result[0].tags?.has("test")).to.equal(false);
        expect(result[0].tags?.get("unittest")).to.equal("true");
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder wrong extension should not return files", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: "bad",
        maxFiles: 1000
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}", "bad", 1000) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder by extension array first should return files", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      mockGetObjectTagging(tags);
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: [UNIT_TEST_FILENAME.slice(-3), "bogus"]
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}", ["${UNIT_TEST_FILENAME.slice(-3)}", "bogus"]) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].tags).to.not.equal(undefined);
        expect(result[0].tags?.size).to.equal(1);
        expect(result[0].tags?.has("test")).to.equal(false);
        expect(result[0].tags?.get("unittest")).to.equal("true");
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder by extension array second should return files", (done: Mocha.Done) => {
      mockListObject(UNIT_TEST_FILENAME, unitTestKeyPrefix);
      mockGetObjectTagging(tags);
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: ["bogus", UNIT_TEST_FILENAME.slice(-3)]
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}", ["bogus", "${UNIT_TEST_FILENAME.slice(-3)}"]) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote()).to.be.greaterThan(new Date(0));
        expect(result[0].tags).to.not.equal(undefined);
        expect(result[0].tags?.size).to.equal(1);
        expect(result[0].tags?.has("test")).to.equal(false);
        expect(result[0].tags?.get("unittest")).to.equal("true");
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder wrong extension array should not return files", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasS3File.getAllFilesInS3({
        s3Folder: unitTestKeyPrefix.slice(0, -2),
        localDirectory: UNIT_TEST_LOCAL_FILE_LOCATION,
        extension: ["bad", "bogus"],
        maxFiles: 1000
      }).then((result: PpaasS3File[]) => {
        log(`PpaasS3File.getAllFilesInS3("${unitTestKeyPrefix}", "${UNIT_TEST_LOCAL_FILE_LOCATION}", ["bad", "bogus"], 1000) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
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
      mockUploadObject({ filename: UNIT_TEST_FILENAME, folder: unitTestKeyPrefix });
      testPpaasS3FileUpload.upload().then(() => {
        log("testPpaasS3FileUpload.upload succeeded}", LogLevel.DEBUG);
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
      mockUploadObject({ filename: UNIT_TEST_FILENAME, folder: unitTestKeyPrefix });
      testPpaasS3FileUpload.setLastModifiedLocal(lastModified - 1000);
      testPpaasS3FileUpload.upload().then(() => {
        log("testPpaasS3FileDownload.upload() succeeded", LogLevel.DEBUG);
        // If it's older we should upload it and update the time
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.not.equal("");
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file should not upload unchanged files", (done: Mocha.Done) => {
      mockUploadObject({ filename: UNIT_TEST_FILENAME, folder: unitTestKeyPrefix });
      testPpaasS3FileUpload.setLastModifiedLocal(lastModified); // It checks exact
      testPpaasS3FileUpload.upload().then(() => {
        log("testPpaasS3FileDownload.upload() succeeded", LogLevel.DEBUG);
        // If it's newer we should not upload it and keep the same time
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.equal("");
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file force should upload unchanged files", (done: Mocha.Done) => {
      mockUploadObject({ filename: UNIT_TEST_FILENAME, folder: unitTestKeyPrefix });
      testPpaasS3FileUpload.setLastModifiedLocal(lastModified);
      testPpaasS3FileUpload.upload(true).then(() => {
        log("testPpaasS3FileDownload.upload(true) succeeded", LogLevel.DEBUG);
        // If it's newer, but forced we should upload it and set the time to last modified
        expect(testPpaasS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        expect(testPpaasS3FileUpload.remoteUrl).to.not.equal("");
        done();
      }).catch((error) => done(error));
    });
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;
    const testFilename: string = path.basename(UNIT_TEST_FILEPATH);
    let localFile: string | undefined;

    beforeEach ( () => {
      lastModified = new Date(); // Set the time to now
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
      mockGetObjectTagging(testPpaasS3FileDownload.tags);
      testPpaasS3FileDownload.download().then((result: string) => {
        log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        localFile = testPpaasS3FileDownload.localFilePath;
        fs.stat(localFile).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          expect(stats).to.not.equal(undefined);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("Get File should return changed files", (done: Mocha.Done) => {
      mockGetObject("test", "application/json", lastModified);
      mockGetObjectTagging(testPpaasS3FileDownload.tags);
      // Set it before the last modified so it's changed
      testPpaasS3FileDownload.setLastModifiedRemote(new Date(lastModified.getTime() - 1000));
      testPpaasS3FileDownload.download().then((result: string) => {
        log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        // The time should not be updated
        expect(testPpaasS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
        localFile = testPpaasS3FileDownload.localFilePath;
        fs.stat(localFile).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          expect(stats).to.not.equal(undefined);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("Get File should not return unchanged files", (done: Mocha.Done) => {
      mockGetObjectError(304);
      // Set it to the last modified so it's unchanged
      testPpaasS3FileDownload.setLastModifiedRemote(lastModified);
      testPpaasS3FileDownload.download().then((result: string) => {
        log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        // The time should be updated
        expect(testPpaasS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
        localFile = undefined;
        fs.stat(testPpaasS3FileDownload.localFilePath).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          expect(stats).to.equal(undefined);
          done();
        }).catch((_error) => {
          // We shouldn't have a stats object
          done();
        });
      }).catch((error) => done(error));
    });

    it("Get File force should return unchanged files", (done: Mocha.Done) => {
      mockGetObject("test", "application/json", lastModified);
      mockGetObjectTagging(testPpaasS3FileDownload.tags);
      // Set it to the last modified so it's unchanged
      testPpaasS3FileDownload.setLastModifiedRemote(lastModified);
      // Then force download it
      testPpaasS3FileDownload.download(true).then((result: string) => {
        log(`testPpaasS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        // The time should not be updated
        expect(testPpaasS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
        localFile = testPpaasS3FileDownload.localFilePath;
        fs.stat(localFile).then((stats: Stats) => {
          log(`fs.stat(${testFilename}) stats = ${JSON.stringify(stats)}`, LogLevel.DEBUG);
          // We should have a stats object
          expect(stats).to.not.equal(undefined);
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });
  });

  describe("Copy Files in S3", () => {
    let lastModified: Date;
    let destinationS3Folder: string;
    const destinationFilename = "changed.txt";

    before (() => {
      mockS3();
      const ppaasTestId = PpaasTestId.makeTestId(UNIT_TEST_FILENAME);
      destinationS3Folder = ppaasTestId.s3Folder;
    });

    beforeEach ( () => {
      lastModified = new Date(); // Set the time to now
    });

    it("Caopy a test file to S3", (done: Mocha.Done) => {
      mockCopyObject(lastModified);
      mockGetObjectTagging(testPpaasS3FileDownload.tags);
      testPpaasS3FileDownload.copy({ destinationS3Folder }).then((copiedPpaasS3File: PpaasS3File) => {
        log("testPpaasS3FileUpload.copy succeeded}", LogLevel.DEBUG);
        expect(copiedPpaasS3File.getLastModifiedRemote()).to.equal(lastModified);
        expect(copiedPpaasS3File.s3Folder).to.equal(destinationS3Folder);
        expect(copiedPpaasS3File.filename).to.equal(testPpaasS3FileDownload.filename);
        expect(copiedPpaasS3File.localDirectory).to.equal(testPpaasS3FileDownload.localDirectory);
        expect(copiedPpaasS3File.publicRead).to.equal(undefined);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("Copy and change the name of a test file in S3", (done: Mocha.Done) => {
      mockCopyObject(lastModified);
      mockGetObjectTagging(testPpaasS3FileDownload.tags);
      testPpaasS3FileDownload.copy({ destinationS3Folder, destinationFilename }).then((copiedPpaasS3File: PpaasS3File) => {
        log("testPpaasS3FileUpload.copy succeeded}", LogLevel.DEBUG);
        expect(copiedPpaasS3File.getLastModifiedRemote()).to.equal(lastModified);
        expect(copiedPpaasS3File.s3Folder).to.equal(destinationS3Folder);
        expect(copiedPpaasS3File.filename).to.equal(destinationFilename);
        expect(copiedPpaasS3File.localDirectory).to.equal(testPpaasS3FileDownload.localDirectory);
        expect(copiedPpaasS3File.publicRead).to.equal(undefined);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("Copy and make readable", (done: Mocha.Done) => {
      mockCopyObject(lastModified);
      mockGetObjectTagging(testPpaasS3FileDownload.tags);
      testPpaasS3FileDownload.copy({ destinationS3Folder, publicRead: true }).then((copiedPpaasS3File: PpaasS3File) => {
        log("testPpaasS3FileUpload.copy succeeded}", LogLevel.DEBUG);
        expect(copiedPpaasS3File.getLastModifiedRemote()).to.equal(lastModified);
        expect(copiedPpaasS3File.s3Folder).to.equal(destinationS3Folder);
        expect(copiedPpaasS3File.filename).to.equal(testPpaasS3FileDownload.filename);
        expect(copiedPpaasS3File.localDirectory).to.equal(testPpaasS3FileDownload.localDirectory);
        expect(copiedPpaasS3File.publicRead).to.equal(true);
        done();
      }).catch((error) => {
        done(error);
      });
    });

  });
});
