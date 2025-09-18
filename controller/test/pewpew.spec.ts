import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  PewPewVersionsResponse,
  TestManagerError
} from "../types";
import type { File, Files } from "formidable";
import {
  LogLevel,
  PEWPEW_BINARY_EXECUTABLE,
  PEWPEW_BINARY_FOLDER,
  PpaasTestId,
  log,
  logger,
  sleep
} from "@fs/ppaas-common";
import {
  ParsedForm,
  createFormidableFile,
  unzipFile
} from "../src/util";
import { TestScheduler, TestSchedulerItem } from "../src/testscheduler";
import {
  VERSION_TAG_NAME,
  deletePewPew,
  getCurrentPewPewLatestVersion,
  getPewPewVersionsInS3,
  getPewpew,
  postPewPew
} from "../src/pewpew";
import {
  mockGetObjectTagging,
  mockListObject,
  mockListObjects,
  mockS3,
  mockUploadObject,
  resetMockS3
} from "./mock";
import { _Object as S3Object } from "@aws-sdk/client-s3";
import { expect } from "chai";
import { latestPewPewVersion } from "../src/clientutil";
import path from "path";
import { platform } from "os";
import semver from "semver";

logger.config.LogFileName = "ppaas-controller";

const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
const PEWPEW_ZIP_FILEPATH = process.env.PEWPEW_ZIP_FILEPATH || path.join(UNIT_TEST_FOLDER, PEWPEW_BINARY_EXECUTABLE + ".zip");

const authAdmin: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1"
};

const pewpewZipFile: File = createFormidableFile(
  path.basename(PEWPEW_ZIP_FILEPATH),
  PEWPEW_ZIP_FILEPATH,
  "unittest",
  1,
  null
);
const invalidFiles = {
  additionalFiles: [pewpewZipFile]
};

const pewpewS3Folder = PEWPEW_BINARY_FOLDER;
const pewpewFilename = PEWPEW_BINARY_EXECUTABLE;
const versions = ["0.5.10", "0.5.11", "0.5.12-preview1", "0.5.12-preview2", "latest"];
const s3Object: S3Object = {
  LastModified: new Date(),
  Size: 1,
  StorageClass: "STANDARD"
};

class TestSchedulerIntegration extends TestScheduler {
  /** Sets both the class static and global scheduledTests */
  public static setScheduledTests (scheduledTests: Map<string, TestSchedulerItem> | undefined): void {
    global.scheduledTests = TestScheduler.scheduledTests = scheduledTests;
  }

  /** Only sets the global scheduledTests */
  public static setGlobalScheduledTests (scheduledTests: Map<string, TestSchedulerItem> | undefined): void {
    global.scheduledTests = scheduledTests;
  }
}

describe("PewPew Util", () => {
  let files: Files = {};
  let mixedFiles: Files = {};

  before(async () => {
    mockS3();
    mockUploadObject();
    mockGetObjectTagging(new Map([["tagName", "tagValue"]]));
    const filename: string = pewpewZipFile.originalFilename!;
    try {
      const unzippedFiles: File[] = await unzipFile(pewpewZipFile);
      log("unzipped " + filename, LogLevel.DEBUG, unzippedFiles);
      files = {
        additionalFiles: unzippedFiles
      };
      log("new files " + filename, LogLevel.DEBUG, files);
      mixedFiles = {
        additionalFiles: [...unzippedFiles, pewpewZipFile]
      };
      if (platform() === "win32") {
        // Windows gets EBUSY trying to run pewpew --version since the unzip still hasn't released
        await sleep(100);
      }
    } catch (error) {
      log("Error unzipping " + filename, LogLevel.ERROR, error);
      throw error;
    }
  });

  after(() => {
    resetMockS3();
    // We need to reset this to force it to go to S3 later. Otherwise it just returns the value
    global.currentLatestVersion = undefined;
  });

  describe("getCurrentPewPewLatestVersion", () => {
    it("getCurrentPewPewLatestVersion should return version with latest tag from S3", (done: Mocha.Done) => {
      const expected = "0.5.13";
      mockGetObjectTagging(new Map([[VERSION_TAG_NAME, expected]]));
      // We need to reset this to force it to go to S3. Otherwise it just returns the value
      global.currentLatestVersion = undefined;
      getCurrentPewPewLatestVersion().then((result: string | undefined)  => {
        log("getPewPewVersionsInS3()", LogLevel.DEBUG, result);
        expect(result).to.equal(expected);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("getPewPewVersionsInS3", () => {
    it("getPewPewVersionsInS3() should return array with elements", (done: Mocha.Done) => {
      mockListObjects(versions.map((version): S3Object => ({ ...s3Object, Key: `${pewpewS3Folder}/${version}/${pewpewFilename}` })));
      getPewPewVersionsInS3().then((result: string[]) => {
        log("getPewPewVersionsInS3()", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(Array.isArray(result), JSON.stringify(result)).to.equal(true);
        expect(result.length).to.be.greaterThan(0);
        for (const version of result) {
          if (version !== latestPewPewVersion) {
            log(`semver.valid(${version}) = ${semver.valid(version)}`, LogLevel.DEBUG);
            expect(semver.valid(version), `semver.valid(${version})`).to.not.equal(null);
          }
          expect(versions.includes(version), `${JSON.stringify(versions)}.includes("${version}")`).to.equal(true);
        }
        done();
      }).catch((error) => done(error));
    });
  });

  describe("postPewPew", () => {
    it("postPewPew should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew as latest should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {
          latest: ["true"]
        },
        files
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      global.currentLatestVersion = "0.0.1"; // bogus value
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        expect(global.currentLatestVersion, "global.currentLatestVersion").to.equal(version);
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew no files should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: {}
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Must provide a additionalFiles minimally");
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: invalidFiles
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Only pewpew executables are allowed");
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew mixed should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: mixedFiles
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Only pewpew executables are allowed");
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

  });

  describe("getPewpew", () => {
    it("getPewpew should respond 200 OK", (done: Mocha.Done) => {
      mockListObjects(versions.map((version): S3Object => ({ ...s3Object, Key: `${pewpewS3Folder}/${version}/${pewpewFilename}` })));
      getPewpew().then((res: ErrorResponse | PewPewVersionsResponse) => {
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const pewpewVersions: TestManagerError | string[] = res.json;
        log("pewpewVersions: " + pewpewVersions, LogLevel.DEBUG, pewpewVersions);
        expect(pewpewVersions).to.not.equal(undefined);
        expect(Array.isArray(pewpewVersions)).to.equal(true);
        if (Array.isArray(pewpewVersions)) {
          expect(pewpewVersions.length).to.equal(versions.length);
          for (const pewpewVersion of pewpewVersions) {
            expect(versions.includes(pewpewVersion), `${JSON.stringify(versions)}.includes("${pewpewVersion}")`).to.equal(true);
          }
        }
        done();
      }).catch((error) => done(error));
    });
  });

  describe("deletePewPew", () => {
    const versionNotInUse = "0.1.0";
    const versionInUse = "0.1.1";
    let testIdInUse: string | undefined;

    before(async () => {
      const yamlFile = "unittest.yaml";
      const { testId, s3Folder } = PpaasTestId.makeTestId(yamlFile);
      const testScheduler = new Map<string, TestSchedulerItem>();
      TestSchedulerIntegration.setScheduledTests(testScheduler);
      const authUser1: AuthPermissions = {
        authPermission: AuthPermission.User,
        token: "user1token",
        userId: "user1"
      };
      await TestSchedulerIntegration.addTest({
        queueName: "bogus",
        scheduleDate: Date.now() + 600000,
        testMessage: {
          version: versionInUse,
          testId,
          s3Folder,
          yamlFile,
          envVariables: {},
          restartOnFailure: true
        }
      }, authUser1);
      testIdInUse = testId;
      const foundInUse = await TestSchedulerIntegration.getTestIdsForPewPewVersion(versionInUse);
      log("scheduledTests", LogLevel.DEBUG, global.scheduledTests);
      expect(foundInUse, "foundInUse").to.not.equal(undefined);
      expect(foundInUse?.length, "foundInUse.length").to.equal(1);
      expect(foundInUse![0], "foundInUse[0]").to.equal(testId);
    });

    after(() => {
      TestSchedulerIntegration.setScheduledTests(undefined);
    });

    it("deletePewPew should respond 200 OK", (done: Mocha.Done) => {
      const version = versionNotInUse;
      mockListObject({ filename: pewpewFilename, folder: `${pewpewS3Folder}/${version}` });
      const query = { version };
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew deleted, version: " + query.version);
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("deletePewPew in use should respond 400 Bad Request", (done: Mocha.Done) => {
      const version = versionInUse;
      mockListObject({ filename: pewpewFilename, folder: `${pewpewS3Folder}/${version}` });
      const query = { version };
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("cannot be deleted, in use by testId");
        expect(body.message).to.include(version);
        expect(body.message).to.include(testIdInUse);
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("deletePewPew no version should return 400", (done: Mocha.Done) => {
      log("deletePewPew query", LogLevel.DEBUG, {});
      deletePewPew({}, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Must provide a version minimally");
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("deletePewPew empty version should return 400", (done: Mocha.Done) => {
      const version = "";
      mockListObject({ filename: pewpewFilename, folder: `${pewpewS3Folder}/${version}` });
      const query = { version };
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Must provide a version minimally");
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("deletePewPew multiple versions should return 400", (done: Mocha.Done) => {
      const version = [versionNotInUse, versionNotInUse];
      mockListObject({ filename: pewpewFilename, folder: `${pewpewS3Folder}/${version[0]}` });
      const query = { version };
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Only one 'version' is allowed");
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("deletePewPew not in s3 version should return 404", (done: Mocha.Done) => {
      mockListObjects([]);
      const query = { version: "0.1.0" };
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(404);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Pewpew version not found");
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("deletePewPew should not delete latest", (done: Mocha.Done) => {
      mockListObject({ filename: pewpewFilename, folder: `${pewpewS3Folder}/${latestPewPewVersion}` });
      const version = latestPewPewVersion;
      const query = { version };
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include(`Pewpew version ${latestPewPewVersion} cannot be deleted`);
        done();
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

  });
});
