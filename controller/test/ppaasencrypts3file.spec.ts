import { LogLevel, PpaasTestId, log, s3, util } from "@fs/ppaas-common";
import { PpaasEncryptS3File, PpaasEncryptS3FileParams } from "../pages/api/util/ppaasencrypts3file";
import { encrypt, getEncryptionKey } from "../pages/api/util/secrets";
import {
  mockGetObject,
  mockGetObjectError,
  mockGetObjectTagging,
  mockGetSecretValue,
  mockListObject,
  mockListObjects,
  mockS3,
  mockSecrets,
  mockUploadObject,
  mockUploadObjectError,
  resetMockS3,
  resetMockSecrets
} from "./mock";
import { expect } from "chai";

const { ADDITIONAL_TAGS_ON_ALL } = s3;
const filename: string = "unittest.json";
const additionalTagsOnAll = new Map<string, string>(ADDITIONAL_TAGS_ON_ALL);

class PpaasEncryptS3FileUnitTest extends PpaasEncryptS3File {
  public constructor (params: PpaasEncryptS3FileParams) {
    super(params);
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

describe("PpaasEncryptS3File", () => {
  let s3FileKey: string | undefined;
  let testPpaasEncryptS3FileUpload: PpaasEncryptS3FileUnitTest;
  let testPpaasEncryptS3FileDownload: PpaasEncryptS3FileUnitTest;
  let s3Folder: string;
  const uploadFileContents: string = "It's the end of the world as we know it and I feel fine";
  const resetFileContents: string = "Wrong Number";
  let emptyFileContentsEncrypted: string;
  let uploadFileContentsEncrypted: string;
  const setupMocks = () => {
    mockS3();
    mockGetObjectTagging(additionalTagsOnAll);
    mockUploadObject();
  };

  before (async () => {
    const ppaasTestId = PpaasTestId.makeTestId(filename);
    s3Folder = ppaasTestId.s3Folder;
    setupMocks();
    mockSecrets();
    mockGetSecretValue();
    let retryCount = 0;
    do {
      try {
        getEncryptionKey();
        break; // If it doesn't throw, we got it
      } catch (error) {
        log("Could not get encryption key, retrying: " + retryCount, LogLevel.WARN, error);
        await util.sleep(100);
      }
    } while (retryCount++ < 5);
    emptyFileContentsEncrypted = encrypt("");
    uploadFileContentsEncrypted = encrypt(uploadFileContents);
  });

  beforeEach (() => {
    testPpaasEncryptS3FileUpload = new PpaasEncryptS3FileUnitTest({ filename, s3Folder, fileContents: uploadFileContents });
    testPpaasEncryptS3FileDownload = new PpaasEncryptS3FileUnitTest({ filename, s3Folder, fileContents: resetFileContents });
  });

  after (() => {
    resetMockS3();
    resetMockSecrets();
  });

  describe("Constructor", () => {
    it("should not add tags by default", (done: Mocha.Done) => {
      try {
        const fileContents = "";
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents });
        expect(ppaasEncryptS3File.filename, "filename").to.equal(filename);
        expect(ppaasEncryptS3File.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(ppaasEncryptS3File.getFileContents(), "fileContents").to.equal(fileContents);
        expect(ppaasEncryptS3File.tags, "tags").to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should add tags", (done: Mocha.Done) => {
      try {
        const fileContents = "";
        const tags = s3.defaultTestFileTags();
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents, tags });
        expect(ppaasEncryptS3File.filename, "filename").to.equal(filename);
        expect(ppaasEncryptS3File.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(ppaasEncryptS3File.getFileContents(), "fileContents").to.equal(fileContents);
        expect(ppaasEncryptS3File.tags, "tags").to.not.equal(undefined);
        expect(ppaasEncryptS3File.tags?.size, "tags.size").to.equal(tags.size);
        expect(JSON.stringify([...(ppaasEncryptS3File.tags || [])]), "tags").to.equal(JSON.stringify([...tags]));
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should set fileContents", (done: Mocha.Done) => {
      try {
        const fileContents = "bogus";
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents });
        expect(ppaasEncryptS3File.filename, "filename").to.equal(filename);
        expect(ppaasEncryptS3File.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(ppaasEncryptS3File.getFileContents(), "fileContents").to.equal(fileContents);
        expect(ppaasEncryptS3File.tags, "tags").to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("setFileContents", () => {
    it("setFileContents should throw on empty string", (done: Mocha.Done) => {
      try {
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents: "" });
        ppaasEncryptS3File.setFileContents("");
        done(new Error("setFileContents should have thrown"));
      } catch (error) {
        expect(`${error}`).to.include("cannot be an empty");
        done();
      }
    });

    it("setFileContents should throw", (done: Mocha.Done) => {
      try {
        const fileContents = "bogus";
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents: "" });
        ppaasEncryptS3File.setFileContents(fileContents);
        expect(ppaasEncryptS3File.getFileContents(), "fileContents").to.equal(fileContents);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("sanitizedCopy/toString", () => {
    it("sanitizedCopy not have a body or fileContents", (done: Mocha.Done) => {
      try {
        const fileContents = "bogus";
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents });
        const sanitizedCopy = ppaasEncryptS3File.sanitizedCopy() as PpaasEncryptS3File;
        expect(sanitizedCopy).to.not.equal(undefined);
        expect(sanitizedCopy.body, "body").to.equal(undefined);
        expect(sanitizedCopy.getFileContents(), "getFileContents()").to.equal(undefined);
        const sanitizedJson = JSON.parse(JSON.stringify(sanitizedCopy));
        expect(sanitizedJson.body, "body").to.equal(undefined);
        expect(sanitizedJson.fileContents, "fileContents").to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("toString not have a body or fileContents", (done: Mocha.Done) => {
      try {
        const fileContents = "bogus";
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder, fileContents });
        const toString: string = ppaasEncryptS3File.toString();
        expect(toString).to.not.equal(undefined);
        expect(toString).to.not.include(fileContents);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("List PpaasEncryptS3File Empty in S3", () => {
    it("List PpaasEncryptS3File should always succeed even if empty", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasEncryptS3File.getAllFilesInS3("bogus", filename).then((result: PpaasEncryptS3File[]) => {
        log(`PpaasEncryptS3File.getAllFilesInS3("bogus", ${filename}) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(0);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Upload File to S3", () => {
    beforeEach(() => {
      resetMockS3();
      setupMocks();
    });

    after(() => {
      resetMockS3();
      setupMocks();
    });

    it("Upload a test file to S3", (done: Mocha.Done) => {
      mockUploadObject();
      testPpaasEncryptS3FileUpload.upload().then(() => {
        log("testPpaasEncryptS3FileUpload.upload succeeded}", LogLevel.DEBUG);
        s3FileKey = testPpaasEncryptS3FileUpload.key;
        // we should upload it and update the time
        expect(testPpaasEncryptS3FileUpload.getLastModifiedLocal()).to.be.greaterThan(0);
        // Hasn't been downloaded so it shouldn't be set
        expect(testPpaasEncryptS3FileUpload.getLastModifiedRemote().getTime()).to.equal(new Date(0).getTime());
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("Upload a test file should upload changed files", (done: Mocha.Done) => {
      mockUploadObject();
      testPpaasEncryptS3FileUpload.setLastModifiedLocal(0);
      testPpaasEncryptS3FileUpload.upload().then(() => {
        log("testPpaasEncryptS3FileDownload.upload() succeeded", LogLevel.DEBUG);
        s3FileKey = testPpaasEncryptS3FileUpload.key;
        // If it's older we should upload it and update the time
        expect(testPpaasEncryptS3FileUpload.getLastModifiedLocal()).to.be.greaterThan(0);
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file should not upload unchanged files", (done: Mocha.Done) => {
      mockUploadObjectError();
      const lastModified: number = Date.now();
      testPpaasEncryptS3FileUpload.setLastModifiedLocal(lastModified);
      testPpaasEncryptS3FileUpload.upload().then(() => {
        s3FileKey = undefined;
        log("testPpaasEncryptS3FileDownload.upload() succeeded", LogLevel.DEBUG);
        // If it's newer we should not upload it and keep the same time
        expect(testPpaasEncryptS3FileUpload.getLastModifiedLocal()).to.equal(lastModified);
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file force should upload unchanged files", (done: Mocha.Done) => {
      mockUploadObject();
      const lastModified: number = Date.now() - 1;
      testPpaasEncryptS3FileUpload.setLastModifiedLocal(lastModified);
      testPpaasEncryptS3FileUpload.upload(true).then(() => {
        s3FileKey = testPpaasEncryptS3FileUpload.key;
        log("testPpaasEncryptS3FileDownload.upload(true) succeeded", LogLevel.DEBUG);
        // If it's newer, but forced we should upload it and set the time to last modified
        expect(testPpaasEncryptS3FileUpload.getLastModifiedLocal()).to.be.greaterThan(lastModified);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("List Files in S3", () => {
    it("testPpaasEncryptS3FileDownload should exist inS3", (done: Mocha.Done) => {
      mockListObject();
      testPpaasEncryptS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasEncryptS3File.existsInS3 should exist inS3", (done: Mocha.Done) => {
      mockListObject();
      PpaasEncryptS3File.existsInS3(testPpaasEncryptS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("testPpaasEncryptS3FileDownload should not exist inS3", (done: Mocha.Done) => {
      mockListObjects([]);
      testPpaasEncryptS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasEncryptS3File.existsInS3 should not exist inS3", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasEncryptS3File.existsInS3(testPpaasEncryptS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(false);
        done();
      })
      .catch((error) => done(error));
    });

    it("getAllFilesInS3 should return files", (done: Mocha.Done) => {
      mockListObject({ filename, folder: s3Folder });
      mockGetObject(emptyFileContentsEncrypted);
      PpaasEncryptS3File.getAllFilesInS3(s3Folder).then((result: PpaasEncryptS3File[]) => {
        log(`PpaasEncryptS3File.getAllFilesInS3("${s3Folder}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote().getTime()).to.be.greaterThan(new Date(0).getTime());
        expect(result[0].s3Folder, "s3Folder").to.include(s3Folder);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder should return files", (done: Mocha.Done) => {
      mockListObject({ filename, folder: s3Folder });
      mockGetObject(emptyFileContentsEncrypted);
      PpaasEncryptS3File.getAllFilesInS3(s3Folder.slice(0, -2)).then((result: PpaasEncryptS3File[]) => {
        log(`PpaasEncryptS3File.getAllFilesInS3("${s3Folder.slice(0, -2)}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote().getTime()).to.be.greaterThan(new Date(0).getTime());
        expect(result[0].s3Folder, "s3Folder").to.include(s3Folder);
        expect(result[0].filename, "filename").to.equal(filename);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder by extension should return files", (done: Mocha.Done) => {
      mockListObject({ filename, folder: s3Folder });
      mockGetObject(emptyFileContentsEncrypted);
      PpaasEncryptS3File.getAllFilesInS3(s3Folder.slice(0, -2), filename.slice(-3)).then((result: PpaasEncryptS3File[]) => {
        log(`PpaasEncryptS3File.getAllFilesInS3("${s3Folder}", "${filename.slice(-3)}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length).to.equal(1);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote().getTime()).to.be.greaterThan(new Date(0).getTime());
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder wrong extension should not return files", (done: Mocha.Done) => {
      mockListObject({ filename, folder: s3Folder });
      PpaasEncryptS3File.getAllFilesInS3(s3Folder.slice(0, -2), "bad", 1000).then((result: PpaasEncryptS3File[]) => {
        log(`PpaasEncryptS3File.getAllFilesInS3("${s3Folder}", 1000) result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
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
    beforeEach (async () => {
      await testPpaasEncryptS3FileUpload.upload(true, true);
      s3FileKey = testPpaasEncryptS3FileUpload.key;
      // Reset this between tests
      testPpaasEncryptS3FileDownload.setLastModifiedRemote(new Date(0));
      lastModified = new Date(); // Set the time to now
      mockGetObjectTagging(additionalTagsOnAll);
      log("mockGetObjectTagging", LogLevel.DEBUG, additionalTagsOnAll);
    });

    it("Get File should return files", (done: Mocha.Done) => {
      if (s3FileKey) {
        mockListObject();
        mockGetObject(uploadFileContentsEncrypted);
        expect(testPpaasEncryptS3FileDownload.tags, "tags before").to.equal(undefined);
        testPpaasEncryptS3FileDownload.download().then(() => {
          const result: string | undefined = testPpaasEncryptS3FileDownload.getFileContents();
          log(`testPpaasEncryptS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.equal(uploadFileContents);
          log("testPpaasEncryptS3FileDownload.tags", LogLevel.DEBUG, testPpaasEncryptS3FileDownload.tags);
          expect(testPpaasEncryptS3FileDownload.tags, "tags after").to.not.equal(undefined);
          expect(testPpaasEncryptS3FileDownload.tags?.size, "tags.size").to.equal(1);
          for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
            expect(testPpaasEncryptS3FileDownload.tags?.get(key), `ADDITIONAL_TAGS_ON_ALL tags["${key}"]`).to.equal(value);
          }
          done();
        }).catch((error) => {
          log("Get File should return files error", LogLevel.WARN, error);
          done(error);
        });
      } else {
        done(new Error("No s3FileKey"));
      }
    });

    it("Get File should return changed files", (done: Mocha.Done) => {
      if (s3FileKey) {
        mockListObject();
        mockGetObject(uploadFileContentsEncrypted);
        // Set it before the last modified so it's changed
        testPpaasEncryptS3FileDownload.setLastModifiedRemote(new Date(lastModified.getTime() - 5000));
        testPpaasEncryptS3FileDownload.download().then(() => {
          const result: string | undefined = testPpaasEncryptS3FileDownload.getFileContents();
          log(`testPpaasEncryptS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.equal(uploadFileContents);
          // The time should not be updated
          expect(testPpaasEncryptS3FileDownload.getLastModifiedRemote().getTime()).to.greaterThan(lastModified.getTime() - 5000);
          expect(testPpaasEncryptS3FileDownload.tags, "tags after").to.not.equal(undefined);
          expect(testPpaasEncryptS3FileDownload.tags?.size, "tags.size").to.equal(1);
          for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
            expect(testPpaasEncryptS3FileDownload.tags?.get(key), `ADDITIONAL_TAGS_ON_ALL tags["${key}"]`).to.equal(value);
          }
          done();
        }).catch((error) => {
          log("Get File should return changed files error", LogLevel.WARN, error);
          done(error);
        });
      } else {
        done(new Error("No s3FileKey"));
      }
    });

    it("Get File should not return unchanged files", (done: Mocha.Done) => {
      if (s3FileKey) {
        mockListObject();
        mockGetObjectError(304);
        // Set it to the last modified so it's unchanged
        testPpaasEncryptS3FileDownload.setLastModifiedRemote(lastModified);
        testPpaasEncryptS3FileDownload.download().then(() => {
          const result: string | undefined = testPpaasEncryptS3FileDownload.getFileContents();
          log(`testPpaasEncryptS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.equal(resetFileContents);
          // The time should be updated
          expect(testPpaasEncryptS3FileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
          expect(testPpaasEncryptS3FileDownload.tags, "tags after").to.equal(undefined);
          done();
        }).catch((error) => {
          log("Get File should not return unchanged files error", LogLevel.WARN, error);
          done(error);
        });
      } else {
        done(new Error("No s3FileKey"));
      }

    });

    it("Get File force should return unchanged files", (done: Mocha.Done) => {
      if (s3FileKey) {
        mockListObject();
        mockGetObject(uploadFileContentsEncrypted);
        // Set it to the last modified so it's unchanged. If s3 time is ahead of us, set it to now
        const timeBefore: Date = (lastModified.getTime() > Date.now()) ? new Date() : lastModified;
        testPpaasEncryptS3FileDownload.setLastModifiedRemote(lastModified);
        // Then force download it
        testPpaasEncryptS3FileDownload.download(true).then(() => {
          const result: string | undefined = testPpaasEncryptS3FileDownload.getFileContents();
          log(`testPpaasEncryptS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.equal(uploadFileContents);
          // The time should not be updated
          expect(testPpaasEncryptS3FileDownload.getLastModifiedRemote().getTime()).to.greaterThan(timeBefore.getTime() - 1);
          expect(testPpaasEncryptS3FileDownload.tags, "tags after").to.not.equal(undefined);
          expect(testPpaasEncryptS3FileDownload.tags?.size, "tags.size").to.equal(1);
          for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
            expect(testPpaasEncryptS3FileDownload.tags?.get(key), `ADDITIONAL_TAGS_ON_ALL tags["${key}"]`).to.equal(value);
          }
          done();
        }).catch((error) => {
          log("Get File force should return unchanged files error", LogLevel.WARN, error);
          done(error);
        });
      } else {
        done(new Error("No s3FileKey"));
      }
    });
  });
});
