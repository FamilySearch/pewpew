import {
  ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME,
  PpaasEncryptEnvironmentFile,
  PpaasEncryptEnvironmentFileParams
} from "../pages/api/util/ppaasencryptenvfile";
import {
  EnvironmentVariableState,
  EnvironmentVariablesFile,
  PreviousEnvironmentVariables
} from "../types";
import {
  EnvironmentVariables,
  LogLevel,
  PpaasTestId,
  log,
  logger,
  s3,
  util
} from "@fs/ppaas-common";
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
  resetMockS3,
  resetMockSecrets
} from "./mock";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-controller";

const { ADDITIONAL_TAGS_ON_ALL, defaultTestFileTags } = s3;
const UNIT_TEST_FILENAME: string = "unittest.json";
const overrideTags = new Map<string, string>([["unittest", "true"]]);
const testFileTags: Map<string, string> = defaultTestFileTags();
const testFileTagsSize: number = testFileTags.size;
const blueprintTags = new Map<string, string>(ADDITIONAL_TAGS_ON_ALL);
const allTags = new Map<string, string>([...testFileTags, ...blueprintTags]);

function validateTags (actual: Map<string, string>, expected: Map<string, string>) {
  log("validateTags", LogLevel.DEBUG, { actual: Array.from(actual), expected: Array.from(expected) });
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

function validateEnvironmentVariablesFile (actual: EnvironmentVariablesFile | undefined, expected: EnvironmentVariablesFile, name: string = "") {
  expect(actual).to.not.equal(undefined);
  if (actual !== undefined) {
    expect(Object.keys(actual).length, name + " Object.keys(actual).length").to.equal(Object.keys(expected).length);
    for (const [variableName, variableValue] of Object.entries(expected)) {
      expect(JSON.stringify(actual[variableName]), `${name} actual[${variableName}]`).to.equal(JSON.stringify(variableValue));
    }
  }
}

describe("PpaasEncryptEnvironmentFile", () => {
  let testPpaasEncryptEnvironmentFileUpload: PpaasEncryptEnvironmentFileUnitTest;
  let testPpaasEncryptEnvironmentFileDownload: PpaasEncryptEnvironmentFileUnitTest;
  let s3Folder: string;
  const emptyEnvironmentVariablesFile: EnvironmentVariablesFile = {};
  const allEnvironmentVariables: EnvironmentVariables = {
    variable1: "test1",
    variable2: "test2",
    variable3: "test3"
  };
  const legacyEnvironmentVariablesFile: EnvironmentVariablesFile = {
    variable1: "test1",
    variable2: "test2",
    variable3: "test3"
  };
  const legacyPreviousEnvironmentVariables: PreviousEnvironmentVariables = {
    // All hidden
  };
  const modernEnvironmentVariablesFile: EnvironmentVariablesFile = {
    variable1: { value: "test1", hidden: false },
    variable2: { value: "test2", hidden: false },
    variable3: { value: "test3", hidden: true }
  };
  const modernPreviousEnvironmentVariables: PreviousEnvironmentVariables = {
    variable1: "test1",
    variable2: "test2"
    // variable3: hidden
  };
  const mixedEnvironmentVariablesFile: EnvironmentVariablesFile = {
    variable1: "test1",
    variable2: { value: "test2", hidden: false },
    variable3: { value: "test3", hidden: true }
  };
  const mixedPreviousEnvironmentVariables: PreviousEnvironmentVariables = {
    // variable1: hidden,
    variable2: "test2"
    // variable3: hidden
  };
  const uploadFileContents: EnvironmentVariablesFile = {
    variable1: "test1",
    variable2: { value: "test2", hidden: false },
    variable3: { value: "test3", hidden: true }
  };
  const resetFileContents: EnvironmentVariablesFile = {
    variable4: "test4",
    variable5: { value: "test5", hidden: false },
    variable6: { value: "test6", hidden: true }
  };
  let emptyFileContentsEncrypted: string;
  let uploadFileContentsEncrypted: string;

  before (async () => {
    const ppaasTestId = PpaasTestId.makeTestId(UNIT_TEST_FILENAME);
    s3Folder = ppaasTestId.s3Folder;
    expect(testFileTagsSize, "testFileTagsSize").to.be.greaterThan(0);
    mockS3();
    mockGetObjectTagging(allTags);
    mockUploadObject();
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
    emptyFileContentsEncrypted = encrypt(JSON.stringify({}));
    uploadFileContentsEncrypted = encrypt(JSON.stringify(uploadFileContents));
  });

  beforeEach (() => {
    testPpaasEncryptEnvironmentFileUpload = new PpaasEncryptEnvironmentFileUnitTest({ s3Folder, environmentVariablesFile: uploadFileContents });
    testPpaasEncryptEnvironmentFileDownload = new PpaasEncryptEnvironmentFileUnitTest({ s3Folder, environmentVariablesFile: resetFileContents });
  });

  after (() => {
    resetMockS3();
    resetMockSecrets();
  });

  describe("Constructor", () => {
    it("should accept undefined and set default tags", (done: Mocha.Done) => {
      try {
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({
          s3Folder,
          environmentVariablesFile: undefined
        });
        expect(pppaasEncryptEnvironmentFile, "environmentFile").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getFileContents(), "environmentFile.getFileContents()").to.equal("");
        expect(pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile(), "environmentFile.getEnvironmentVariablesFile()").to.equal(undefined);
        expect(JSON.stringify(pppaasEncryptEnvironmentFile.getEnvironmentVariables()), "environmentFile.getEnvironmentVariables()").to.equal("{}");
        expect(pppaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(), "environmentFile.getPreviousEnvironmentVariables()").to.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getLastModifiedRemote().getTime(), "environmentFile.getLastModifiedRemote()").to.equal(0);
        expect(pppaasEncryptEnvironmentFile.tags, "environmentFile.tags").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.tags?.size, "environmentFile.tags").to.equal(defaultTestFileTags().size);
        expect(JSON.stringify([...(pppaasEncryptEnvironmentFile.tags || [])]), "environmentFile.tags").to.equal(JSON.stringify([...defaultTestFileTags()]));
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should override default tags", (done: Mocha.Done) => {
      try {
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({
          s3Folder,
          environmentVariablesFile: undefined,
          tags: overrideTags
        });
        expect(pppaasEncryptEnvironmentFile, "environmentFile").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getFileContents(), "environmentFile.getFileContents()").to.equal("");
        expect(pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile(), "environmentFile.getEnvironmentVariablesFile()").to.equal(undefined);
        expect(JSON.stringify(pppaasEncryptEnvironmentFile.getEnvironmentVariables()), "environmentFile.getEnvironmentVariables()").to.equal("{}");
        expect(pppaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(), "environmentFile.getPreviousEnvironmentVariables()").to.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getLastModifiedRemote().getTime(), "environmentFile.getLastModifiedRemote()").to.equal(0);
        expect(pppaasEncryptEnvironmentFile.tags, "environmentFile.tags").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.tags?.size, "environmentFile.tags").to.equal(overrideTags.size);
        expect(JSON.stringify([...(pppaasEncryptEnvironmentFile.tags || [])]), "environmentFile.tags").to.equal(JSON.stringify([...overrideTags]));
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept empty EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = emptyEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = {};
        const previousEnvironmentVariables: PreviousEnvironmentVariables = {};
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        expect(pppaasEncryptEnvironmentFile, "environmentFile").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getFileContents(), "environmentFile.getFileContents()").to.equal(JSON.stringify(environmentVariablesFile));
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile(), environmentVariablesFile, "getEnvironmentVariablesFile");
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariables(), environmentVariables, "getEnvironmentVariables");
        expect(JSON.stringify(pppaasEncryptEnvironmentFile.getPreviousEnvironmentVariables()), "environmentFile.getPreviousEnvironmentVariables()").to.equal(JSON.stringify(previousEnvironmentVariables));
        expect(pppaasEncryptEnvironmentFile.getLastModifiedRemote().getTime(), "environmentFile.getLastModifiedRemote()").to.equal(0);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept legacy EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = legacyEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = allEnvironmentVariables;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = legacyPreviousEnvironmentVariables;
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        expect(pppaasEncryptEnvironmentFile, "environmentFile").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getFileContents(), "environmentFile.getFileContents()").to.equal(JSON.stringify(environmentVariablesFile));
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile(), environmentVariablesFile, "getEnvironmentVariablesFile");
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariables(), environmentVariables, "getEnvironmentVariables");
        expect(JSON.stringify(pppaasEncryptEnvironmentFile.getPreviousEnvironmentVariables()), "environmentFile.getPreviousEnvironmentVariables()").to.equal(JSON.stringify(previousEnvironmentVariables));
        expect(pppaasEncryptEnvironmentFile.getLastModifiedRemote().getTime(), "environmentFile.getLastModifiedRemote()").to.equal(0);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept modern EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = modernEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = allEnvironmentVariables;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = modernPreviousEnvironmentVariables;
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        expect(pppaasEncryptEnvironmentFile, "environmentFile").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getFileContents(), "environmentFile.getFileContents()").to.equal(JSON.stringify(environmentVariablesFile));
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile(), environmentVariablesFile, "getEnvironmentVariablesFile");
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariables(), environmentVariables, "getEnvironmentVariables");
        expect(JSON.stringify(pppaasEncryptEnvironmentFile.getPreviousEnvironmentVariables()), "environmentFile.getPreviousEnvironmentVariables()").to.equal(JSON.stringify(previousEnvironmentVariables));
        expect(pppaasEncryptEnvironmentFile.getLastModifiedRemote().getTime(), "environmentFile.getLastModifiedRemote()").to.equal(0);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept mixed EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = mixedEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = allEnvironmentVariables;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = mixedPreviousEnvironmentVariables;
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        expect(pppaasEncryptEnvironmentFile, "environmentFile").to.not.equal(undefined);
        expect(pppaasEncryptEnvironmentFile.getFileContents(), "environmentFile.getFileContents()").to.equal(JSON.stringify(environmentVariablesFile));
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile(), environmentVariablesFile, "getEnvironmentVariablesFile");
        validateEnvironmentVariablesFile(pppaasEncryptEnvironmentFile.getEnvironmentVariables(), environmentVariables, "getEnvironmentVariables");
        expect(JSON.stringify(pppaasEncryptEnvironmentFile.getPreviousEnvironmentVariables()), "environmentFile.getPreviousEnvironmentVariables()").to.equal(JSON.stringify(previousEnvironmentVariables));
        expect(pppaasEncryptEnvironmentFile.getLastModifiedRemote().getTime(), "environmentFile.getLastModifiedRemote()").to.equal(0);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

    it("setFileContents should throw", (done: Mocha.Done) => {
      try {
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: mixedEnvironmentVariablesFile });
        pppaasEncryptEnvironmentFile.setFileContents("{}");
        done(new Error("setFileContents should have thrown"));
      } catch (error) {
        expect(`${error}`).to.include("setPreviousEnvironmentVariablesFile");
        done();
      }
    });

    it("getEnvironmentVariablesFile response should not modify original", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = JSON.parse(JSON.stringify(mixedEnvironmentVariablesFile));
        const originalString: string = JSON.stringify(environmentVariablesFile);
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        const file1 = pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile()!;
        expect(JSON.stringify(file1), "file1").to.equal(originalString);
        file1.variable1 = "failTest";
        delete file1.variable2;
        const file2 = pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile()!;
        expect(JSON.stringify(file2), "file2").to.equal(originalString);
        environmentVariablesFile.variable1 = "failOriginal";
        delete environmentVariablesFile.variable2;
        const file3 = pppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
        expect(JSON.stringify(file3), "file3").to.equal(originalString);
        done();
      } catch (error) {
        done(error);
      }
    });

  describe("sanitizedCopy/toString", () => {
    it("sanitizedCopy not have a body or fileContents", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = JSON.parse(JSON.stringify(mixedEnvironmentVariablesFile));
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        const sanitizedCopy = pppaasEncryptEnvironmentFile.sanitizedCopy() as PpaasEncryptEnvironmentFile;
        expect(sanitizedCopy).to.not.equal(undefined);
        expect(sanitizedCopy.body, "body").to.equal(undefined);
        expect(sanitizedCopy.getFileContents(), "getFileContents()").to.equal(undefined);
        expect(sanitizedCopy.getEnvironmentVariablesFile(), "getEnvironmentVariablesFile()").to.equal(undefined);
        expect(JSON.stringify(sanitizedCopy.getEnvironmentVariables()), "getEnvironmentVariables()").to.equal("{}");
        done();
      } catch (error) {
        done();
      }
    });

    it("toString not have a body or fileContents", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = JSON.parse(JSON.stringify(mixedEnvironmentVariablesFile));
        const originalString: string = JSON.stringify(environmentVariablesFile);
        const pppaasEncryptEnvironmentFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile });
        const toString: string = pppaasEncryptEnvironmentFile.toString();
        expect(toString).to.not.equal(undefined);
        expect(toString).to.not.include(originalString);
        expect(toString).to.not.include(mixedEnvironmentVariablesFile.variable1);
        expect(toString).to.not.include((mixedEnvironmentVariablesFile.variable2 as EnvironmentVariableState).value);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("getEnvironmentVariables", () => {
    it("should accept empty EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = emptyEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = {};
        validateEnvironmentVariablesFile(
          PpaasEncryptEnvironmentFile.getEnvironmentVariables(environmentVariablesFile),
          environmentVariables,
          "getEnvironmentVariables"
        );
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept legacy EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = legacyEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = allEnvironmentVariables;
        validateEnvironmentVariablesFile(
          PpaasEncryptEnvironmentFile.getEnvironmentVariables(environmentVariablesFile),
          environmentVariables,
          "getEnvironmentVariables"
        );
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept modern EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = modernEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = allEnvironmentVariables;
        validateEnvironmentVariablesFile(
          PpaasEncryptEnvironmentFile.getEnvironmentVariables(environmentVariablesFile),
          environmentVariables,
          "getEnvironmentVariables"
        );
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept mixed EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = mixedEnvironmentVariablesFile;
        const environmentVariables: EnvironmentVariables = allEnvironmentVariables;
        validateEnvironmentVariablesFile(
          PpaasEncryptEnvironmentFile.getEnvironmentVariables(environmentVariablesFile),
          environmentVariables,
          "getEnvironmentVariables"
        );
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("getPreviousEnvironmentVariables", () => {
    it("should accept empty EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = emptyEnvironmentVariablesFile;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = {};
        expect(JSON.stringify(PpaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(environmentVariablesFile)))
          .to.equal(JSON.stringify(previousEnvironmentVariables));
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept legacy EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = legacyEnvironmentVariablesFile;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = legacyPreviousEnvironmentVariables;
        expect(JSON.stringify(PpaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(environmentVariablesFile)))
          .to.equal(JSON.stringify(previousEnvironmentVariables));
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept modern EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = modernEnvironmentVariablesFile;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = modernPreviousEnvironmentVariables;
        expect(JSON.stringify(PpaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(environmentVariablesFile)))
          .to.equal(JSON.stringify(previousEnvironmentVariables));
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should accept mixed EnvironmentVariablesFile", (done: Mocha.Done) => {
      try {
        const environmentVariablesFile: EnvironmentVariablesFile = mixedEnvironmentVariablesFile;
        const previousEnvironmentVariables: PreviousEnvironmentVariables = mixedPreviousEnvironmentVariables;
        expect(JSON.stringify(PpaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(environmentVariablesFile)))
          .to.equal(JSON.stringify(previousEnvironmentVariables));
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("List PpaasEncryptEnvironmentFile Empty in S3", () => {
    it("List PpaasEncryptEnvironmentFile should always succeed even if empty", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasEncryptEnvironmentFile.getAllFilesInS3("bogus").then((result: PpaasEncryptEnvironmentFile[]) => {
        log("PpaasEncryptEnvironmentFile.getAllFilesInS3(\"bogus\") result", LogLevel.DEBUG, result);
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
        // we should upload it and update the time
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedLocal()).to.be.greaterThan(0);
        // Hasn't been downloaded so it shouldn't be set
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedRemote().getTime()).to.equal(new Date(0).getTime());
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("Upload a test file should upload changed files", (done: Mocha.Done) => {
      testPpaasEncryptEnvironmentFileUpload.setLastModifiedLocal(0);
      testPpaasEncryptEnvironmentFileUpload.upload().then(() => {
        log("testPpaasEncryptEnvironmentFileDownload.upload() succeeded", LogLevel.DEBUG);
        // If it's older we should upload it and update the time
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedLocal()).to.be.greaterThan(0);
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file should not upload unchanged files", (done: Mocha.Done) => {
      const lastModified: number = Date.now();
      testPpaasEncryptEnvironmentFileUpload.setLastModifiedLocal(lastModified);
      testPpaasEncryptEnvironmentFileUpload.upload().then(() => {
        log("testPpaasEncryptEnvironmentFileDownload.upload() succeeded", LogLevel.DEBUG);
        // If it's newer we should not upload it and keep the same time
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedLocal()).to.equal(lastModified);
        done();
      }).catch((error) => done(error));
    });

    it("Upload a test file force should upload unchanged files", (done: Mocha.Done) => {
      const lastModified: number = Date.now();
      testPpaasEncryptEnvironmentFileUpload.setLastModifiedLocal(lastModified);
      testPpaasEncryptEnvironmentFileUpload.upload(true).then(() => {
        log("testPpaasEncryptEnvironmentFileDownload.upload(true) succeeded", LogLevel.DEBUG);
        // If it's newer, but forced we should upload it and set the time to last modified
        expect(testPpaasEncryptEnvironmentFileUpload.getLastModifiedLocal()).to.be.greaterThan(lastModified);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("List Files in S3", () => {
    let lastModified: Date;
    beforeEach (async () => {
      try {
        await testPpaasEncryptEnvironmentFileUpload.upload(true);
        lastModified = testPpaasEncryptEnvironmentFileUpload.getLastModifiedRemote();
        log("testPpaasEncryptEnvironmentFileUpload.upload() succeeded", LogLevel.DEBUG);
      } catch (error) {
        throw error;
      }
    });

    it("testPpaasEncryptEnvironmentFileDownload should exist inS3", (done: Mocha.Done) => {
      mockListObject({ filename: ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME, folder: s3Folder, lastModified });
      testPpaasEncryptEnvironmentFileUpload.existsInS3().then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("PpaasEncryptEnvironmentFile.existsInS3 should exist inS3", (done: Mocha.Done) => {
      mockListObject({ filename: ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME, folder: s3Folder, lastModified });
      PpaasEncryptEnvironmentFile.existsInS3(testPpaasEncryptEnvironmentFileUpload.key).then((exists) => {
        expect(exists).to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("getAllFilesInS3 should return files", (done: Mocha.Done) => {
      mockListObject({ filename: ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME, folder: s3Folder, lastModified });
      mockGetObject(emptyFileContentsEncrypted);
      PpaasEncryptEnvironmentFile.getAllFilesInS3(s3Folder).then((result: PpaasEncryptEnvironmentFile[]) => {
        log(`PpaasEncryptEnvironmentFile.getAllFilesInS3("${s3Folder}") result`, LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.length, "result.length").to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote().getTime(), "getLastModifiedRemote").to.equal(lastModified.getTime());
        expect(result[0].s3Folder, "s3Folder").to.include(s3Folder);
        expect(result[0].filename, "filename").to.equal(ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME);
        expect(result[0].tags, "tags").to.not.equal(undefined);
        validateTags(result[0].tags!, allTags);
        done();
      }).catch((error) => {
        log(`PpaasEncryptEnvironmentFile.getAllFilesInS3("${s3Folder}") error`, LogLevel.WARN, error);
        done(error);
      });
    });

    it("getAllFilesInS3 partial folder should return files", (done: Mocha.Done) => {
      mockListObject({ filename: ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME, folder: s3Folder, lastModified });
      mockGetObject(emptyFileContentsEncrypted);
      PpaasEncryptEnvironmentFile.getAllFilesInS3(s3Folder.slice(0, -2)).then((result: PpaasEncryptEnvironmentFile[]) => {
        log(`PpaasEncryptEnvironmentFile.getAllFilesInS3("${s3Folder.slice(0, -2)}") result`, LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.length, "result.length").to.be.greaterThan(0);
        // getAllFilesInS3 should set the remote date so we can sort
        expect(result[0].getLastModifiedRemote().getTime(), "getLastModifiedRemote").to.equal(lastModified.getTime());
        expect(result[0].s3Folder).to.include(s3Folder.slice(0, -2));
        expect(result[0].filename).to.equal(ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME);
        expect(result[0].tags, "tags").to.not.equal(undefined);
        validateTags(result[0].tags!, allTags);
        done();
      }).catch((error) => {
        log(`PpaasEncryptEnvironmentFile.getAllFilesInS3("${s3Folder.slice(0, -2)}") error`, LogLevel.WARN, error);
        done(error);
      });
    });
  });

  describe("Get Files in S3", () => {
    let lastModified: Date;

    beforeEach (async () => {
      mockUploadObject({ filename: testPpaasEncryptEnvironmentFileUpload.filename, folder: testPpaasEncryptEnvironmentFileUpload.s3Folder });
      await testPpaasEncryptEnvironmentFileUpload.upload(true, true);
      // Reset this between tests
      testPpaasEncryptEnvironmentFileDownload.setLastModifiedRemote(new Date(0));
      // As long as we don't throw, it passes
      // Need time for eventual consistency to complete
      lastModified = new Date(); // Set the time to now
      mockListObject({ filename: testPpaasEncryptEnvironmentFileUpload.filename, folder: testPpaasEncryptEnvironmentFileUpload.s3Folder, lastModified });
    });

    it("Get File should return files", (done: Mocha.Done) => {
      mockGetObject(uploadFileContentsEncrypted, undefined, lastModified);
      testPpaasEncryptEnvironmentFileDownload.download().then(() => {
        const result: string | undefined = testPpaasEncryptEnvironmentFileDownload.getFileContents();
        log(`testPpaasEncryptEnvironmentFileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.equal(JSON.stringify(uploadFileContents));
        validateEnvironmentVariablesFile(testPpaasEncryptEnvironmentFileDownload.getEnvironmentVariablesFile(), uploadFileContents);
        expect(testPpaasEncryptEnvironmentFileDownload.tags, "tags").to.not.equal(undefined);
        validateTags(testPpaasEncryptEnvironmentFileDownload.tags!, allTags);
        done();
      }).catch((error) => done(error));
    });

    it("Get File should return changed files", (done: Mocha.Done) => {
      mockGetObject(uploadFileContentsEncrypted, undefined, lastModified);
      // Set it before the last modified so it's changed
      testPpaasEncryptEnvironmentFileDownload.setLastModifiedRemote(new Date(lastModified.getTime() - 5000));
      testPpaasEncryptEnvironmentFileDownload.download().then(() => {
        const result: string | undefined = testPpaasEncryptEnvironmentFileDownload.getFileContents();
        log(`testPpaasEncryptEnvironmentFileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.equal(JSON.stringify(uploadFileContents));
        validateEnvironmentVariablesFile(testPpaasEncryptEnvironmentFileDownload.getEnvironmentVariablesFile(), uploadFileContents);
        // The time should not be updated
        expect(testPpaasEncryptEnvironmentFileDownload.getLastModifiedRemote().getTime()).to.greaterThan(lastModified.getTime() - 5000);
        expect(testPpaasEncryptEnvironmentFileDownload.tags, "tags").to.not.equal(undefined);
        validateTags(testPpaasEncryptEnvironmentFileDownload.tags!, allTags);
        done();
      }).catch((error) => done(error));
    });

    it("Get File should not return unchanged files", (done: Mocha.Done) => {
      mockGetObjectError(304);
      // Set it to the last modified so it's unchanged
      testPpaasEncryptEnvironmentFileDownload.setLastModifiedRemote(lastModified);
      testPpaasEncryptEnvironmentFileDownload.download().then(() => {
        const result: string | undefined = testPpaasEncryptEnvironmentFileDownload.getFileContents();
        log(`testPpaasEncryptEnvironmentFileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.equal(JSON.stringify(resetFileContents));
        validateEnvironmentVariablesFile(testPpaasEncryptEnvironmentFileDownload.getEnvironmentVariablesFile(), resetFileContents);
        // The time should be updated
        expect(testPpaasEncryptEnvironmentFileDownload.getLastModifiedRemote().getTime()).to.equal(lastModified.getTime());
        expect(testPpaasEncryptEnvironmentFileDownload.tags, "tags").to.not.equal(undefined);
        validateTags(testPpaasEncryptEnvironmentFileDownload.tags!, testFileTags);
        done();
      }).catch((error) => done(error));

    });

    it("Get File force should return unchanged files", (done: Mocha.Done) => {
    mockGetObject(uploadFileContentsEncrypted, undefined, lastModified);
      // Set it to the last modified so it's unchanged. If s3 time is ahead of us, set it to now
      const timeBefore: Date = (lastModified.getTime() > Date.now()) ? new Date() : lastModified;
      testPpaasEncryptEnvironmentFileDownload.setLastModifiedRemote(lastModified);
      // Then force download it
      testPpaasEncryptEnvironmentFileDownload.download(true).then(() => {
        const result: string | undefined = testPpaasEncryptEnvironmentFileDownload.getFileContents();
        log(`testPpaasEncryptEnvironmentFileDownload.download() result = ${result}`, LogLevel.DEBUG);
        expect(result).to.equal(JSON.stringify(uploadFileContents));
        validateEnvironmentVariablesFile(testPpaasEncryptEnvironmentFileDownload.getEnvironmentVariablesFile(), uploadFileContents);
        // The time should not be updated
        expect(testPpaasEncryptEnvironmentFileDownload.getLastModifiedRemote().getTime()).to.greaterThan(timeBefore.getTime() - 1);
        expect(testPpaasEncryptEnvironmentFileDownload.tags, "tags").to.not.equal(undefined);
        validateTags(testPpaasEncryptEnvironmentFileDownload.tags!, allTags);
        done();
      }).catch((error) => done(error));
    });
  });
});
