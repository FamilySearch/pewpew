import {
  ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME,
  PpaasEncryptEnvironmentFile,
  PpaasEncryptEnvironmentFileParams
} from "../pages/api/util/ppaasencryptenvfile";
import { LogLevel, PpaasTestId, log, logger, s3, util } from "@fs/ppaas-common";
import { decrypt, waitForSecrets } from "../pages/api/util/secrets";
import { EnvironmentVariablesFile } from "../types";
import { _Object as S3Object } from "@aws-sdk/client-s3";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-controller";

const { deleteObject, listFiles, ADDITIONAL_TAGS_ON_ALL, defaultTestFileTags } = s3;
const { poll } = util;
const MAX_POLL_WAIT: number = parseInt(process.env.MAX_POLL_WAIT || "0", 10) || 500;
const UNIT_TEST_FILENAME: string = "unittest.json";
const testFileTags: Map<string, string> = defaultTestFileTags();
const testFileTagsSize: number = testFileTags.size;
const blueprintTags = new Map<string, string>(ADDITIONAL_TAGS_ON_ALL);
const allTags = new Map<string, string>([...testFileTags, ...blueprintTags]);

function validateTags (actual: Map<string, string>, expected: Map<string, string>) {
  expect(actual.size, "validateTags size").to.equal(expected.size);
  for (const [key, value] of expected) {
    expect(actual.get(key), `validateTags ${key}`).to.equal(value);
  }
}

class PpaasEncryptEnvironmentFileUnitTest extends PpaasEncryptEnvironmentFile {
  public constructor (params: PpaasEncryptEnvironmentFileParams) {
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

function validateEnvironmentVariablesFile (actual: EnvironmentVariablesFile | undefined, expected: EnvironmentVariablesFile) {
  expect(actual).to.not.equal(undefined);
  if (actual !== undefined) {
    expect(Object.keys(actual).length, "Object.keys(actual).length").to.equal(Object.keys(expected).length);
    for (const [variableName, variableValue] of Object.entries(expected)) {
      expect(JSON.stringify(actual[variableName]), `actual[${variableName}]`).to.equal(JSON.stringify(variableValue));
    }
  }
}

describe("PpaasEncryptEnvironmentFile Integration", () => {
  let s3FileKey: string | undefined;
  let testPpaasEncryptEnvironmentFileUpload: PpaasEncryptEnvironmentFileUnitTest;
  let testPpaasEncryptEnvironmentFileDownload: PpaasEncryptEnvironmentFileUnitTest;
  let s3Folder: string;
  const uploadFileContents: EnvironmentVariablesFile = {
    variable1: "test1",
    variable2: { value: "test2", hidden: false },
    variable3: { value: "test3", hidden: true }
  };
  const expectedFileContents: EnvironmentVariablesFile = {
    variable1: { value: undefined, hidden: true },
    variable2: { value: "test2", hidden: false },
    variable3: { value: undefined, hidden: true }
  };
  const resetFileContents: EnvironmentVariablesFile = {
    variable4: "test4",
    variable5: { value: "test5", hidden: false },
    variable6: { value: "test6", hidden: true }
  };

  before (async () => {
    const ppaasTestId = PpaasTestId.makeTestId(UNIT_TEST_FILENAME);
    s3Folder = ppaasTestId.s3Folder;
    expect(testFileTagsSize, "testFileTagsSize").to.be.greaterThan(0);
    await waitForSecrets();
  });

  beforeEach (() => {
    testPpaasEncryptEnvironmentFileUpload = new PpaasEncryptEnvironmentFileUnitTest({ s3Folder, environmentVariablesFile: uploadFileContents });
    testPpaasEncryptEnvironmentFileDownload = new PpaasEncryptEnvironmentFileUnitTest({ s3Folder, environmentVariablesFile: resetFileContents });
  });

  afterEach (async () => {
    testPpaasEncryptEnvironmentFileUpload.setLastModifiedRemote(new Date(0));
    testPpaasEncryptEnvironmentFileUpload.setLastModifiedLocal(0);
    testPpaasEncryptEnvironmentFileDownload.setLastModifiedRemote(new Date(0));
    testPpaasEncryptEnvironmentFileDownload.setPreviousEnvironmentVariablesFile(resetFileContents);
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
        deleteObject(testPpaasEncryptEnvironmentFileUpload.key),
        deleteObject(testPpaasEncryptEnvironmentFileDownload.key)
      ]);
    } catch (error) {
      log(`after deleteObject ${testPpaasEncryptEnvironmentFileUpload.key}/${testPpaasEncryptEnvironmentFileDownload.key} failed`, LogLevel.INFO, error);
      throw error;
    }
  });

  describe("List PpaasEncryptEnvironmentFile Empty in S3", () => {
    it("List PpaasEncryptEnvironmentFile should always succeed even if empty", (done: Mocha.Done) => {
      PpaasEncryptEnvironmentFile.getAllFilesInS3("bogus").then((result: PpaasEncryptEnvironmentFile[]) => {
        log(`PpaasEncryptEnvironmentFile.getAllFilesInS3("bogus") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
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
      testPpaasEncryptEnvironmentFileUpload.upload().then(() => {
        log("testPpaasEncryptEnvironmentFileUpload.upload succeeded}", LogLevel.DEBUG);
        s3FileKey = testPpaasEncryptEnvironmentFileUpload.key;
        // we should upload it and update the time
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedLocal()).to.be.greaterThan(0);
        // Hasn't been downloaded so it shouldn't be set
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedRemote().getTime()).to.equal(new Date(0).getTime());
        s3.getFileContents({
          filename: testPpaasEncryptEnvironmentFileUpload.filename,
          s3Folder: testPpaasEncryptEnvironmentFileUpload.s3Folder
        }).then((fileContents: string | undefined) => {
          log(`testPpaasEncryptEnvironmentFileUpload.upload() file contents: ${fileContents}`, LogLevel.DEBUG);
          expect(fileContents, "fileContents").to.not.equal(undefined);
          expect(fileContents, "fileContents").to.not.equal(testPpaasEncryptEnvironmentFileUpload.getFileContents());
          const decrypted = decrypt(fileContents!);
          expect(decrypted, "decrypted").to.equal(JSON.stringify(expectedFileContents));
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
        await testPpaasEncryptEnvironmentFileUpload.upload(true);
        log("testPpaasEncryptEnvironmentFileUpload.upload() succeeded", LogLevel.DEBUG);
        s3FileKey = testPpaasEncryptEnvironmentFileUpload.key;
        // As long as we don't throw, it passes
      } catch (error) {
        throw error;
      }
    });

    it("testPpaasEncryptEnvironmentFileDownload should exist inS3", (done: Mocha.Done) => {
      testPpaasEncryptEnvironmentFileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasEncryptEnvironmentFile.existsInS3 should exist inS3", (done: Mocha.Done) => {
      PpaasEncryptEnvironmentFile.existsInS3(testPpaasEncryptEnvironmentFileUpload.key).then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("getAllFilesInS3 should return files", (done: Mocha.Done) => {
      PpaasEncryptEnvironmentFile.getAllFilesInS3(s3Folder).then((result: PpaasEncryptEnvironmentFile[]) => {
        log(`PpaasEncryptEnvironmentFile.getAllFilesInS3("${s3Folder}") result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
        expect(result).to.not.equal(undefined);
        expect(result.length, "result.length").to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote().getTime(), "getLastModifiedRemote").to.be.greaterThan(new Date(0).getTime());
        expect(result[0].s3Folder, "s3Folder").to.include(s3Folder);
        expect(result[0].filename, "filename").to.equal(ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME);
        expect(result[0].tags, "tags").to.not.equal(undefined);
        validateTags(result[0].tags!, allTags);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;
    beforeEach (async () => {
      await testPpaasEncryptEnvironmentFileUpload.upload(true, true);
      s3FileKey = testPpaasEncryptEnvironmentFileUpload.key;
      // Reset this between tests
      testPpaasEncryptEnvironmentFileDownload.setLastModifiedRemote(new Date(0));
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
        testPpaasEncryptEnvironmentFileDownload.download().then(() => {
          const result: string | undefined = testPpaasEncryptEnvironmentFileDownload.getFileContents();
          log(`testPpaasEncryptEnvironmentFileDownload.download() result = ${result}`, LogLevel.DEBUG);
          expect(result).to.equal(JSON.stringify(expectedFileContents));
          validateEnvironmentVariablesFile(testPpaasEncryptEnvironmentFileDownload.getEnvironmentVariablesFile(), expectedFileContents);
          expect(testPpaasEncryptEnvironmentFileDownload.tags, "tags").to.not.equal(undefined);
          validateTags(testPpaasEncryptEnvironmentFileDownload.tags!, allTags);
          done();
        }).catch((error) => done(error));
      } else {
        done(new Error("No s3FileKey"));
      }
    });
  });
});
