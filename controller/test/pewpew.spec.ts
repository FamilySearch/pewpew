import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  PewPewVersionsResponse,
  TestManagerError
} from "../types";
import type { File, Files } from "formidable";
import { LogLevel, PpaasTestId, log, logger } from "@fs/ppaas-common";
import {
  PEWPEW_BINARY_FOLDER,
  ParsedForm,
  createFormidableFile,
  unzipFile
} from "../pages/api/util/util";
import {
  PEWPEW_EXECUTABLE_NAME,
  deletePewPew,
  getPewPewVersionsInS3,
  getPewpew,
  postPewPew
} from "../pages/api/util/pewpew";
import { TestScheduler, TestSchedulerItem } from "../pages/api/util/testscheduler";
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
import { latestPewPewVersion } from "../pages/api/util/clientutil";
import path from "path";
import semver from "semver";

logger.config.LogFileName = "ppaas-controller";

const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
const PEWPEW_LEGACY_FILEPATH = path.join(UNIT_TEST_FOLDER, "pewpew.zip");
const PEWPEW_SCRIPTING_FILEPATH = path.join(UNIT_TEST_FOLDER, "scripting/pewpew.zip");

const authAdmin: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1"
};

const legacyPewpewZipFile: File = createFormidableFile(
  path.basename(PEWPEW_LEGACY_FILEPATH),
  PEWPEW_LEGACY_FILEPATH,
  "unittest",
  1,
  null
);
const invalidFiles = {
  additionalFiles: [legacyPewpewZipFile] as any as File
};

const pewpewS3Folder = PEWPEW_BINARY_FOLDER;
const pewpewFilename = PEWPEW_EXECUTABLE_NAME;
const versions = ["0.5.11", "0.5.12", "0.5.13-preview1", "0.5.13-preview2", "0.6.0-preview1", "0.6.0-preview2", "latest"];
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
  let filesLegacyPewpew: Files = {};
  let filesScriptingPewpew: Files = {};
  let mixedFiles: Files = {};

  before(async () => {
    mockS3();
    mockUploadObject();
    mockGetObjectTagging(new Map([["tagName", "tagValue"]]));

    try {
      const filename: string = legacyPewpewZipFile.originalFilename!;
      const unzippedFiles: File[] = await unzipFile(legacyPewpewZipFile);
      log("unzipped " + filename, LogLevel.DEBUG, unzippedFiles);
      filesLegacyPewpew = {
        additionalFiles: unzippedFiles as any as File
      };
      log("legacy files " + filename, LogLevel.DEBUG, filesLegacyPewpew);
      mixedFiles = {
        additionalFiles: [...unzippedFiles, legacyPewpewZipFile] as any as File
      };
    } catch (error) {
      log("Error unzipping " + legacyPewpewZipFile.originalFilename, LogLevel.ERROR, error);
      throw error;
    }

    const scriptingPewpewZipFile: File = createFormidableFile(
      path.basename(PEWPEW_SCRIPTING_FILEPATH),
      PEWPEW_SCRIPTING_FILEPATH,
      "unittest",
      1,
      null
    );
    try {
      const filename: string = scriptingPewpewZipFile.originalFilename!;
      const unzippedFiles: File[] = await unzipFile(scriptingPewpewZipFile);
      log("unzipped " + filename, LogLevel.DEBUG, unzippedFiles);
      filesScriptingPewpew = {
        additionalFiles: unzippedFiles as any as File
      };
      log("scripting files " + filename, LogLevel.DEBUG, filesScriptingPewpew);
    } catch (error) {
      log("Error unzipping " + scriptingPewpewZipFile.originalFilename, LogLevel.ERROR, error);
      throw error;
    }
  });

  after(() => {
    resetMockS3();
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

    it("postPewPew legacy should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: filesLegacyPewpew
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
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
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
          latest: "true"
        },
        files: filesLegacyPewpew
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
        expect(body.message).to.include("as latest");
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew scripting should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: filesScriptingPewpew
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
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
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

    before(() => {
      const yamlFile = "unittest.yaml";
      const { testId, s3Folder } = PpaasTestId.makeTestId(yamlFile);
      const testScheduler = new Map<string, TestSchedulerItem>();
      TestSchedulerIntegration.setScheduledTests(testScheduler);
      const authUser1: AuthPermissions = {
        authPermission: AuthPermission.User,
        token: "user1token",
        userId: "user1"
      };
      TestSchedulerIntegration.addTest({
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
