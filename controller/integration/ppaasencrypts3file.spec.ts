import { LogLevel, PpaasTestId, log, logger, s3, util } from "@fs/ppaas-common";
import { PpaasEncryptS3File, PpaasEncryptS3FileParams } from "../pages/api/util/ppaasencrypts3file";
import { decrypt, waitForSecrets } from "../pages/api/util/secrets";
import { _Object as S3Object } from "@aws-sdk/client-s3";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-controller";

const { deleteObject, listFiles, ADDITIONAL_TAGS_ON_ALL } = s3;
const { poll } = util;
const MAX_POLL_WAIT: number = parseInt(process.env.MAX_POLL_WAIT || "0", 10) || 500;
const filename: string = "unittest.json";

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

describe("PpaasEncryptS3File Integration", () => {
  let s3FileKey: string | undefined;
  let testPpaasEncryptS3FileUpload: PpaasEncryptS3FileUnitTest;
  let testPpaasEncryptS3FileDownload: PpaasEncryptS3FileUnitTest;
  let s3Folder: string;
  const uploadFileContents: string = "It's the end of the world as we know it and I feel fine";
  const resetFileContents: string = "Wrong Number";

  before (async () => {
    const ppaasTestId = PpaasTestId.makeTestId(filename);
    s3Folder = ppaasTestId.s3Folder;
    await waitForSecrets();
  });

  beforeEach (() => {
    testPpaasEncryptS3FileUpload = new PpaasEncryptS3FileUnitTest({ filename, s3Folder, fileContents: uploadFileContents });
    testPpaasEncryptS3FileDownload = new PpaasEncryptS3FileUnitTest({ filename, s3Folder, fileContents: resetFileContents });
  });

  afterEach (async () => {
    testPpaasEncryptS3FileUpload.setLastModifiedRemote(new Date(0));
    testPpaasEncryptS3FileUpload.setLastModifiedLocal(0);
    testPpaasEncryptS3FileDownload.setLastModifiedRemote(new Date(0));
    testPpaasEncryptS3FileDownload.setFileContents(resetFileContents);
    // test
    if (s3FileKey) {
      try {
        // Need time for eventual consistency to complete
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
  });

  after (async () => {
    try {
      await Promise.all([
        deleteObject(testPpaasEncryptS3FileUpload.key),
        deleteObject(testPpaasEncryptS3FileDownload.key)
      ]);
    } catch (error) {
      log(`after deleteObject ${testPpaasEncryptS3FileUpload.key}/${testPpaasEncryptS3FileDownload.key} failed`, LogLevel.INFO, error);
      throw error;
    }
  });

  describe("List PpaasEncryptS3File Empty in S3", () => {
    it("List PpaasEncryptS3File should always succeed even if empty", (done: Mocha.Done) => {
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
    it("Upload a test file to S3", (done: Mocha.Done) => {
      testPpaasEncryptS3FileUpload.upload().then(() => {
        log("testPpaasEncryptS3FileUpload.upload succeeded}", LogLevel.DEBUG);
        s3FileKey = testPpaasEncryptS3FileUpload.key;
        // we should upload it and update the time
        expect(testPpaasEncryptS3FileUpload.getLastModifiedLocal()).to.be.greaterThan(0);
        // Hasn't been downloaded so it shouldn't be set
        expect(testPpaasEncryptS3FileUpload.getLastModifiedRemote().getTime()).to.equal(new Date(0).getTime());
        s3.getFileContents({
          filename: testPpaasEncryptS3FileUpload.filename,
          s3Folder: testPpaasEncryptS3FileUpload.s3Folder
        }).then((fileContents: string | undefined) => {
          log(`testPpaasEncryptS3FileUpload.upload() file contents: ${fileContents}`, LogLevel.DEBUG);
          expect(fileContents).to.not.equal(undefined);
          expect(fileContents).to.not.equal(testPpaasEncryptS3FileUpload.getFileContents());
          const decrypted = decrypt(fileContents!);
          expect(decrypted).to.equal(testPpaasEncryptS3FileUpload.getFileContents());
          done();
        }).catch((error) => done(error));
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("List Files in S3", () => {
    beforeEach (async () => {
      try {
        await testPpaasEncryptS3FileUpload.upload(true);
        log("testPpaasEncryptS3FileUpload.upload() succeeded", LogLevel.DEBUG);
        s3FileKey = testPpaasEncryptS3FileUpload.key;
        // As long as we don't throw, it passes
      } catch (error) {
        throw error;
      }
    });

    it("testPpaasEncryptS3FileDownload should exist inS3", (done: Mocha.Done) => {
      testPpaasEncryptS3FileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasEncryptS3File.existsInS3 should exist inS3", (done: Mocha.Done) => {
      PpaasEncryptS3File.existsInS3(testPpaasEncryptS3FileUpload.key).then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("getAllFilesInS3 should return files", (done: Mocha.Done) => {
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
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;
    beforeEach (async () => {
      await testPpaasEncryptS3FileUpload.upload(true, true);
      s3FileKey = testPpaasEncryptS3FileUpload.key;
      // Reset this between tests
      testPpaasEncryptS3FileDownload.setLastModifiedRemote(new Date(0));
      // As long as we don't throw, it passes
      // Need time for eventual consistency to complete
      const s3Files: S3Object[] | undefined = await poll(async (): Promise<S3Object[] | undefined> => {
        const files = await listFiles(s3FileKey!);
        return (files && files.length > 0) ? files : undefined;
      }, MAX_POLL_WAIT, (errMsg: string) => `${errMsg} Could not find the ${s3FileKey} in s3`);
      if (s3Files && s3Files.length > 0) {
        lastModified = s3Files[0].LastModified || new Date();
        if (lastModified.getTime() > Date.now()) {
          log("s3 time ahead of local clock", LogLevel.ERROR, { now: new Date(), lastModified });
        }
      } else {
        lastModified = new Date(); // Set the time to now
      }
    });

    it("Get File should return files", (done: Mocha.Done) => {
      if (s3FileKey) {
        expect(testPpaasEncryptS3FileDownload.tags, "tags before").to.equal(undefined);
        testPpaasEncryptS3FileDownload.download().then(() => {
          const result: string | undefined = testPpaasEncryptS3FileDownload.getFileContents();
          log(`testPpaasEncryptS3FileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.equal(uploadFileContents);
          expect(testPpaasEncryptS3FileDownload.tags, "tags after").to.not.equal(undefined);
          expect(testPpaasEncryptS3FileDownload.tags?.size, "tags.size").to.equal(1);
          for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
            expect(testPpaasEncryptS3FileDownload.tags?.get(key), "tags[BLUEPRINT_TAG_KEY]").to.equal(value);
          }
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No s3FileKey"));
      }
    });
  });
});
