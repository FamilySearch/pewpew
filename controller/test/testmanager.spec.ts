/* eslint-disable max-classes-per-file */
/* eslint-disable no-prototype-builtins */
import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  StoredTestData
} from "../types";
import {
  CacheLocation,
  CachedTestData,
  MAX_SAVED_TESTS_RECENT,
  TestManager,
  ValidateYamlfileResult,
  convertPPaaSFileToFile,
  getLatestDateTime,
  getRecentTests,
  getRequestedTests,
  getRunningTests,
  getValidateLegacyOnly,
  removeOldest,
  validateYamlfile
} from "../pages/api/util/testmanager";
import {
  EnvironmentVariables,
  LogLevel,
  MessageType,
  PpaasS3File,
  PpaasTestId,
  PpaasTestStatus,
  TestStatus,
  TestStatusMessage,
  log,
  logger
} from "@fs/ppaas-common";
import type { File, FileJSON } from "formidable";
import { Test as MochaTest } from "mocha";
import { PpaasEncryptS3File } from "../pages/api/util/ppaasencrypts3file";
import { TestSchedulerIntegration } from "./testscheduler.spec";
import { expect } from "chai";
import { latestPewPewVersion } from "../pages/api/util/clientutil";
import path from "path";

logger.config.LogFileName = "ppaas-controller";

const localDirectory: string = path.resolve(process.env.UNIT_TEST_FOLDER || "test");
const BASIC_YAML_FILE: string = "basic.yaml";
const BASIC_YAML_WITH_ENV = "basicwithenv.yaml";
const BASIC_YAML_WITH_FILES = "basicwithfiles.yaml";
const SCRIPTING_YAML_FILE: string = "scripting.yaml";
const SCRIPTING_YAML_WITH_ENV = "scriptingwithenv.yaml";
const SCRIPTING_YAML_WITH_FILES = "scriptingwithfiles.yaml";
const BASIC_TXT_FILE: string = "text.txt";
const BASIC_TXT_FILE2: string = "text2.txt";
const environmentVariables: EnvironmentVariables = {
  SERVICE_URL_AGENT: "127.0.0.1",
  TEST1: "true",
  TEST2: "true",
  NOT_NEEDED: "true",
  ALSO_NOT_NEEDED: "false"
};

function createStoredTestData (name?: string, counter?: number): StoredTestData {
  const ppaasTestId = PpaasTestId.makeTestId("unittest" + (name || "") + (counter !== undefined ? counter : ""));
  const { testId, s3Folder, date } = ppaasTestId;
  const newData: StoredTestData = {
    testId,
    s3Folder,
    status: TestStatus.Unknown,
    startTime: date.getTime()
  };
  return newData;
}

class TestManagerIntegration extends TestManager {
  // Access so we can clear, add, remove, and validate for testing
  public static readonly runningTestsInt: Map<string, StoredTestData> = getRunningTests();
  public static readonly recentTestsInt: Map<string, StoredTestData> = getRecentTests();
  public static readonly requestedTestsInt: Map<string, StoredTestData> = getRequestedTests();
  public static readonly searchedTestsInt: Map<string, StoredTestData> = super.searchedTests;
  public static readonly lastNewTestMapInt: Map<string, Date> = super.lastNewTestMap;

  public static clearAllMaps (): void {
    getRunningTests().clear();
    getRecentTests().clear();
    getRequestedTests().clear();
    this.searchedTests.clear();
    this.lastNewTestMap.clear();
  }

  public static removeFromList (testId: string, cacheLocation: CacheLocation): void {
    return super.removeFromList(testId, cacheLocation);
  }

  public static getFromList (testId: string, updateFromS3: boolean): Promise<CachedTestData | undefined> {
    return super.getFromList(testId, updateFromS3);
  }

  public static addToStoredList (newData: StoredTestData, cacheLocation: CacheLocation): Promise<StoredTestData | undefined> {
    return super.addToStoredList(newData, cacheLocation);
  }

  protected static addToStoredListBypass (newData: StoredTestData, cacheLocation: CacheLocation) {
    const { testId } = newData;
    switch (cacheLocation) {
      case CacheLocation.Running:
        getRunningTests().set(testId, newData);
        break;
      case CacheLocation.Recent:
        getRecentTests().set(testId, newData);
        break;
      case CacheLocation.Requested:
        getRequestedTests().set(testId, newData);
        break;
      case CacheLocation.Searched:
        this.searchedTests.set(testId, newData);
        break;
    }
  }

  public static addCountToList (count: number, cacheLocation: CacheLocation): void {
    for (let i: number = 0; i < count; i++) {
      this.addToStoredListBypass(createStoredTestData(cacheLocation.toString(), i), cacheLocation);
    }
  }
}

class PpaasTestStatusIntegration extends PpaasTestStatus {
  /** Returns an object, false if not found, or true if unchanged  */
  public static getStatusResult: PpaasTestStatus | boolean = false;
  protected static writeStatusOriginal: (() => Promise<string>) | undefined;
  protected static getStatusInternalOriginal: (ppaasTestId: PpaasTestId, lastModified?: Date) => Promise<PpaasTestStatus | boolean>;

  // MOCK: Static to mock the base class to not access s3
  public static mockFunctions () {
    if (PpaasTestStatusIntegration.writeStatusOriginal === undefined) {
      PpaasTestStatusIntegration.writeStatusOriginal = PpaasTestStatus.prototype.writeStatus;
    }
    // eslint-disable-next-line require-await
    PpaasTestStatus.prototype.writeStatus = async () => {
      log("PpaasTestStatus.writeStatus called", LogLevel.DEBUG);
      // eslint-disable-next-line no-console
      console.log("PpaasTestStatus.writeStatus called");
      return "";
    };

    if (PpaasTestStatusIntegration.getStatusInternalOriginal === undefined) {
      PpaasTestStatusIntegration.getStatusInternalOriginal = PpaasTestStatus.getStatusInternal;
    }
    // eslint-disable-next-line require-await
    PpaasTestStatus.getStatusInternal = async (ppaasTestId: PpaasTestId, lastModified?: Date): Promise<PpaasTestStatus | boolean> => {
      log("PpaasTestStatus.getStatusInternal called", LogLevel.DEBUG, { ppaasTestId, lastModified, getStatusResult: this.getStatusResult });
      // eslint-disable-next-line no-console
      console.log("PpaasTestStatus.getStatusInternal called");
      return this.getStatusResult;
    };
  }

  // MOCK: Fix the Mock functions in case we need to run integration too
  public static restoreFunctions () {
    if (PpaasTestStatusIntegration.writeStatusOriginal !== undefined) {
      PpaasTestStatus.prototype.writeStatus = PpaasTestStatusIntegration.writeStatusOriginal;
    }

    if (PpaasTestStatusIntegration.getStatusInternalOriginal !== undefined) {
      PpaasTestStatus.getStatusInternal = PpaasTestStatusIntegration.getStatusInternalOriginal;
    }
  }
}

class PpaasEncryptS3FileIntegration extends PpaasEncryptS3File {
  /** Returns an object, false if not found, or true if unchanged  */
  public static existInS3Result: boolean = false;
  public static downloadResult: PpaasEncryptS3File | undefined;
  protected static uploadOriginal: ((force?: boolean, retry?: boolean) => Promise<void>) | undefined;
  protected static downloadOriginal: (force?: boolean) => Promise<PpaasEncryptS3File>;
  protected static existsInS3StaticOriginal: (s3FilePath: string) => Promise<boolean>;
  protected static existsInS3InstanceOriginal: () => Promise<boolean>;

  // MOCK: Static to mock the base class to not access s3
  public static mockFunctions () {
    if (PpaasEncryptS3FileIntegration.uploadOriginal === undefined) {
      PpaasEncryptS3FileIntegration.uploadOriginal = PpaasEncryptS3File.prototype.upload;
    }
    // eslint-disable-next-line require-await
    PpaasEncryptS3File.prototype.upload = async (_force?: boolean, _retry?: boolean) => {
      log("PpaasEncryptS3File.upload called", LogLevel.DEBUG);
      // eslint-disable-next-line no-console
      console.log("PpaasEncryptS3File.upload called");
    };

    if (PpaasEncryptS3FileIntegration.downloadOriginal === undefined) {
      PpaasEncryptS3FileIntegration.downloadOriginal = PpaasEncryptS3File.prototype.download;
    }
    // eslint-disable-next-line require-await
    PpaasEncryptS3File.prototype.download = async (force?: boolean): Promise<PpaasEncryptS3File> => {
      log("PpaasEncryptS3File.download called", LogLevel.DEBUG, { force, downloadResult: this.downloadResult?.sanitizedCopy() });
      // eslint-disable-next-line no-console
      console.log("PpaasEncryptS3File.download called");
      if (this.downloadResult === undefined) {
        throw new Error("PpaasEncryptS3FileIntegration.downloadResult must be initialized first");
      }
      return this.downloadResult;
    };

    if (PpaasEncryptS3FileIntegration.existsInS3StaticOriginal === undefined) {
      PpaasEncryptS3FileIntegration.existsInS3StaticOriginal = PpaasEncryptS3File.existsInS3;
    }
    // eslint-disable-next-line require-await
    PpaasEncryptS3File.existsInS3 = async (s3FilePath: string): Promise<boolean> => {
      log("PpaasEncryptS3File.existsInS3 called", LogLevel.DEBUG, { s3FilePath, existInS3Result: this.existInS3Result });
      // eslint-disable-next-line no-console
      console.log("PpaasEncryptS3File.existsInS3 called");
      return this.existInS3Result;
    };

    if (PpaasEncryptS3FileIntegration.existsInS3InstanceOriginal === undefined) {
      PpaasEncryptS3FileIntegration.existsInS3InstanceOriginal = PpaasEncryptS3File.prototype.existsInS3;
    }
    // eslint-disable-next-line require-await
    PpaasEncryptS3File.prototype.existsInS3 = async (): Promise<boolean> => {
      log("PpaasEncryptS3File.existsInS3 called", LogLevel.DEBUG, { existInS3Result: this.existInS3Result });
      // eslint-disable-next-line no-console
      console.log("PpaasEncryptS3File.existsInS3 called");
      return this.existInS3Result;
    };
  }

  // MOCK: Fix the Mock functions in case we need to run integration too
  public static restoreFunctions () {
    if (PpaasEncryptS3FileIntegration.uploadOriginal !== undefined) {
      PpaasEncryptS3File.prototype.upload = PpaasEncryptS3FileIntegration.uploadOriginal;
    }

    if (PpaasEncryptS3FileIntegration.downloadOriginal !== undefined) {
      PpaasEncryptS3File.prototype.download = PpaasEncryptS3FileIntegration.downloadOriginal;
    }

    if (PpaasEncryptS3FileIntegration.existsInS3StaticOriginal !== undefined) {
      PpaasEncryptS3File.existsInS3 = PpaasEncryptS3FileIntegration.existsInS3StaticOriginal;
    }

    if (PpaasEncryptS3FileIntegration.existsInS3InstanceOriginal !== undefined) {
      PpaasEncryptS3File.prototype.existsInS3 = PpaasEncryptS3FileIntegration.existsInS3InstanceOriginal;
    }
  }
}

// TODO: Mock PpaasS3File.getAllFilesInS3()
// TODO: Mock PpaasTestMessage.prototype.send()

const authUser1: AuthPermissions = {
  authPermission: AuthPermission.User,
  token: "user1token",
  userId: "user1"
};
const authAdmin1: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1token",
  userId: "admin1"
};

describe("TestManager", () => {
  const s3Folder = "unittest";

  before(() => {
    PpaasTestStatusIntegration.mockFunctions();
    PpaasEncryptS3FileIntegration.mockFunctions();
    TestSchedulerIntegration.mockFunctions();
  });

  after(() => {
    // Fix the Mock functions in case we need to run integration too
    PpaasTestStatusIntegration.restoreFunctions();
    PpaasEncryptS3FileIntegration.restoreFunctions();
    TestSchedulerIntegration.restoreFunctions();
  });

  it("should convert a yaml file", (done: Mocha.Done) => {
    const ppaasFile: PpaasS3File = new PpaasS3File({ filename: BASIC_YAML_FILE, s3Folder, localDirectory });
    convertPPaaSFileToFile(ppaasFile).then((result: File) => {
      expect(result, "result").to.not.equal(undefined);
      expect(result.size, "result.size").to.not.equal(undefined);
      expect(result.size, "result.size").to.be.greaterThan(0);
      expect(result.originalFilename, "result.originalFilename").to.equal(BASIC_YAML_FILE);
      expect(result.filepath, "result.filepath").to.equal(ppaasFile.localFilePath);
      const json: FileJSON = result.toJSON();
      expect(json, "json").to.not.equal(undefined);
      expect(json.size, "json.size").to.equal(result.size);
      expect(json.mimetype, "json.mimetype").to.equal(result.mimetype);
      expect(json.mtime, "json.mtime").to.equal(result.mtime);
      expect(json.originalFilename, "json.originalFilename").to.equal(result.originalFilename);
      expect(json.filepath, "json.filepath").to.equal(result.filepath);
      expect(result.toString(), "result.toString()").to.equal(JSON.stringify(json));
      done();
    }).catch((error) => done(error));
  });

  it("should convert a non-yaml file", (done: Mocha.Done) => {
    const ppaasFile: PpaasS3File = new PpaasS3File({ filename: BASIC_TXT_FILE, s3Folder, localDirectory });
    convertPPaaSFileToFile(ppaasFile).then((result: File) => {
      expect(result, "result").to.not.equal(undefined);
      expect(result.size, "result.size").to.not.equal(undefined);
      expect(result.size, "result.size").to.be.greaterThan(0);
      expect(result.originalFilename, "result.originalFilename").to.equal(BASIC_TXT_FILE);
      expect(result.filepath, "result.filepath").to.equal(ppaasFile.localFilePath);
      const json: FileJSON = result.toJSON();
      expect(json, "json").to.not.equal(undefined);
      expect(json.size, "json.size").to.equal(result.size);
      expect(json.mimetype, "json.mimetype").to.equal(result.mimetype);
      expect(json.mtime, "json.mtime").to.equal(result.mtime);
      expect(json.originalFilename, "json.originalFilename").to.equal(result.originalFilename);
      expect(json.filepath, "json.filepath").to.equal(result.filepath);
      expect(result.toString(), "result.toString()").to.equal(JSON.stringify(json));
      done();
    }).catch((error) => done(error));
  });

  const validateLegacyOnlySuite: Mocha.Suite = describe("getValidateLegacyOnly", () => {
    before (() => {
      const validateLegacyOnlyArray: [string, boolean][] = [
        ["0.4.0", true],
        ["0.5.0", true],
        ["0.5.12", true],
        ["0.5.13-preview1", true],
        ["0.5.14-alpha", true],
        ["0.5.999", true],
        ["0.6.0-preview", false],
        ["0.6.0-preview1", false],
        ["0.6.0-scripting", false],
        ["0.6.0-scripting2", false],
        ["0.6.0", false],
        ["0.6.1", false],
        ["0.7.0", false],
        ["1.0.0", false]
      ];
      for (const [version, expected] of validateLegacyOnlyArray) {
        validateLegacyOnlySuite.addTest(new MochaTest(version + " should return " + expected, (done: Mocha.Done) => {
          try {
            expect(getValidateLegacyOnly(version)).to.equal(expected);
            done();
          } catch (error) {
            done(error);
          }
        }));
      }
    });

    it("should return undefined for undefined", (done: Mocha.Done) => {
      try {
        expect(getValidateLegacyOnly(undefined)).to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should return undefined for empty string", (done: Mocha.Done) => {
      try {
        expect(getValidateLegacyOnly("")).to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("should return undefined for latest", (done: Mocha.Done) => {
      try {
        expect(getValidateLegacyOnly(latestPewPewVersion)).to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("validateYamlfile", () => {
    let basicYamlFile: File;
    let basicYamlFileWithEnv: File;
    let basicYamlFileWithFiles: File;
    let scriptingYamlFile: File;
    let scriptingYamlFileWithEnv: File;
    let scriptingYamlFileWithFiles: File;

    before(async () => {
      try {
        basicYamlFile = await convertPPaaSFileToFile(new PpaasS3File({ filename: BASIC_YAML_FILE, s3Folder, localDirectory }));
        basicYamlFileWithEnv = await convertPPaaSFileToFile(new PpaasS3File({ filename: BASIC_YAML_WITH_ENV, s3Folder, localDirectory }));
        basicYamlFileWithFiles = await convertPPaaSFileToFile(new PpaasS3File({ filename: BASIC_YAML_WITH_FILES, s3Folder, localDirectory }));
        scriptingYamlFile = await convertPPaaSFileToFile(new PpaasS3File({ filename: SCRIPTING_YAML_FILE, s3Folder, localDirectory }));
        scriptingYamlFileWithEnv = await convertPPaaSFileToFile(new PpaasS3File({ filename: SCRIPTING_YAML_WITH_ENV, s3Folder, localDirectory }));
        scriptingYamlFileWithFiles = await convertPPaaSFileToFile(new PpaasS3File({ filename: SCRIPTING_YAML_WITH_FILES, s3Folder, localDirectory }));
      } catch (error) {
        log("Could not run the validateYamlfile before()", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("should validate basic parsed as any", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFile, {}, [], false, authUser1, undefined)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should validate basic parsed as any", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
        done();
      }).catch((error) => done(error));
    });

    it("should validate scripting parsed as any", (done: Mocha.Done) => {
      validateYamlfile(scriptingYamlFile, {}, [], false, authUser1, undefined)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should validate scripting parsed as any", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
        done();
      }).catch((error) => done(error));
    });

    describe("legacy", () => {
    it("should validate basic", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFile, {}, [], false, authUser1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should validate basic", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
        done();
      }).catch((error) => done(error));
    });

    it("should fail basic parsed as scripting", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFile, {}, [], false, authUser1, false)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should fail basic parsed as scripting", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(true);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
        const errorResponse: ErrorResponse = response as ErrorResponse;
        expect(errorResponse.status, "status").to.equal(400);
        expect(errorResponse.json, "json").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.include("failed to parse");
        expect(errorResponse.json.error).to.not.equal(undefined);
        expect(errorResponse.json.error).to.include("YamlParse");
        done();
      }).catch((error) => done(error));
    });

    it("should fail basic without env", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFileWithEnv, {}, [], false, authUser1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should fail basic without env", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(true);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
        const errorResponse: ErrorResponse = response as ErrorResponse;
        expect(errorResponse.status, "status").to.equal(400);
        expect(errorResponse.json, "json").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.include("failed to parse");
        expect(errorResponse.json.error).to.not.equal(undefined);
        expect(errorResponse.json.error).to.include("SERVICE_URL_AGENT");
        done();
      }).catch((error) => done(error));
    });

    it("should validate basic with env", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFileWithEnv, environmentVariables, [], false, authUser1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should validate basic with env", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
        done();
      }).catch((error) => done(error));
    });

    it("should fail basic without files", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFileWithFiles, {}, [BASIC_TXT_FILE], false, authUser1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        log("should fail basic without files", LogLevel.DEBUG, response);
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(true);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
        const errorResponse: ErrorResponse = response as ErrorResponse;
        expect(errorResponse.status, "status").to.equal(400);
        expect(errorResponse.json, "json").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.include(BASIC_TXT_FILE2);
        done();
      }).catch((error) => done(error));
    });

    it("should validate basic with files", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFileWithFiles, {}, [BASIC_TXT_FILE, BASIC_TXT_FILE2], false, authUser1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.not.equal(undefined);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.not.equal(undefined);
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
        done();
      }).catch((error) => done(error));
    });

    it("user should fail bypass", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFile, {}, [], true, authUser1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(true);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
        const errorResponse: ErrorResponse = response as ErrorResponse;
        expect(errorResponse.status, "status").to.equal(403);
        expect(errorResponse.json, "json").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
        expect(errorResponse.json.message, "json.message").to.include("bypass the config parser");
        done();
      }).catch((error) => done(error));
    });

    it("admin should pass bypass", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFile, {}, [], true, authAdmin1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(undefined);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("bypassParser shouldn't need variables", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFileWithEnv, {}, [], true, authAdmin1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(undefined);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("bypassParser shouldn't need files", (done: Mocha.Done) => {
      validateYamlfile(basicYamlFileWithFiles, {}, [], true, authAdmin1, true)
      .then((response: ErrorResponse | ValidateYamlfileResult) => {
        expect(response, "response").to.not.equal(undefined);
        expect(response.hasOwnProperty("json"), "has json").to.equal(false);
        expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
        const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
        expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(undefined);
        expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });
    });

    describe("scripting", () => {
      it("should validate scripting", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFile, {}, [], false, authUser1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          log("should validate scripting", LogLevel.DEBUG, response);
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(false);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
          const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
          done();
        }).catch((error) => done(error));
      });

      it("should fail scripting parsed as legacy", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFile, {}, [], false, authUser1, true)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          log("should fail scripting parsed as legacy", LogLevel.DEBUG, response);
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(true);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
          const errorResponse: ErrorResponse = response as ErrorResponse;
          expect(errorResponse.status, "status").to.equal(400);
          expect(errorResponse.json, "json").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.include("failed to parse");
          expect(errorResponse.json.error).to.not.equal(undefined);
          expect(errorResponse.json.error).to.include("UnrecognizedKey");
          done();
        }).catch((error) => done(error));
      });

      it("should fail scripting without env", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFileWithEnv, {}, [], false, authUser1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          log("should fail scripting without env", LogLevel.DEBUG, response);
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(true);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
          const errorResponse: ErrorResponse = response as ErrorResponse;
          expect(errorResponse.status, "status").to.equal(400);
          expect(errorResponse.json, "json").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.include("failed to parse");
          expect(errorResponse.json.error).to.not.equal(undefined);
          expect(errorResponse.json.error).to.include("SERVICE_URL_AGENT");
          done();
        }).catch((error) => done(error));
      });

      it("should validate scripting with env", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFileWithEnv, environmentVariables, [], false, authUser1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          log("should validate scripting with env", LogLevel.DEBUG, response);
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(false);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
          const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
          done();
        }).catch((error) => done(error));
      });

      it("should fail scripting without files", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFileWithFiles, {}, [BASIC_TXT_FILE], false, authUser1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          log("should fail scripting without files", LogLevel.DEBUG, response);
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(true);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
          const errorResponse: ErrorResponse = response as ErrorResponse;
          expect(errorResponse.status, "status").to.equal(400);
          expect(errorResponse.json, "json").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.include(BASIC_TXT_FILE2);
          done();
        }).catch((error) => done(error));
      });

      it("should validate scripting with files", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFileWithFiles, {}, [BASIC_TXT_FILE, BASIC_TXT_FILE2], false, authUser1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(false);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
          const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.not.equal(undefined);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.not.equal(undefined);
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(60000);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(2);
          done();
        }).catch((error) => done(error));
      });

      it("user should fail bypass", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFile, {}, [], true, authUser1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(true);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(false);
          const errorResponse: ErrorResponse = response as ErrorResponse;
          expect(errorResponse.status, "status").to.equal(403);
          expect(errorResponse.json, "json").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.not.equal(undefined);
          expect(errorResponse.json.message, "json.message").to.include("bypass the config parser");
          done();
        }).catch((error) => done(error));
      });

      it("admin should pass bypass", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFile, {}, [], true, authAdmin1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(false);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
          const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(undefined);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(undefined);
          done();
        }).catch((error) => done(error));
      });

      it("bypassParser shouldn't need variables", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFileWithEnv, {}, [], true, authAdmin1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(false);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
          const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(undefined);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(undefined);
          done();
        }).catch((error) => done(error));
      });

      it("bypassParser shouldn't need files", (done: Mocha.Done) => {
        validateYamlfile(scriptingYamlFileWithFiles, {}, [], true, authAdmin1, false)
        .then((response: ErrorResponse | ValidateYamlfileResult) => {
          expect(response, "response").to.not.equal(undefined);
          expect(response.hasOwnProperty("json"), "has json").to.equal(false);
          expect(response.hasOwnProperty("testRunTimeMn"), "has testRunTimeMn").to.equal(true);
          const yamlResult: ValidateYamlfileResult = response as ValidateYamlfileResult;
          expect(yamlResult.bucketSizeMs, "bucketSizeMs").to.equal(undefined);
          expect(yamlResult.testRunTimeMn, "testRunTimeMn").to.equal(undefined);
          done();
        }).catch((error) => done(error));
      });
    });
  });

  describe("getAllTest", () => {
    beforeEach(() => {
      TestManagerIntegration.clearAllMaps();
    });

    // Should get empty
    it("Should get empty lists", (done: Mocha.Done) => {
      try {
        const allTests = TestManagerIntegration.getAllTest();
        expect(allTests, "allTests").to.not.equal(undefined);
        expect(allTests.status, "status").to.equal(200);
        expect(allTests.json, "json").to.not.equal(undefined);
        expect(allTests.json.runningTests, "runningTests").to.not.equal(undefined);
        expect(allTests.json.recentTests, "recentTests").to.not.equal(undefined);
        expect(allTests.json.requestedTests, "requestedTests").to.not.equal(undefined);
        expect(allTests.json.runningTests.length, "runningTests.length").to.equal(0);
        expect(allTests.json.recentTests.length, "recentTests.length").to.equal(0);
        expect(allTests.json.requestedTests.length, "requestedTests.length").to.equal(0);
        done();
      } catch (error) {
        done(error);
      }
    });

    // Should get single
    it("Should get single lists", (done: Mocha.Done) => {
      try {
        TestManagerIntegration.addCountToList(1, CacheLocation.Running);
        TestManagerIntegration.addCountToList(1, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(1, CacheLocation.Requested);
        const allTests = TestManagerIntegration.getAllTest();
        expect(allTests, "allTests").to.not.equal(undefined);
        expect(allTests.status, "status").to.equal(200);
        expect(allTests.json, "json").to.not.equal(undefined);
        expect(allTests.json.runningTests, "runningTests").to.not.equal(undefined);
        expect(allTests.json.recentTests, "recentTests").to.not.equal(undefined);
        expect(allTests.json.requestedTests, "requestedTests").to.not.equal(undefined);
        expect(allTests.json.runningTests.length, "runningTests.length").to.equal(1);
        expect(allTests.json.recentTests.length, "recentTests.length").to.equal(1);
        expect(allTests.json.requestedTests.length, "requestedTests.length").to.equal(1);
        done();
      } catch (error) {
        done(error);
      }
    });

    // Should get full
    it("Should get full lists", (done: Mocha.Done) => {
      try {
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Running);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Requested);
        const allTests = TestManagerIntegration.getAllTest();
        expect(allTests, "allTests").to.not.equal(undefined);
        expect(allTests.status, "status").to.equal(200);
        expect(allTests.json, "json").to.not.equal(undefined);
        expect(allTests.json.runningTests, "runningTests").to.not.equal(undefined);
        expect(allTests.json.recentTests, "recentTests").to.not.equal(undefined);
        expect(allTests.json.requestedTests, "requestedTests").to.not.equal(undefined);
        expect(allTests.json.runningTests.length, "runningTests.length").to.equal(MAX_SAVED_TESTS_RECENT);
        expect(allTests.json.recentTests.length, "recentTests.length").to.equal(MAX_SAVED_TESTS_RECENT);
        expect(allTests.json.requestedTests.length, "requestedTests.length").to.equal(MAX_SAVED_TESTS_RECENT);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("getFromList", () => {
    const beforeStatus: TestStatus = TestStatus.Unknown;
    let storedTestData: StoredTestData;
    let testId: string;

    beforeEach(() => {
      TestManagerIntegration.clearAllMaps();
      PpaasTestStatusIntegration.getStatusResult = false;
      storedTestData = createStoredTestData("getFromList");
      storedTestData.ppaasTestStatus = undefined;
      storedTestData.status = beforeStatus;
      testId = storedTestData.testId;
    });

    describe("updateFromS3 false", () => {
      it("should find none on empty", (done: Mocha.Done) => {
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found).to.equal(undefined);
          done();
        }).catch((error) => done(error));
      });

      it("should find none on not there", (done: Mocha.Done) => {
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Running);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Requested);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Searched);
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found).to.equal(undefined);
          done();
        }).catch((error) => done(error));
      });

      it("should find from Running", (done: Mocha.Done) => {
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Running);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Requested);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Searched);
        TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Running);
          expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("should find from Recent", (done: Mocha.Done) => {
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Running);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Requested);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Searched);
        TestManagerIntegration.recentTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Recent);
          expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("should find from Requested", (done: Mocha.Done) => {
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Running);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Requested);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Searched);
        TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Requested);
          expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("should find from Searched", (done: Mocha.Done) => {
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Running);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Recent);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Requested);
        TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Searched);
        TestManagerIntegration.searchedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          // Searched will move to running or requested on updates, but not otherwise
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Searched);
          expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("Should find and still be modifiable", (done: Mocha.Done) => {
        const expectedStatus: TestStatus = TestStatus.Finished;
        const expectedStart = Date.now() - 600000;
        const expectedEnd = Date.now();
        TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, false).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Running);
          expect(TestManagerIntegration.runningTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
          found!.testData.status = expectedStatus;
          found!.testData.startTime = expectedStart;
          found!.testData.endTime = expectedEnd;
          const found2: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
          expect(found2, "found").to.not.equal(undefined);
          expect(found2?.status, "status").to.equal(expectedStatus);
          expect(found2?.startTime, "startTime").to.equal(expectedStart);
          expect(found2?.endTime, "endTime").to.equal(expectedEnd);
          done();
        }).catch((error) => done(error));
      });
    });

    describe("updateFromS3 true", () => {
      let ppaasTestId: PpaasTestId;
      let endTime: number;
      const resultsFilename: string[] = ["unittest-results"];
      const s3Status: TestStatus = TestStatus.Scheduled;
      let oldPpaasTestStatus: PpaasTestStatus;
      let newPpaasTestStatus: PpaasTestStatus;

      beforeEach(() => {
        ppaasTestId = PpaasTestId.getFromTestId(testId);
        endTime = storedTestData.startTime + (60 * 60 * 1000);
        oldPpaasTestStatus = new PpaasTestStatus(ppaasTestId, {
          ...storedTestData,
          status: s3Status,
          resultsFilename,
          endTime
        });
        newPpaasTestStatus = new PpaasTestStatus(ppaasTestId, {
          ...storedTestData,
          status: TestStatus.Finished,
          resultsFilename,
          endTime
        });
      });

      it("Should not find status if missing in S3", (done: Mocha.Done) => {
        PpaasTestStatusIntegration.getStatusResult = false;
        TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Requested);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.equal(undefined);
          expect(found?.testData.status, "status").to.equal(beforeStatus);
          expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("Should add status if there in S3", (done: Mocha.Done) => {
        PpaasTestStatusIntegration.getStatusResult = oldPpaasTestStatus;
        TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Requested);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.status, "status").to.equal(s3Status);
          expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("Should not update if not changed in S3", (done: Mocha.Done) => {
        PpaasTestStatusIntegration.getStatusResult = true;
        storedTestData.ppaasTestStatus = oldPpaasTestStatus;
        storedTestData.status = oldPpaasTestStatus.status = s3Status;
        TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
        log("Should not update if not changed in S3", LogLevel.INFO, { storedTestData, newPpaasTestStatus });
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          log("Should not update if not changed in S3 found", LogLevel.INFO, { found });
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Requested);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(s3Status);
          expect(found?.testData.status, "status").to.equal(s3Status);
          expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("Should update if changed in S3", (done: Mocha.Done) => {
        const expectedStatus: TestStatus = TestStatus.Finished;
        PpaasTestStatusIntegration.getStatusResult = newPpaasTestStatus;
        PpaasTestStatusIntegration.getStatusResult.status = expectedStatus;
        storedTestData.ppaasTestStatus = oldPpaasTestStatus;
        TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
        log("Should update if changed in S3", LogLevel.INFO, { storedTestData, newPpaasTestStatus });
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          log("Should update if changed in S3 found", LogLevel.INFO, { found });
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Requested);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(expectedStatus);
          expect(found?.testData.status, "status").to.equal(expectedStatus);
          expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("Should move to running from requested if Created", (done: Mocha.Done) => {
        const expectedStatus: TestStatus = TestStatus.Created; // One created, next running
        PpaasTestStatusIntegration.getStatusResult = newPpaasTestStatus;
        PpaasTestStatusIntegration.getStatusResult.status = expectedStatus;
        storedTestData.ppaasTestStatus = oldPpaasTestStatus;
        TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Running);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(expectedStatus);
          expect(found?.testData.status, "status").to.equal(expectedStatus);
          expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(false);
          expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("Should move to running from requested if Running", (done: Mocha.Done) => {
        const expectedStatus: TestStatus = TestStatus.Running;
        PpaasTestStatusIntegration.getStatusResult = newPpaasTestStatus;
        PpaasTestStatusIntegration.getStatusResult.status = expectedStatus;
        storedTestData.ppaasTestStatus = oldPpaasTestStatus;
        TestManagerIntegration.searchedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Running);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(expectedStatus);
          expect(found?.testData.status, "status").to.equal(expectedStatus);
          expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(false);
          expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      // Should move to recent from running if not running
      it("Should move to recent from running if not running", (done: Mocha.Done) => {
        const expectedStatus: TestStatus = TestStatus.Finished;
        PpaasTestStatusIntegration.getStatusResult = newPpaasTestStatus;
        PpaasTestStatusIntegration.getStatusResult.status = expectedStatus;
        storedTestData.ppaasTestStatus = oldPpaasTestStatus;
        TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Recent);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(expectedStatus);
          expect(found?.testData.status, "status").to.equal(expectedStatus);
          expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(false);
          expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });

      it("should not move from searced if changed, but not running", (done: Mocha.Done) => {
        const expectedStatus: TestStatus = TestStatus.Finished;
        PpaasTestStatusIntegration.getStatusResult = newPpaasTestStatus;
        PpaasTestStatusIntegration.getStatusResult.status = expectedStatus;
        storedTestData.ppaasTestStatus = oldPpaasTestStatus;
        storedTestData.status = oldPpaasTestStatus.status;
        TestManagerIntegration.searchedTestsInt.set(testId, storedTestData);
        TestManagerIntegration.getFromList(testId, true).then((found: CachedTestData | undefined) => {
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          // Searched will move to running or requested on updates, but not otherwise
          expect(found, "found").to.not.equal(undefined);
          expect(found?.testData.testId, "testId").to.equal(testId);
          expect(found?.cacheLocation, "cacheLocation").to.equal(CacheLocation.Searched);
          expect(found?.testData.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
          expect(found?.testData.ppaasTestStatus?.endTime, "endTime").to.equal(endTime);
          expect(found?.testData.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(expectedStatus);
          expect(found?.testData.status, "status").to.equal(expectedStatus);
          expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(true);
          done();
        }).catch((error) => done(error));
      });
    });
  });

  describe("addToStoredList", () => {
    const beforeStatus: TestStatus = TestStatus.Unknown;
    let storedTestData: StoredTestData;
    let testId: string;
    let beforeStartTime: number;

    beforeEach(() => {
      TestManagerIntegration.clearAllMaps();
      PpaasTestStatusIntegration.getStatusResult = false;
      storedTestData = createStoredTestData("addToStoredList");
      storedTestData.ppaasTestStatus = undefined;
      storedTestData.status = beforeStatus;
      testId = storedTestData.testId;
      beforeStartTime = storedTestData.startTime;
    });

    it("Should add to running if not on list", (done: Mocha.Done) => {
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Running).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        done();
      }).catch((error) => done(error));
    });

    it("Should add to recent if not on list", (done: Mocha.Done) => {
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Recent).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
        done();
      }).catch((error) => done(error));
    });

    it("Should add to requested if not on list", (done: Mocha.Done) => {
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Requested).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
        done();
      }).catch((error) => done(error));
    });

    it("Should add to searched if not on list", (done: Mocha.Done) => {
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Searched).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(true);
        done();
      }).catch((error) => done(error));
    });

    it("Should overwrite running if on list", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      const expectedStatus: TestStatus = copyTestData.status = TestStatus.Finished;
      const expectedStart = copyTestData.startTime = Date.now() - 600000;
      const expectedEnd = copyTestData.endTime = Date.now();
      TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Running).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.startTime, "startTime").to.equal(expectedStart);
        expect(found?.endTime, "endTime").to.equal(expectedEnd);
        done();
      }).catch((error) => done(error));
    });

    it("Should not overwrite searched if on list", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      copyTestData.status = TestStatus.Finished;
      copyTestData.startTime = Date.now() - 600000;
      copyTestData.endTime = Date.now();
      TestManagerIntegration.searchedTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Searched).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.searchedTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(beforeStatus);
        expect(found?.startTime, "startTime").to.equal(beforeStartTime);
        expect(found?.endTime, "endTime").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    // add to different list should move
    it("Should move to running from requested", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      const expectedStatus: TestStatus = copyTestData.status = TestStatus.Running;
      const expectedStart = copyTestData.startTime = Date.now() - 600000;
      const expectedEnd = copyTestData.endTime = Date.now();
      TestManagerIntegration.requestedTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Running).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(false);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.startTime, "startTime").to.equal(expectedStart);
        expect(found?.endTime, "endTime").to.equal(expectedEnd);
        done();
      }).catch((error) => done(error));
    });

    it("Should move to recent from running", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      const expectedStatus: TestStatus = copyTestData.status = TestStatus.Finished;
      const expectedStart = copyTestData.startTime = Date.now() - 600000;
      const expectedEnd = copyTestData.endTime = Date.now();
      TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Recent).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(false);
        expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.recentTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.startTime, "startTime").to.equal(expectedStart);
        expect(found?.endTime, "endTime").to.equal(expectedEnd);
        done();
      }).catch((error) => done(error));
    });

    it("Should move to requested from search", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      const expectedStatus: TestStatus = copyTestData.status = TestStatus.Finished;
      const expectedStart = copyTestData.startTime = Date.now() - 600000;
      const expectedEnd = copyTestData.endTime = Date.now();
      TestManagerIntegration.searchedTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Requested).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(false);
        expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.requestedTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.startTime, "startTime").to.equal(expectedStart);
        expect(found?.endTime, "endTime").to.equal(expectedEnd);
        done();
      }).catch((error) => done(error));
    });

    // Add to searched should not add or move
    it("Should not move to searched from running", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      copyTestData.status = TestStatus.Running;
      copyTestData.startTime = Date.now() - 600000;
      copyTestData.endTime = Date.now();
      TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Searched).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(false);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(beforeStatus);
        expect(found?.startTime, "startTime").to.equal(beforeStartTime);
        expect(found?.endTime, "endTime").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    // Add full recent should remove one of the others, even if the add one is older
    it("Should add to recent when full, removing oldest, even if add is older", (done: Mocha.Done) => {
      TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Recent);
      for (const tempTest of Array.from(TestManagerIntegration.recentTestsInt.values())) {
        tempTest.lastRequested = new Date();
        log("tempTest.lastRequested", LogLevel.DEBUG, { tempTest });
      }
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Recent).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.not.equal(undefined);
        expect(removed?.testId, "removed.testId").to.not.equal(testId);
        expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.recentTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(beforeStatus);
        expect(found?.startTime, "startTime").to.equal(beforeStartTime);
        expect(found?.endTime, "endTime").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("Should add to recent when full, not removing is already there", (done: Mocha.Done) => {
      TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT - 1, CacheLocation.Recent);
      for (const tempTest of Array.from(TestManagerIntegration.recentTestsInt.values())) {
        tempTest.lastRequested = new Date();
        log("tempTest.lastRequested", LogLevel.DEBUG, { tempTest });
      }
      TestManagerIntegration.recentTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Recent).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.recentTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(beforeStatus);
        expect(found?.startTime, "startTime").to.equal(beforeStartTime);
        expect(found?.endTime, "endTime").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("Should add to requtested when full, removing oldest, even if add is older", (done: Mocha.Done) => {
      TestManagerIntegration.addCountToList(MAX_SAVED_TESTS_RECENT, CacheLocation.Requested);
      for (const tempTest of Array.from(TestManagerIntegration.requestedTestsInt.values())) {
        tempTest.lastRequested = new Date();
        log("tempTest.lastRequested", LogLevel.DEBUG, { tempTest });
      }
      TestManagerIntegration.addToStoredList(storedTestData, CacheLocation.Requested).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.not.equal(undefined);
        expect(removed?.testId, "removed.testId").to.not.equal(testId);
        expect(TestManagerIntegration.requestedTestsInt.has(testId), "requestedTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.requestedTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(beforeStatus);
        expect(found?.startTime, "startTime").to.equal(beforeStartTime);
        expect(found?.endTime, "endTime").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("Should add to running and still be modifiable", (done: Mocha.Done) => {
      const copyTestData: StoredTestData = { ...storedTestData };
      const expectedStatus: TestStatus = TestStatus.Finished;
      const expectedStart = Date.now() - 600000;
      const expectedEnd = Date.now();
      TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
      TestManagerIntegration.addToStoredList(copyTestData, CacheLocation.Running).then((removed: StoredTestData | undefined) => {
        copyTestData.status = expectedStatus;
        copyTestData.startTime = expectedStart;
        copyTestData.endTime = expectedEnd;
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.startTime, "startTime").to.equal(expectedStart);
        expect(found?.endTime, "endTime").to.equal(expectedEnd);
        done();
      }).catch((error) => done(error));
    });

    it("Should remove cacheLocation", (done: Mocha.Done) => {
      const copyTestData: CachedTestData = { testData: { ...storedTestData }, cacheLocation: CacheLocation.Running };
      TestManagerIntegration.addToStoredList(copyTestData.testData, CacheLocation.Running).then((removed: StoredTestData | undefined) => {
        expect(removed, "removed").to.equal(undefined);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect((found as any).cacheLocation, "cacheLocation").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("getLatestDateTime", () => {
    let storedTestData: StoredTestData;
    let errorCounter = 0;

    beforeEach(() => {
      TestManagerIntegration.clearAllMaps();
      PpaasTestStatusIntegration.getStatusResult = false;
      storedTestData = createStoredTestData("getLatestDateTime");
      storedTestData.ppaasTestStatus = undefined;
      storedTestData.lastChecked = undefined;
      storedTestData.lastUpdated = undefined;
      storedTestData.lastRequested = undefined;
    });

    it("Should return 0 for all undefined", (done: Mocha.Done) => {
      try {
        expect(getLatestDateTime(storedTestData)).to.equal(0);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return 0 for bad strings", (done: Mocha.Done) => {
      try {
        storedTestData.lastChecked = "bad";
        storedTestData.lastUpdated = "bad";
        expect(getLatestDateTime(storedTestData)).to.equal(0);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return lastRequested for bad strings", (done: Mocha.Done) => {
      try {
        storedTestData.lastChecked = "bad";
        storedTestData.lastUpdated = "bad";
        storedTestData.lastRequested = new Date();
        const expected = storedTestData.lastRequested.getTime();
        expect(getLatestDateTime(storedTestData)).to.equal(expected);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    // lastChecked
    it("Should return lastChecked date for strings", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        const earlierDate = new Date(nowTime - 1001); // String parsing only can format to the second
        storedTestData.lastChecked = nowDate.toUTCString();
        storedTestData.lastUpdated = earlierDate.toUTCString();
        storedTestData.lastRequested = earlierDate;
        const expected = Date.parse(nowDate.toUTCString()); // Expected will be rounded to the second
        expect(getLatestDateTime(storedTestData)).to.equal(expected);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return lastChecked date if only", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        storedTestData.lastChecked = nowDate;
        expect(getLatestDateTime(storedTestData)).to.equal(nowTime);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return lastChecked date if latest", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        const earlierDate = new Date(nowTime - 1);
        storedTestData.lastChecked = nowDate;
        storedTestData.lastUpdated = earlierDate;
        storedTestData.lastRequested = earlierDate;
        expect(getLatestDateTime(storedTestData)).to.equal(nowTime);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    // lastUpdated
    it("Should return lastUpdated date for strings", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        const earlierDate = new Date(nowTime - 1001); // String parsing only can format to the second
        storedTestData.lastChecked = earlierDate.toUTCString();
        storedTestData.lastUpdated = nowDate.toUTCString();
        storedTestData.lastRequested = earlierDate;
        const expected = Date.parse(nowDate.toUTCString()); // Expected will be rounded to the second
        expect(getLatestDateTime(storedTestData)).to.equal(expected);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return lastUpdated date if only", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        storedTestData.lastUpdated = nowDate;
        expect(getLatestDateTime(storedTestData)).to.equal(nowTime);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return lastUpdated date if latest", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        const earlierDate = new Date(nowTime - 1);
        storedTestData.lastChecked = earlierDate;
        storedTestData.lastUpdated = nowDate;
        storedTestData.lastRequested = earlierDate;
        expect(getLatestDateTime(storedTestData)).to.equal(nowTime);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    // lastRequested
    it("Should return lastRequested date if only", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        storedTestData.lastRequested = nowDate;
        expect(getLatestDateTime(storedTestData)).to.equal(nowTime);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return lastRequested date if latest", (done: Mocha.Done) => {
      try {
        const nowTime = Date.now();
        const nowDate = new Date(nowTime);
        const earlierDate = new Date(nowTime - 1);
        storedTestData.lastChecked = earlierDate;
        storedTestData.lastUpdated = earlierDate;
        storedTestData.lastRequested = nowDate;
        expect(getLatestDateTime(storedTestData)).to.equal(nowTime);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });
  });

  describe("removeOldest", () => {
    const testMap = new Map<string, StoredTestData>();
    const nowTime = Date.now();
    const nowDate = new Date(nowTime);
    const earlierDate = new Date(nowTime - 1000);
    const laterDate = new Date(nowTime + 1000);
    let zeroTestData: StoredTestData;
    let earlierTestData: StoredTestData;
    let nowTestData: StoredTestData;
    let laterTestData: StoredTestData;
    let errorCounter = 0;

    before(() => {
      TestManagerIntegration.clearAllMaps();
      PpaasTestStatusIntegration.getStatusResult = false;
      zeroTestData = createStoredTestData("removeOldestZero");
      earlierTestData = createStoredTestData("removeOldestEarlier");
      nowTestData = createStoredTestData("removeOldestNow");
      laterTestData = createStoredTestData("removeOldestLater");
    });

    beforeEach(() => {
      testMap.clear();
      zeroTestData.lastChecked = zeroTestData.lastUpdated = zeroTestData.lastRequested = undefined;
      earlierTestData.lastChecked = earlierTestData.lastUpdated = earlierTestData.lastRequested = earlierDate;
      nowTestData.lastChecked = nowTestData.lastUpdated = nowTestData.lastRequested = nowDate;
      laterTestData.lastChecked = laterTestData.lastUpdated = laterTestData.lastRequested = laterDate;
    });

    // Remove oldest empty
    it("Should return undefined on empty", (done: Mocha.Done) => {
      try {
        const oldest = removeOldest(testMap);
        expect(oldest).to.equal(undefined);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return zero on oldest zero", (done: Mocha.Done) => {
      try {
        testMap.set(zeroTestData.testId, zeroTestData);
        testMap.set(earlierTestData.testId, earlierTestData);
        testMap.set(nowTestData.testId, nowTestData);
        testMap.set(laterTestData.testId, laterTestData);
        const oldest = removeOldest(testMap);
        expect(oldest, "oldest").to.not.equal(undefined);
        expect(oldest?.testId, "testId").to.equal(zeroTestData.testId);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    // Remove oldest multiple
    it("Should return oldest on oldest non-zero", (done: Mocha.Done) => {
      try {
        testMap.set(earlierTestData.testId, earlierTestData);
        testMap.set(nowTestData.testId, nowTestData);
        testMap.set(laterTestData.testId, laterTestData);
        const oldest = removeOldest(testMap);
        expect(oldest, "oldest").to.not.equal(undefined);
        expect(oldest?.testId, "testId").to.equal(earlierTestData.testId);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return oldest on oldest lastChecked", (done: Mocha.Done) => {
      try {
        earlierTestData.lastUpdated = earlierTestData.lastRequested = undefined;
        nowTestData.lastUpdated = nowTestData.lastRequested = undefined;
        laterTestData.lastUpdated = laterTestData.lastRequested = undefined;
        testMap.set(earlierTestData.testId, earlierTestData);
        testMap.set(nowTestData.testId, nowTestData);
        testMap.set(laterTestData.testId, laterTestData);
        const oldest = removeOldest(testMap);
        expect(oldest, "oldest").to.not.equal(undefined);
        expect(oldest?.testId, "testId").to.equal(earlierTestData.testId);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return oldest on oldest lastUpdated", (done: Mocha.Done) => {
      try {
        earlierTestData.lastChecked = earlierTestData.lastRequested = undefined;
        nowTestData.lastChecked = nowTestData.lastRequested = undefined;
        laterTestData.lastChecked = laterTestData.lastRequested = undefined;
        testMap.set(earlierTestData.testId, earlierTestData);
        testMap.set(nowTestData.testId, nowTestData);
        testMap.set(laterTestData.testId, laterTestData);
        const oldest = removeOldest(testMap);
        expect(oldest, "oldest").to.not.equal(undefined);
        expect(oldest?.testId, "testId").to.equal(earlierTestData.testId);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return oldest on oldest lastRequested", (done: Mocha.Done) => {
      try {
        earlierTestData.lastChecked = earlierTestData.lastUpdated = undefined;
        nowTestData.lastChecked = nowTestData.lastUpdated = undefined;
        laterTestData.lastChecked = laterTestData.lastUpdated = undefined;
        testMap.set(earlierTestData.testId, earlierTestData);
        testMap.set(nowTestData.testId, nowTestData);
        testMap.set(laterTestData.testId, laterTestData);
        const oldest = removeOldest(testMap);
        expect(oldest, "oldest").to.not.equal(undefined);
        expect(oldest?.testId, "testId").to.equal(earlierTestData.testId);
        done();
      } catch (error) {
        log("test error " + errorCounter++, LogLevel.ERROR, error);
        done(error);
      }
    });
  });

  describe("updateRunningTest", () => {
    let testStatusMessage: TestStatusMessage;
    const beforeStatus: TestStatus = TestStatus.Unknown;
    let storedTestData: StoredTestData;
    let testId: string;
    let ppaasTestId: PpaasTestId;
    let endTime: number;
    const instanceId: string = "unittest-instance";
    const hostname: string = "unittest-host";
    const ipAddress: string = "127.0.0.1";
    const errors: string[] = ["unittest-errors"];
    const s3Filename: string[] = ["s3-results"];
    const resultsFilename: string[] = ["unittest-results"];
    const s3Status: TestStatus = TestStatus.Scheduled;
    const messageStatus: TestStatus = TestStatus.Running;
    let oldPpaasTestStatus: PpaasTestStatus;

    beforeEach(() => {
      log("updateRunningTest beforeEach", LogLevel.DEBUG);
      TestManagerIntegration.clearAllMaps();
      PpaasTestStatusIntegration.getStatusResult = false;
      storedTestData = createStoredTestData("updateRunningTest");
      storedTestData.ppaasTestStatus = undefined;
      storedTestData.status = beforeStatus;
      testId = storedTestData.testId;
      ppaasTestId = PpaasTestId.getFromTestId(testId);
      endTime = storedTestData.startTime + (60 * 60 * 1000);
      oldPpaasTestStatus = new PpaasTestStatus(ppaasTestId, {
        ...storedTestData,
        status: s3Status,
        resultsFilename: s3Filename,
        endTime: storedTestData.startTime + (30 * 60 * 1000)
      });
      testStatusMessage = {
        startTime: storedTestData.startTime,
        endTime,
        resultsFilename,
        status: messageStatus,
        instanceId,
        hostname,
        ipAddress
      };
    });

    it("Should move to running from requested on MessageType.TestStatus", (done: Mocha.Done) => {
      const expectedStatus: TestStatus = TestStatus.Running;
      PpaasTestStatusIntegration.getStatusResult = oldPpaasTestStatus;
      TestManagerIntegration.searchedTestsInt.set(testId, storedTestData);
      testStatusMessage.status = expectedStatus;
      const timeBefore = Date.now();
      TestManagerIntegration.updateRunningTest(testId, testStatusMessage, MessageType.TestStatus).then(() => {
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.runningTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.testId, "testId").to.equal(testId);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.endTime, "endTime").to.equal(endTime);
        expect(found?.instanceId, "instanceId").to.equal(instanceId);
        expect(found?.hostname, "hostname").to.equal(hostname);
        expect(found?.ipAddress, "ipAddress").to.equal(ipAddress);
        expect(found?.lastUpdated, "lastUpdated").to.not.equal(undefined);
        expect(typeof found?.lastUpdated, "typeof lastUpdated").to.not.equal("string");
        expect((found?.lastUpdated as Date).getTime(), "lastUpdated").to.be.greaterThanOrEqual(timeBefore);
        expect(found?.errors, "errors").to.equal(undefined);
        expect(found?.resultsFileLocation, "resultsFileLocation").to.not.equal(undefined);
        expect(found?.resultsFileLocation?.length, "resultsFileLocation.length").to.equal(1);
        expect(found?.resultsFileLocation![0], "resultsFileLocation[0]").to.include(resultsFilename[0]);
        expect(found?.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
        expect(found?.ppaasTestStatus?.endTime, "endTime").to.equal(oldPpaasTestStatus.endTime);
        expect(found?.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(oldPpaasTestStatus.status);
        expect(TestManagerIntegration.searchedTestsInt.has(testId), "searchedTestsInt.has").to.equal(false);
        done();
      }).catch((error) => done(error));
    });

    it("Should move to recent from running if on MessageType.TestFinished", (done: Mocha.Done) => {
      const expectedStatus: TestStatus = TestStatus.Finished;
      PpaasTestStatusIntegration.getStatusResult = oldPpaasTestStatus;
      TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
      testStatusMessage.status = expectedStatus;
      testStatusMessage.errors = errors;
      const timeBefore = Date.now();
      TestManagerIntegration.updateRunningTest(testId, testStatusMessage, MessageType.TestFinished).then(() => {
        expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.recentTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.testId, "testId").to.equal(testId);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.endTime, "endTime").to.equal(endTime);
        expect(found?.instanceId, "instanceId").to.equal(instanceId);
        expect(found?.hostname, "hostname").to.equal(hostname);
        expect(found?.ipAddress, "ipAddress").to.equal(ipAddress);
        expect(found?.lastUpdated, "lastUpdated").to.not.equal(undefined);
        expect(typeof found?.lastUpdated, "typeof lastUpdated").to.not.equal("string");
        expect((found?.lastUpdated as Date).getTime(), "lastUpdated").to.be.greaterThanOrEqual(timeBefore);
        expect(JSON.stringify(found?.errors), "errors").to.equal(JSON.stringify(errors));
        expect(found?.resultsFileLocation, "resultsFileLocation").to.not.equal(undefined);
        expect(found?.resultsFileLocation?.length, "resultsFileLocation.length").to.equal(1);
        expect(found?.resultsFileLocation![0], "resultsFileLocation[0]").to.include(resultsFilename[0]);
        expect(found?.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
        expect(found?.ppaasTestStatus?.endTime, "endTime").to.equal(oldPpaasTestStatus.endTime);
        expect(found?.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(oldPpaasTestStatus.status);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(false);
        done();
      }).catch((error) => done(error));
    });

    it("Should move to recent from running if on MessageType.TestFailed", (done: Mocha.Done) => {
      const expectedStatus: TestStatus = TestStatus.Failed;
      PpaasTestStatusIntegration.getStatusResult = oldPpaasTestStatus;
      TestManagerIntegration.runningTestsInt.set(testId, storedTestData);
      testStatusMessage.status = expectedStatus;
      testStatusMessage.errors = errors;
      TestManagerIntegration.updateRunningTest(testId, testStatusMessage, MessageType.TestFailed).then(() => {
        expect(TestManagerIntegration.recentTestsInt.has(testId), "recentTestsInt.has").to.equal(true);
        const found: StoredTestData | undefined = TestManagerIntegration.recentTestsInt.get(testId);
        expect(found, "found").to.not.equal(undefined);
        expect(found?.testId, "testId").to.equal(testId);
        expect(found?.status, "status").to.equal(expectedStatus);
        expect(found?.endTime, "endTime").to.equal(endTime);
        expect(found?.instanceId, "instanceId").to.equal(instanceId);
        expect(found?.hostname, "hostname").to.equal(hostname);
        expect(found?.ipAddress, "ipAddress").to.equal(ipAddress);
        expect(JSON.stringify(found?.errors), "errors").to.equal(JSON.stringify(errors));
        expect(found?.resultsFileLocation, "resultsFileLocation").to.not.equal(undefined);
        expect(found?.resultsFileLocation?.length, "resultsFileLocation.length").to.equal(1);
        expect(found?.resultsFileLocation![0], "resultsFileLocation[0]").to.include(resultsFilename[0]);
        expect(found?.ppaasTestStatus, "ppaasTestStatus").to.not.equal(undefined);
        expect(found?.ppaasTestStatus?.endTime, "endTime").to.equal(oldPpaasTestStatus.endTime);
        expect(found?.ppaasTestStatus?.status, "ppaasTestStatus.status").to.equal(oldPpaasTestStatus.status);
        expect(TestManagerIntegration.runningTestsInt.has(testId), "runningTestsInt.has").to.equal(false);
        done();
      }).catch((error) => done(error));
    });
  });
});
