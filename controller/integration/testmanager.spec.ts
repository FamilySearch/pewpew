import {
  AllTests,
  AllTestsResponse,
  AuthPermission,
  AuthPermissions,
  EnvironmentVariablesFile,
  ErrorResponse,
  MessageResponse,
  PreviousTestData,
  PreviousTestDataResponse,
  TestData,
  TestDataResponse,
  TestManagerError
} from "../types";
import type { Fields, File, Files } from "formidable";
import { LOCAL_FILE_LOCATION, ParsedForm, createFormidableFile } from "../pages/api/util/util";
import {
  LogLevel,
  PpaasS3File,
  PpaasTestId,
  PpaasTestMessage,
  TestStatus,
  log,
  logger,
  s3
} from "@fs/ppaas-common";
import { TestManager, defaultRecurringFileTags} from "../pages/api/util/testmanager";
import { isYamlFile, latestPewPewVersion } from "../pages/api/util/clientutil";
import { EventInput } from "@fullcalendar/core";
import { PpaasEncryptEnvironmentFile } from "../pages/api/util/ppaasencryptenvfile";
import { TestScheduler } from "../pages/api/util/testscheduler";
import { expect } from "chai";
import { getPewPewVersionsInS3 } from "../pages/api/util/pewpew";
import path from "path";

logger.config.LogFileName = "ppaas-controller";

// Re-create these here so we don't have to run yamlparser.spec by importing it
export const UNIT_TEST_FOLDER: string = path.resolve(process.env.UNIT_TEST_FOLDER || "test");
const BASIC_YAML_FILE: string = "basic.yaml";
const BASIC_FILEPATH = path.join(UNIT_TEST_FOLDER, "basic.yaml");
const BASIC_FILEPATH_WITH_ENV = path.join(UNIT_TEST_FOLDER, "basicwithenv.yaml");
const BASIC_FILEPATH_WITH_FILES = path.join(UNIT_TEST_FOLDER, "basicwithfiles.yaml");
const BASIC_FILEPATH_NO_PEAK_LOAD = path.join(UNIT_TEST_FOLDER, "basicnopeakload.yaml");
const BASIC_FILEPATH_HEADERS_ALL = path.join(UNIT_TEST_FOLDER, "basicheadersall.yaml");
const SCRIPTING_FILEPATH = path.join(UNIT_TEST_FOLDER, "scripting.yaml");
const SCRIPTING_FILEPATH_WITH_ENV = path.join(UNIT_TEST_FOLDER, "scriptingwithenv.yaml");
const SCRIPTING_FILEPATH_WITH_FILES = path.join(UNIT_TEST_FOLDER, "scriptingwithfiles.yaml");
const SCRIPTING_FILEPATH_NO_PEAK_LOAD = path.join(UNIT_TEST_FOLDER, "scriptingnopeakload.yaml");
const SCRIPTING_FILEPATH_HEADERS_ALL = path.join(UNIT_TEST_FOLDER, "scriptingheadersall.yaml");
const NOT_YAML_FILEPATH = path.join(UNIT_TEST_FOLDER, "text.txt");
const NOT_YAML_FILEPATH2 = path.join(UNIT_TEST_FOLDER, "text2.txt");
const PEWPEWYAML_FILEPATH = path.join(UNIT_TEST_FOLDER, "pewpew.yaml");
const SETTINGSYAML_FILEPATH = path.join(UNIT_TEST_FOLDER, "settings.yaml");

let sharedPpaasTestId: PpaasTestId | undefined;
let sharedTestData: TestData | undefined;
let sharedScheduledTestData: TestData | undefined;
let sharedScheduledWithVarsTestData: TestData | undefined;
let sharedScheduledWithFilesTestData: TestData | undefined;
let sharedRecurringWithVarsTestData: TestData | undefined;
let sharedQueueNames: string[] | undefined;
let sharedPewPewVersions: string[] | undefined;

const authAdmin: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1token",
  userId: "admin1"
};

let filesize: number = 1;
const createFileObject = (filepath: string): File => createFormidableFile(
  path.basename(filepath),
  filepath,
  "unittest",
  filesize++,
  null
);

/** Environment variables that will be posted from the client on re-run */
const defaultEnvironmentVariablesFromPrior: EnvironmentVariablesFile = {
  SERVICE_URL_AGENT: { value: "127.0.0.1:8080", hidden: false } // Not Hidden. SHOULD be available for re-run, but posted by the client
};
// We want to use a mix of the new style (EnvironmentVariableState) and legacy (string) and test both
const defaultEnvironmentVariables: EnvironmentVariablesFile = {
  ...defaultEnvironmentVariablesFromPrior,
  TEST1: { value: "true", hidden: true }, // Hidden shouldn't be available for re-run
  TEST2: "true" // Legacy shouldn't be available for re-run
};

const everyDaysOfWeek: number[] = [0,1,2,3,4,5,6];

describe("TestManager Integration", () => {
  // let testId: string | undefined;
  let testIdWithEnv: string | undefined;
  let testIdWithFiles: string | undefined;
  let testIdWithVersion: string | undefined;
  let testIdMissingEnv: string | undefined;
  let queueName: string = "unittests";
  let legacyVersion: string | undefined;
  let scriptingVersion: string | undefined;

  before(async () => {
    try {
      const yamlname: string = path.basename(BASIC_YAML_FILE, path.extname(BASIC_YAML_FILE)).toLocaleLowerCase();
      const files: PpaasS3File[] = await PpaasS3File.getAllFilesInS3({
        s3Folder: yamlname,
        localDirectory: LOCAL_FILE_LOCATION,
        extension: "yaml"
      });
      if (files.length === 0) {
        const yamlFile: string = BASIC_YAML_FILE;
        sharedPpaasTestId = PpaasTestId.makeTestId(yamlFile);
        await new PpaasS3File({
          filename: yamlFile,
          s3Folder: sharedPpaasTestId.s3Folder,
          localDirectory: UNIT_TEST_FOLDER
        }).upload();
      } else {
        sharedPpaasTestId = PpaasTestId.getFromS3Folder(files[0].s3Folder);
      }
      sharedQueueNames = PpaasTestMessage.getAvailableQueueNames();
      log("sharedQueueNames", LogLevel.DEBUG, sharedQueueNames);
      expect(sharedQueueNames, "sharedQueueNames").to.not.equal(undefined);
      expect(sharedQueueNames!.length, "sharedQueueNames.length").to.be.greaterThan(0);
      queueName = sharedQueueNames[0];
      log("queueName", LogLevel.DEBUG, { queueName });
      sharedPewPewVersions = await getPewPewVersionsInS3();
      log("sharedPewPewVersions", LogLevel.DEBUG, sharedPewPewVersions);
      expect(sharedPewPewVersions, "sharedPewPewVersions").to.not.equal(undefined);
      expect(sharedPewPewVersions!.length, "sharedPewPewVersions.length").to.be.greaterThan(0);

      const scriptingRegex = /^0\.6\./;
      legacyVersion = sharedPewPewVersions!.find((pewpewVersion: string) =>
        pewpewVersion !== latestPewPewVersion && !scriptingRegex.test(pewpewVersion)) || "";
      expect(legacyVersion).to.not.equal(undefined);
      expect(legacyVersion).to.not.equal("");
      expect(scriptingRegex.test(legacyVersion), `${scriptingRegex}.test("${legacyVersion}")`).to.equal(false);
      log("legacyVersion", LogLevel.DEBUG, { legacyVersion });
      scriptingVersion = sharedPewPewVersions!.find((pewpewVersion: string) =>
        scriptingRegex.test(pewpewVersion)) || "";
      expect(scriptingVersion).to.not.equal(undefined);
      expect(scriptingVersion).to.not.equal("");
      expect(scriptingRegex.test(scriptingVersion), `${scriptingRegex}.test("${scriptingVersion}")`).to.equal(true);
      log("scriptingVersion", LogLevel.DEBUG, { scriptingVersion });

      const basicFilenameWithEnv = path.basename(BASIC_FILEPATH_WITH_ENV);
      const ppaasTestIdWithEnv: PpaasTestId = PpaasTestId.makeTestId(basicFilenameWithEnv);
      await new PpaasS3File({
        filename: basicFilenameWithEnv,
        s3Folder: ppaasTestIdWithEnv.s3Folder,
        localDirectory: UNIT_TEST_FOLDER
      }).upload();
      testIdMissingEnv = ppaasTestIdWithEnv.testId;
    } catch (error) {
      log("TestManager before", LogLevel.ERROR, error);
      throw error;
    }
  });

  describe("POST /test", () => {
  describe("POST legacy files", () => {
    const basicFiles: Files = { yamlFile: createFileObject(BASIC_FILEPATH) };
    const basicFields: Fields = { queueName };
    const basicParsedForm: ParsedForm = {
      files: basicFiles,
      fields: basicFields
    };
    before(() => {
      if (!queueName) {
        expect(sharedQueueNames, "sharedQueueNames").to.not.equal(undefined);
        expect(sharedQueueNames!.length, "sharedQueueNames.length").to.be.greaterThan(0);
        queueName = sharedQueueNames![0];
      }
      basicFields.queueName = queueName;
      basicParsedForm.fields = basicFields;
      log("postTest sharedQueueNames", LogLevel.DEBUG, sharedQueueNames);
    });

  describe("POST /test new test", () => {
    it("postTest should respond 200 OK", (done: Mocha.Done) => {
      log("postTest parsedForm", LogLevel.DEBUG, { basicParsedForm });
      TestManager.postTest(basicParsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        // testId = body.testId;
        // If this runs before the other acceptance tests populate the shared data
        sharedTestData = body;
        sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
        PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
        .then((s3Files) => {
          log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
          expect(s3Files, "s3Files").to.not.equal(undefined);
          // Should be 3. Yaml, status, vars
          expect(s3Files.length, "s3Files.length").to.equal(3);
          // Check that the test=true tag is added
          const [tagKey, tagValue]: [string, string] = s3.defaultTestFileTags().entries().next().value;
          const [tagKeyExtra, tagValueExtra]: [string, string] = s3.defaultTestExtraFileTags().entries().next().value;
          expect(typeof tagKey, "typeof tagKey").to.equal("string");
          for (const s3File of s3Files) {
            expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
            if (isYamlFile(s3File.filename) || s3File.filename.endsWith(".info")) {
              expect(s3File.tags?.get(tagKey), `${s3File.filename}.tags?.get("${tagKey}")`).to.equal(tagValue);
            } else {
              expect(s3File.tags?.get(tagKeyExtra), `${s3File.filename}.tags?.get("${tagKeyExtra}")`).to.equal(tagValueExtra);
            }
          }
          done();
        }).catch((error) => {
          log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version latest should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          version: latestPewPewVersion
        }
      };
      log("postTest parsedForm latest", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        // testId = body.testId;
        // If this runs before the other acceptance tests populate the shared data
        sharedTestData = body;
        sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version legacy should respond 200 OK", (done: Mocha.Done) => {
      expect(legacyVersion).to.not.equal(undefined);
      log("postTest version, sharedPewPewVersions", LogLevel.DEBUG, { legacyVersion, sharedPewPewVersions });
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          version: legacyVersion!
        }
      };
      log("postTest parsedForm legacy", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        // testId = body.testId;
        // If this runs before the other acceptance tests populate the shared data
        sharedTestData = body;
        testIdWithVersion = body.testId;
        sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version scripting should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(scriptingVersion).to.not.equal(undefined);
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          version: scriptingVersion!
        }
      };
      log("postTest parsedForm basic as scripting", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("YamlParse");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version bogus should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          version: "bogus"
        }
      };
      log("postTest parsedForm bogus", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("invalid version");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with extra options should respond 200 OK", (done: Mocha.Done) => {
      const environmentVariables: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariables,
        NOT_NEEDED: { value: "true", hidden: false },
        ALSO_NOT_NEEDED: { value: "false", hidden: true }
      };
      const parsedForm: ParsedForm = {
        files: {
          ...basicFiles,
          additionalFiles: createFileObject(NOT_YAML_FILEPATH)
        },
        fields: {
          ...basicFields,
          restartOnFailure: "true",
          environmentVariables: JSON.stringify(environmentVariables)
        }
      };
      log("postTest parsedForm extra options", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables(environmentVariables));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(environmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(environmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing vars should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_WITH_ENV) },
        fields: basicFields
      };
      log("postTest parsedForm missing vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("SERVICE_URL_AGENT");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing files should respond 400 Bad Request", (done: Mocha.Done) => {
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH2);
      const parsedForm: ParsedForm = {
        files: {
          yamlFile: createFileObject(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: createFileObject(NOT_YAML_FILEPATH)
        },
        fields: basicFields
      };
      log("postTest parsedForm missing files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include(extrafilename);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest pewpew.yaml should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(PEWPEWYAML_FILEPATH) },
        fields: basicFields
      };
      log("postTest pewpew.yaml", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest pewpew.yaml res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("pewpew.yaml body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Invalid Yaml filename");
        expect(body.error).to.not.equal(undefined);
        expect(body.error!).to.include("cannot be named PewPew"); // PpaasTestId.From makeTestId
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest settings.yaml should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(SETTINGSYAML_FILEPATH) },
        fields: basicFields
      };
      log("postTest settings.yaml", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest settings.yaml res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("settings.yaml body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("reserved word");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with vars should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_WITH_ENV) },
        fields: {
          ...basicFields,
          environmentVariables: JSON.stringify(defaultEnvironmentVariables)
        }
      };
      log("postTest parsedForm with vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        testIdWithEnv = body.testId;
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables(defaultEnvironmentVariables));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(defaultEnvironmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(defaultEnvironmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with files should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: {
          yamlFile: createFileObject(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: [createFileObject(NOT_YAML_FILEPATH), createFileObject(NOT_YAML_FILEPATH2)] as any as File
        },
        fields: basicFields
      };
      log("postTest parsedForm with files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        testIdWithFiles = body.testId;
        PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
        .then((s3Files) => {
          log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
          expect(s3Files, "s3Files").to.not.equal(undefined);
          // Should be 3. Yaml, status, vars
          expect(s3Files.length, "s3Files.length").to.equal(5);
          // Check that the test=true tag is added
          const [tagKey, tagValue]: [string, string] = s3.defaultTestFileTags().entries().next().value;
          const [tagKeyExtra, tagValueExtra]: [string, string] = s3.defaultTestExtraFileTags().entries().next().value;
          expect(typeof tagKey, "typeof tagKey").to.equal("string");
          for (const s3File of s3Files) {
            expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
            if (isYamlFile(s3File.filename) || s3File.filename.endsWith(".info")) {
              expect(s3File.tags?.get(tagKey), `${s3File.filename}.tags?.get("${tagKey}")`).to.equal(tagValue);
            } else {
              expect(s3File.tags?.get(tagKeyExtra), `${s3File.filename}.tags?.get("${tagKeyExtra}")`).to.equal(tagValueExtra);
            }
          }
          done();
        }).catch((error) => {
          log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with no peak load should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_NO_PEAK_LOAD) },
        fields: basicFields
      };
      log("postTest parsedForm no peak load", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with headers_all should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_HEADERS_ALL) },
        fields: basicFields
      };
      log("postTest parsedForm headers_all", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("POST /test scheduled", () => {
    it("postTest scheduled should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.not.equal(undefined);
        expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
        // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
        expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(scheduleDate);
        // If this runs before the other acceptance tests populate the shared data
        sharedScheduledTestData = body;
        PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
        .then((s3Files) => {
          log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
          expect(s3Files, "s3Files").to.not.equal(undefined);
          // Should be 3. Yaml, status, vars
          expect(s3Files.length, "s3Files.length").to.equal(3);
          // Check that the recurring=true tag is added
          const [tagKey, tagValue]: [string, string] = s3.defaultTestFileTags().entries().next().value;
          const [tagKeyExtra, tagValueExtra]: [string, string] = s3.defaultTestExtraFileTags().entries().next().value;
          expect(typeof tagKey, "typeof tagKey").to.equal("string");
          for (const s3File of s3Files) {
            expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
            if (isYamlFile(s3File.filename) || s3File.filename.endsWith(".info")) {
              expect(s3File.tags?.get(tagKey), `${s3File.filename}.tags?.get("${tagKey}")`).to.equal(tagValue);
            } else {
              expect(s3File.tags?.get(tagKeyExtra), `${s3File.filename}.tags?.get("${tagKeyExtra}")`).to.equal(tagValueExtra);
            }
          }
          done();
        }).catch((error) => {
          log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled with vars should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_WITH_ENV) },
        fields: {
          ...basicFields,
          environmentVariables: JSON.stringify(defaultEnvironmentVariables),
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled with vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        sharedScheduledWithVarsTestData = body;
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables(defaultEnvironmentVariables));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(defaultEnvironmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(defaultEnvironmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled with files should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: {
          yamlFile: createFileObject(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: [createFileObject(NOT_YAML_FILEPATH), createFileObject(NOT_YAML_FILEPATH2)] as any as File
        },
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm with files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        sharedScheduledWithFilesTestData = body;
        PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
        .then((s3Files) => {
          log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
          expect(s3Files, "s3Files").to.not.equal(undefined);
          // Should be 3. Yaml, status, vars
          expect(s3Files.length, "s3Files.length").to.equal(5);
          // Check that the recurring=true tag is added
          const [tagKey, tagValue]: [string, string] = s3.defaultTestFileTags().entries().next().value;
          const [tagKeyExtra, tagValueExtra]: [string, string] = s3.defaultTestExtraFileTags().entries().next().value;
          expect(typeof tagKey, "typeof tagKey").to.equal("string");
          for (const s3File of s3Files) {
            expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
            if (isYamlFile(s3File.filename) || s3File.filename.endsWith(".info")) {
              expect(s3File.tags?.get(tagKey), `${s3File.filename}.tags?.get("${tagKey}")`).to.equal(tagValue);
            } else {
              expect(s3File.tags?.get(tagKeyExtra), `${s3File.filename}.tags?.get("${tagKeyExtra}")`).to.equal(tagValueExtra);
            }
          }
          done();
        }).catch((error) => {
          log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled in the past should respond 400 Bad Request", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() - 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled past", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("Could not addTest");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("past");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled in the invalid date should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "bad"
        }
      };
      log("postTest parsedForm scheduled invalid", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("invalid scheduleDate");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("not a number");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const endDate: number = Date.now() + (7 * 24 * 60 * 60000);
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate,
          endDate: "" + endDate,
          daysOfWeek: JSON.stringify(everyDaysOfWeek)
        }
      };
      log("postTest parsedForm scheduled recurring", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.not.equal(undefined);
        expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
        // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
        expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(scheduleDate);
        // If this runs before the other acceptance tests populate the shared data
        TestScheduler.getCalendarEvents().then((calendarEvents: EventInput[]) => {
          const event: EventInput | undefined = calendarEvents.find((value: EventInput) => value.id === body.testId);
          expect(event, "event found").to.not.equal(undefined);
          expect(event!.startRecur, "event.startRecur").to.equal(scheduleDate);
          expect(event!.daysOfWeek, "event.daysOfWeek").to.not.equal(undefined);
          expect(JSON.stringify(event!.daysOfWeek), "event.daysOfWeek").to.equal(JSON.stringify(everyDaysOfWeek));
          PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
          .then((s3Files) => {
            log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
            expect(s3Files, "s3Files").to.not.equal(undefined);
            // Should be 3. Yaml, status, vars
            expect(s3Files.length, "s3Files.length").to.equal(3);
            // Check that the recurring=true tag is added
            const [tagKey, tagValue]: [string, string] = defaultRecurringFileTags().entries().next().value;
            expect(typeof tagKey, "typeof tagKey").to.equal("string");
            for (const s3File of s3Files) {
              expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
              expect(s3File.tags?.get(tagKey), `${s3File.filename}.tags?.get("${tagKey}")`).to.equal(tagValue);
            }
            done();
          }).catch((error) => {
            log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((error) => done(error));
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring daysOfWeek no endDate should respond 400 Bad Request", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate,
          daysOfWeek: "[0]"
        }
      };
      log("postTest parsedForm scheduled daysOfWeek no endDate", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("both daysOfWeek and endDate");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring endDate no daysOfWeek should respond 400 Bad Request", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate,
          endDate: "" + (Date.now() + 1200000)
        }
      };
      log("postTest parsedForm scheduled endDate no daysOfWeek", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("both daysOfWeek and endDate");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring invalid endDate should respond 400 Bad Request", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate,
          daysOfWeek: JSON.stringify(everyDaysOfWeek),
          endDate: "bad"
        }
      };
      log("postTest parsedForm scheduled invalid endDate", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("invalid endDate");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring invalid daysOfWeek should respond 400 Bad Request", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate,
          daysOfWeek: JSON.stringify([...everyDaysOfWeek,7,5]),
          endDate: "" + (Date.now() + 1200000)
        }
      };
      log("postTest parsedForm scheduled invalid daysOfWeek", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("invalid daysOfWeek");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring invalid daysOfWeek should respond 400 Bad Request", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          scheduleDate: "" + scheduleDate,
          daysOfWeek: JSON.stringify([]),
          endDate: "" + (Date.now() + 1200000)
        }
      };
      log("postTest parsedForm scheduled invalid daysOfWeek", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("invalid daysOfWeek");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("POST /test prior test", () => {
    it("postTest with prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId, "sharedPpaasTestId").to.not.equal(undefined);
      const testId: string = sharedPpaasTestId!.testId;
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: BASIC_YAML_FILE
        }
      };
      log("postTest parsedForm prior testId", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.testId).to.not.equal(testId);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        // testId = body.testId;
        // If this runs before the other acceptance tests populate the shared data
        sharedTestData = body;
        sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing hidden vars and prior testId should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const changedVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST2: "false"
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: testIdWithEnv!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(changedVars)
        }
      };
      log("postTest parsedForm with prior testIdWithEnv", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("missingEnvironmentVariables=TEST1");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing legacy vars and prior testId should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const changedVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "false", hidden: true }
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: testIdWithEnv!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(changedVars)
        }
      };
      log("postTest parsedForm with prior testIdWithEnv", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("missingEnvironmentVariables=TEST2");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with vars and prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const changedVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "false", hidden: true },
        TEST2: "false"
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: testIdWithEnv!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(changedVars)
        }
      };
      log("postTest parsedForm with prior testIdWithEnv", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        // Don't use this one for future use since we change the vars
        // testIdWithEnv = body.testId;
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length: " + Object.keys(variablesFile)).to.equal(Object.keys(defaultEnvironmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(defaultEnvironmentVariables)) {
            if (variableName.startsWith("TEST")) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing vars prior testId should respond 400 Bad Request", (done: Mocha.Done) => {
      // We need a testId that doesn't have saved environment variables
      expect(testIdMissingEnv, "testIdMissingEnv").to.not.equal(undefined);
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: testIdMissingEnv!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV)
        }
      };
      log("postTest parsedForm mising vars prior testIdMissingEnv", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("SERVICE_URL_AGENT");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // In this case, even though the previous test has the files, if we don't pass them in to the fields it should fail
    it("postTest missing files prior testId should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(testIdWithFiles, "testIdWithFiles").to.not.equal(undefined);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: testIdWithFiles!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: extrafilename
        }
      };
      log("postTest parsedForm missing files prior testIdWithFiles", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include(extrafilename2);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // This test the prior test doesn't even need the files, but the new yaml does
    it("postTest missing files prior testId, new yaml needs files should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(sharedPpaasTestId, "sharedPpaasTestId").to.not.equal(undefined);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_WITH_FILES) },
        fields: {
          ...basicFields,
          testId: sharedPpaasTestId!.testId
        }
      };
      log("postTest parsedForm missing files prior testId", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include(extrafilename);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // Now we pass in the prior files
    it("postTest with files prior testId should respond 200 Ok", (done: Mocha.Done) => {
      expect(testIdWithFiles, "testIdWithFiles").to.not.equal(undefined);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: testIdWithFiles!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: JSON.stringify([extrafilename, extrafilename2])
        }
      };
      log("postTest parsedForm with files prior testId", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        testIdWithFiles = body.testId;
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasS3File({
          filename: extrafilename,
          s3Folder,
          localDirectory: UNIT_TEST_FOLDER
        }).existsInS3()
        .then((existsInS3: boolean) => {
          expect(existsInS3, `PpaasS3File.existsInS3(${extrafilename})`).to.equal(true);
          done();
        }).catch((error) => {
          log("PpaasS3File existsInS3 error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // Now we pass in the prior files
    it("postTest with files prior testId one changed file should respond 200 Ok", (done: Mocha.Done) => {
      expect(testIdWithFiles, "testIdWithFiles").to.not.equal(undefined);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const parsedForm: ParsedForm = {
        files: {
          additionalFiles: createFileObject(NOT_YAML_FILEPATH)
        },
        fields: {
          ...basicFields,
          testId: testIdWithFiles!,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: extrafilename2
        }
      };
      log("postTest parsedForm with files prior testId", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        testIdWithFiles = body.testId;
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasS3File({
          filename: extrafilename,
          s3Folder,
          localDirectory: UNIT_TEST_FOLDER
        }).existsInS3()
        .then((existsInS3: boolean) => {
          expect(existsInS3, `PpaasS3File.existsInS3(${extrafilename})`).to.equal(true);
          done();
        }).catch((error) => {
          log("PpaasS3File existsInS3 error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId).to.not.equal(undefined);
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId: sharedPpaasTestId!.testId,
          yamlFile: BASIC_YAML_FILE,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.not.equal(undefined);
        expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
        // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
        expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(scheduleDate);
        // If this runs before the other acceptance tests populate the shared data
        sharedScheduledTestData = body;
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("PUT /schedule uses postTest", () => {
    it("postTest editSchedule no testId should respond 400 Bad Request", (done: Mocha.Done) => {
      log("postTest parsedForm editSchedule no testId", LogLevel.DEBUG, { basicParsedForm });
      TestManager.postTest(basicParsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("prior testId");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule no scheduleDate should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(sharedScheduledTestData, "sharedScheduledTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledTestData!.testId;
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: BASIC_YAML_FILE
        }
      };
      log("postTest parsedForm editSchedule no scheduleDate", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("scheduleDate");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule prior testId not a scheduled test should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(sharedPpaasTestId, "sharedPpaasTestId").to.not.equal(undefined);
      const testId: string = sharedPpaasTestId!.testId;
      const scheduleDate: number = Date.now() + 1600000;
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: BASIC_YAML_FILE,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm editSchedule not scheduled test", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("scheduled status");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule new date should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedScheduledTestData, "sharedScheduledTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledTestData!.testId;
      const s3Folder: string = sharedScheduledTestData!.s3Folder;
      sharedScheduledTestData = undefined; // Wipe it out since we're messing with it
      const scheduleDate: number = Date.now() + 1600000;
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: BASIC_YAML_FILE,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm editSchedule new date", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.equal(testId);
        expect(body.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        // Re-set this with the modified data
        sharedScheduledTestData = body;
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule new date missing hidden vars should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(sharedScheduledWithVarsTestData, "sharedScheduledWithVarsTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledWithVarsTestData!.testId;
      const scheduleDate: number = Date.now() + 1600000;
      const sameVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST2: "true"
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(sameVars),
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm with vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res missing hidden vars", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("missingEnvironmentVariables=TEST1");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule new date with vars should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedScheduledWithVarsTestData, "sharedScheduledWithVarsTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledWithVarsTestData!.testId;
      const s3Folder: string = sharedScheduledWithVarsTestData!.s3Folder;
      sharedScheduledWithVarsTestData = undefined; // Wipe it out since we're messing with it
      const scheduleDate: number = Date.now() + 1600000;
      const sameVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "true", hidden: true },
        TEST2: "true"
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(sameVars),
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm with vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.equal(testId);
        expect(body.s3Folder).to.equal(s3Folder);
        expect(body.status).to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        sharedScheduledWithVarsTestData = body;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables({ ...defaultEnvironmentVariables, ...sameVars }));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(defaultEnvironmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(defaultEnvironmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled with files should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedScheduledWithFilesTestData, "sharedScheduledWithFilesTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledWithFilesTestData!.testId;
      const s3Folder: string = sharedScheduledWithFilesTestData!.s3Folder;
      sharedScheduledWithFilesTestData = undefined; // Wipe it out since we're messing with it
      const scheduleDate: number = Date.now() + 600000;
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_FILES),
          additionalFiles: JSON.stringify([extrafilename, extrafilename2]),
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm with files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.equal(testId);
        expect(body.s3Folder).to.equal(s3Folder);
        expect(body.status).to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        sharedScheduledWithFilesTestData = body;
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule new files should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedScheduledTestData, "sharedScheduledTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledTestData!.testId;
      const s3Folder: string = sharedScheduledTestData!.s3Folder;
      sharedScheduledTestData = undefined; // Wipe it out since we're messing with it
      const scheduleDate: number = Date.now() + 2600000;
      const parsedForm: ParsedForm = {
        files: basicFiles,
        fields: {
          ...basicFields,
          testId,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.equal(testId);
        expect(body.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        // Re-set this with the new data
        sharedScheduledTestData = body;
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule change to recurring should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedScheduledWithVarsTestData, "sharedScheduledWithVarsTestData").to.not.equal(undefined);
      const testId: string = sharedScheduledWithVarsTestData!.testId;
      const s3Folder: string = sharedScheduledWithVarsTestData!.s3Folder;
      sharedScheduledWithVarsTestData = undefined; // Wipe it out since we're messing with it
      const scheduleDate: number = Date.now() + 600000;
      const endDate: number = Date.now() + (7 * 24 * 60 * 60000);
      const sameVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "true", hidden: true },
        TEST2: "true"
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(sameVars),
          scheduleDate: "" + scheduleDate,
          endDate: "" + endDate,
          daysOfWeek: JSON.stringify(everyDaysOfWeek)
        }
      };
      log("postTest parsedForm scheduled recurring", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.equal(testId);
        expect(body.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        // populate the shared data
        sharedRecurringWithVarsTestData = body;
        TestScheduler.getCalendarEvents().then((calendarEvents: EventInput[]) => {
          const event: EventInput | undefined = calendarEvents.find((value: EventInput) => value.id === body.testId);
          expect(event, "event found").to.not.equal(undefined);
          expect(event!.startRecur, "event.startRecur").to.equal(scheduleDate);
          expect(event!.daysOfWeek, "event.daysOfWeek").to.not.equal(undefined);
          expect(JSON.stringify(event!.daysOfWeek), "event.daysOfWeek").to.equal(JSON.stringify(everyDaysOfWeek));
          PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
          .then((s3Files) => {
            log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
            expect(s3Files, "s3Files").to.not.equal(undefined);
            // Should be 3. Yaml, status, vars
            expect(s3Files.length, "s3Files.length").to.equal(3);
            // Check that the test=true tag is removed and recurring=true is added
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [testTagKey, testTagValue]: [string, string] = s3.defaultTestFileTags().entries().next().value;
            const [recurringTagKey, recurringTagValue]: [string, string] = defaultRecurringFileTags().entries().next().value;
            expect(typeof testTagKey, "typeof tagKey").to.equal("string");
            for (const s3File of s3Files) {
              expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
              expect(s3File.tags?.get(testTagKey), `${s3File.filename}.tags?.get("${testTagKey}")`).to.equal(undefined);
              expect(s3File.tags?.get(recurringTagKey), `${s3File.filename}.tags?.get("${recurringTagKey}")`).to.equal(recurringTagValue);
            }
            done();
          }).catch((error) => {
            log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((error) => done(error));
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest editSchedule change to not recurring should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedRecurringWithVarsTestData, "sharedRecurringWithVarsTestData").to.not.equal(undefined);
      const testId: string = sharedRecurringWithVarsTestData!.testId;
      const s3Folder: string = sharedRecurringWithVarsTestData!.s3Folder;
      sharedRecurringWithVarsTestData = undefined; // Wipe it out since we're messing with it
      const scheduleDate: number = Date.now() + 600000;
      const sameVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "true", hidden: true },
        TEST2: "true"
      };
      const parsedForm: ParsedForm = {
        files: {},
        fields: {
          ...basicFields,
          testId,
          yamlFile: path.basename(BASIC_FILEPATH_WITH_ENV),
          environmentVariables: JSON.stringify(sameVars),
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled recurring", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER, true).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.equal(testId);
        expect(body.s3Folder, "s3Folder").to.equal(s3Folder);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        // If this runs before the other acceptance tests populate the shared data
        sharedScheduledWithVarsTestData = body;
        TestScheduler.getCalendarEvents().then((calendarEvents: EventInput[]) => {

          const event: EventInput | undefined = calendarEvents.find((value: EventInput) => value.id === body.testId);
          expect(event, "event found").to.not.equal(undefined);
          expect(event!.start, "event.start").to.equal(scheduleDate);
          expect(event!.startRecur, "event.startRecur").to.equal(undefined);
          expect(event!.daysOfWeek, "event.daysOfWeek").to.equal(undefined);
          PpaasS3File.getAllFilesInS3({ s3Folder: body.s3Folder, localDirectory: LOCAL_FILE_LOCATION })
          .then((s3Files) => {
            log("getAllFilesInS3 " + body.s3Folder, LogLevel.DEBUG, s3Files);
            expect(s3Files, "s3Files").to.not.equal(undefined);
            // Should be 3. Yaml, status, vars
            expect(s3Files.length, "s3Files.length").to.equal(3);
            // Check that the test=true tag is added and recurring=true is removed
            const [testTagKey, testTagValue]: [string, string] = s3.defaultTestFileTags().entries().next().value;
            const [tagKeyExtra, tagValueExtra]: [string, string] = s3.defaultTestExtraFileTags().entries().next().value;
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [recurringTagKey, recurringTagValue]: [string, string] = defaultRecurringFileTags().entries().next().value;
            expect(typeof testTagKey, "typeof tagKey").to.equal("string");
            for (const s3File of s3Files) {
              expect(s3File.tags, "s3File.tags").to.not.equal(undefined);
              if (isYamlFile(s3File.filename) || s3File.filename.endsWith(".info")) {
                expect(s3File.tags?.get(testTagKey), `${s3File.filename}.tags?.get("${testTagKey}")`).to.equal(testTagValue);
              } else {
                expect(s3File.tags?.get(tagKeyExtra), `${s3File.filename}.tags?.get("${tagKeyExtra}")`).to.equal(tagValueExtra);
              }
              expect(s3File.tags?.get(recurringTagKey), `${s3File.filename}.tags?.get("${recurringTagKey}")`).to.equal(undefined);
            }
            done();
          }).catch((error) => {
            log("getAllFilesInS3 tags error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((error) => done(error));
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

  });
  });
  describe("POST scripting files", () => {
    const scriptingFiles: Files = { yamlFile: createFileObject(SCRIPTING_FILEPATH) };
    const scriptingFields: Fields = { queueName };
    const scriptingParsedForm: ParsedForm = {
      files: scriptingFiles,
      fields: scriptingFields
    };
    before(() => {
      if (!queueName) {
        expect(sharedQueueNames, "sharedQueueNames").to.not.equal(undefined);
        expect(sharedQueueNames!.length, "sharedQueueNames.length").to.be.greaterThan(0);
        queueName = sharedQueueNames![0];
      }
      scriptingFields.queueName = queueName;
      expect(scriptingVersion, "scriptingVersion").to.not.equal(undefined);
      scriptingFields.version = scriptingVersion!;
      scriptingParsedForm.fields = scriptingFields;
      log("postTest sharedQueueNames", LogLevel.DEBUG, sharedQueueNames);
    });

  describe("POST /test new test", () => {
    it("postTest should respond 200 OK", (done: Mocha.Done) => {
      log("postTest parsedForm", LogLevel.DEBUG, { scriptingParsedForm });
      TestManager.postTest(scriptingParsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version latest should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: scriptingFiles,
        fields: {
          ...scriptingFields,
          version: latestPewPewVersion
        }
      };
      log("postTest parsedForm latest", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version scripting should respond 200 OK", (done: Mocha.Done) => {
      expect(scriptingVersion, "scriptingVersion").to.not.equal(undefined);
      log("postTest version, sharedPewPewVersions", LogLevel.DEBUG, { scriptingVersion, sharedPewPewVersions });
      const parsedForm: ParsedForm = {
        files: scriptingFiles,
        fields: {
          ...scriptingFields,
          version: scriptingVersion!
        }
      };
      log("postTest parsedForm scripting", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version legacy should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(legacyVersion, "legacyVersion").to.not.equal(undefined);
      const parsedForm: ParsedForm = {
        files: scriptingFiles,
        fields: {
          ...scriptingFields,
          version: legacyVersion!
        }
      };
      log("postTest parsedForm scripting as scripting", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("UnrecognizedKey");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with version bogus should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: scriptingFiles,
        fields: {
          ...scriptingFields,
          version: "bogus"
        }
      };
      log("postTest parsedForm bogus", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("invalid version");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with extra options should respond 200 OK", (done: Mocha.Done) => {
      const environmentVariables: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariables,
        NOT_NEEDED: { value: "true", hidden: false },
        ALSO_NOT_NEEDED: { value: "false", hidden: true }
      };
      const parsedForm: ParsedForm = {
        files: {
          ...scriptingFiles,
          additionalFiles: createFileObject(NOT_YAML_FILEPATH)
        },
        fields: {
          ...scriptingFields,
          restartOnFailure: "true",
          environmentVariables: JSON.stringify(environmentVariables)
        }
      };
      log("postTest parsedForm extra options", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables(environmentVariables));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(environmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(environmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing vars should respond 400 Bad Request", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(SCRIPTING_FILEPATH_WITH_ENV) },
        fields: scriptingFields
      };
      log("postTest parsedForm missing vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("failed to parse");
        expect(body.error).to.not.equal(undefined);
        expect(body.error).to.include("SERVICE_URL_AGENT");
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest missing files should respond 400 Bad Request", (done: Mocha.Done) => {
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH2);
      const parsedForm: ParsedForm = {
        files: {
          yamlFile: createFileObject(SCRIPTING_FILEPATH_WITH_FILES),
          additionalFiles: createFileObject(NOT_YAML_FILEPATH)
        },
        fields: scriptingFields
      };
      log("postTest parsedForm missing files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, res.json);
        const body: TestManagerError = res.json as TestManagerError;
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include(extrafilename);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with vars should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(SCRIPTING_FILEPATH_WITH_ENV) },
        fields: {
          ...scriptingFields,
          environmentVariables: JSON.stringify(defaultEnvironmentVariables)
        }
      };
      log("postTest parsedForm with vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables(defaultEnvironmentVariables));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(defaultEnvironmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(defaultEnvironmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with files should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: {
          yamlFile: createFileObject(SCRIPTING_FILEPATH_WITH_FILES),
          additionalFiles: [createFileObject(NOT_YAML_FILEPATH), createFileObject(NOT_YAML_FILEPATH2)] as any as File
        },
        fields: scriptingFields
      };
      log("postTest parsedForm with files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with no peak load should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(SCRIPTING_FILEPATH_NO_PEAK_LOAD) },
        fields: scriptingFields
      };
      log("postTest parsedForm no peak load", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest with headers_all should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(SCRIPTING_FILEPATH_HEADERS_ALL) },
        fields: scriptingFields
      };
      log("postTest parsedForm headers_all", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Created);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("POST /test scheduled", () => {
    it("postTest scheduled should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: scriptingFiles,
        fields: {
          ...scriptingFields,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.not.equal(undefined);
        expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
        // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
        expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(scheduleDate);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled with vars should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(SCRIPTING_FILEPATH_WITH_ENV) },
        fields: {
          ...scriptingFields,
          environmentVariables: JSON.stringify(defaultEnvironmentVariables),
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm scheduled with vars", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        const s3Folder = PpaasTestId.getFromTestId(body.testId).s3Folder;
        new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download(true)
        .then((ppaasEncryptEnvironmentFile: PpaasEncryptEnvironmentFile) => {
          const fileContents: string | undefined = ppaasEncryptEnvironmentFile.getFileContents();
          const expectedEnvironmentVariables = JSON.stringify(PpaasEncryptEnvironmentFile.filterEnvironmentVariables(defaultEnvironmentVariables));
          expect(fileContents, "PpaasEncryptEnvironmentFile fileContents").to.equal(expectedEnvironmentVariables);
          const variablesFile: EnvironmentVariablesFile | undefined = ppaasEncryptEnvironmentFile.getEnvironmentVariablesFile();
          expect(variablesFile).to.not.equal(undefined);
          if (variablesFile === undefined) { return; }
          expect(Object.keys(variablesFile).length, "Object.keys(variablesFile).length").to.equal(Object.keys(defaultEnvironmentVariables).length);
          for (const [variableName, variableValue] of Object.entries(defaultEnvironmentVariables)) {
            if (typeof variableValue === "string" || variableValue.hidden) {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify({ hidden: true }));
            } else {
              expect(JSON.stringify(variablesFile[variableName]), `variablesFile[${variableName}]`).to.equal(JSON.stringify(variableValue));
            }
          }
          done();
        }).catch((error) => {
          log("PpaasEncryptEnvironmentFile download error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled with files should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const parsedForm: ParsedForm = {
        files: {
          yamlFile: createFileObject(SCRIPTING_FILEPATH_WITH_FILES),
          additionalFiles: [createFileObject(NOT_YAML_FILEPATH), createFileObject(NOT_YAML_FILEPATH2)] as any as File
        },
        fields: {
          ...scriptingFields,
          scheduleDate: "" + scheduleDate
        }
      };
      log("postTest parsedForm with files", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.testId).to.not.equal(undefined);
        expect(body.s3Folder).to.not.equal(undefined);
        expect(body.status).to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        done();
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postTest scheduled recurring should respond 200 OK", (done: Mocha.Done) => {
      const scheduleDate: number = Date.now() + 600000;
      const endDate: number = Date.now() + (7 * 24 * 60 * 60000);
      const parsedForm: ParsedForm = {
        files: scriptingFiles,
        fields: {
          ...scriptingFields,
          scheduleDate: "" + scheduleDate,
          endDate: "" + endDate,
          daysOfWeek: JSON.stringify(everyDaysOfWeek)
        }
      };
      log("postTest parsedForm scheduled recurring", LogLevel.DEBUG, { parsedForm });
      TestManager.postTest(parsedForm, authAdmin, UNIT_TEST_FOLDER).then((res: ErrorResponse | TestDataResponse) => {
        log("postTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestData = res.json as TestData;
        log("body: " + JSON.stringify(res.json), LogLevel.DEBUG, body);
        expect(body, "body").to.not.equal(undefined);
        expect(body.testId, "testId").to.not.equal(undefined);
        expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(body.status, "status").to.equal(TestStatus.Scheduled);
        expect(body.userId).to.equal(authAdmin.userId);
        expect(body.startTime, "startTime").to.equal(scheduleDate);
        expect(body.endTime, "endTime").to.be.greaterThan(scheduleDate);
        const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
        // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
        expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(scheduleDate);
        // If this runs before the other acceptance tests populate the shared data
        TestScheduler.getCalendarEvents().then((calendarEvents: EventInput[]) => {

          const event: EventInput | undefined = calendarEvents.find((value: EventInput) => value.id === body.testId);
          expect(event, "event found").to.not.equal(undefined);
          expect(event!.startRecur, "event.startRecur").to.equal(scheduleDate);
          expect(event!.daysOfWeek, "event.daysOfWeek").to.not.equal(undefined);
          expect(JSON.stringify(event!.daysOfWeek), "event.daysOfWeek").to.equal(JSON.stringify(everyDaysOfWeek));
          done();
        }).catch((error) => done(error));
      }).catch((error) => {
        log("postTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

  });
  });
  });

  describe("GET /test", () => {
    it("getAllTest should respond 200 OK", (done: Mocha.Done) => {
      try {
        const res: AllTestsResponse = TestManager.getAllTest();
        log("GET /test response", LogLevel.DEBUG, res);
        expect(res).to.not.equal(undefined);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        log("tests: " + res.json, LogLevel.DEBUG, res.json);
        const tests: AllTests = res.json;
        expect(tests.runningTests).to.not.equal(undefined);
        expect(Array.isArray(tests.runningTests)).to.equal(true);
        expect(tests.recentTests).to.not.equal(undefined);
        expect(Array.isArray(tests.recentTests)).to.equal(true);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("getTest invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      TestManager.getTest("invalid").then((res: ErrorResponse | TestDataResponse) => {
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("getTest validButNotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
      const validButNotInS3: string = PpaasTestId.makeTestId("validButNotInS3").testId;
      log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      TestManager.getTest(validButNotInS3).then((res: ErrorResponse | TestDataResponse) => {
        expect(res.status, JSON.stringify(res.json)).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    describe("GET /test populated", () => {
      afterEach ( () => {
        try {
          const res: AllTestsResponse = TestManager.getAllTest();
          log("GET /test response", LogLevel.DEBUG, res);
          expect(res).to.not.equal(undefined);
          expect(res.status, JSON.stringify(res.json)).to.equal(200);
          log("tests: " + res.json, LogLevel.DEBUG, res.json);
          const tests: AllTests = res.json;
          log("tests: " + tests, LogLevel.DEBUG, tests);
          expect(tests.runningTests).to.not.equal(undefined);
          expect(Array.isArray(tests.runningTests)).to.equal(true);
          expect(tests.recentTests).to.not.equal(undefined);
          expect(Array.isArray(tests.recentTests)).to.equal(true);
          // Requested should have at least one now
          expect(tests.runningTests.length + tests.recentTests.length, "tests.runningTests.length + tests.recentTests.length").to.be.greaterThan(0);
        } catch (error) {
          log("afterEach error", LogLevel.ERROR, error);
          throw error;
        }
      });

      it("getTest validInS3 should respond 200 OK", (done: Mocha.Done) => {
        expect(sharedPpaasTestId).to.not.equal(undefined);
        const testId = sharedPpaasTestId!.testId;
        log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
        TestManager.getTest(testId).then((res: ErrorResponse | TestDataResponse) => {
          log ("validInS3 response", LogLevel.DEBUG, res);
          expect(res.status, JSON.stringify(res.json)).to.equal(200);
          const test: TestData = res.json as TestData;
          log("tests: " + test, LogLevel.DEBUG, test);
          expect(test.testId).to.not.equal(undefined);
          expect(test.s3Folder).to.not.equal(undefined);
          expect(test.startTime).to.not.equal(undefined);
          expect(test.status).to.not.equal(undefined);
          done();
        }).catch((error) => done(error));
      });
    });
  });

  describe("GET /test?newTest", () => {
    it("getPreviousTestData invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      TestManager.getPreviousTestData("invalid").then((res: ErrorResponse | PreviousTestDataResponse) => {
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("getPreviousTestData validButNotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
      const validButNotInS3: string = PpaasTestId.makeTestId("validButNotInS3").testId;
      log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      TestManager.getPreviousTestData(validButNotInS3).then((res: ErrorResponse | PreviousTestDataResponse) => {
        expect(res.status, JSON.stringify(res.json)).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    it("getPreviousTestData validInS3 should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId).to.not.equal(undefined);
      const testId = sharedPpaasTestId!.testId;
      log("getPreviousTestData validInS3 testId: " + testId, LogLevel.DEBUG, testId);
      TestManager.getPreviousTestData(testId).then((res: ErrorResponse | PreviousTestDataResponse) => {
        log ("getPreviousTestData validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const test: PreviousTestData = res.json as PreviousTestData;
        log("tests: " + test, LogLevel.DEBUG, test);
        expect(test.testId, "testId").to.equal(testId);
        expect(test.s3Folder, "s3Folder").to.equal(sharedPpaasTestId!.s3Folder);
        expect(test.yamlFile, "yamlFile").to.equal(BASIC_YAML_FILE);
        expect(test.queueName, "queueName").to.equal(queueName);
        expect(test.additionalFiles, "additionalFiles").to.equal(undefined);
        expect(test.version, "version").to.equal(latestPewPewVersion);
        expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
        expect(Object.keys(test.environmentVariables).length, "environmentVariables.length: " + Object.keys(test.environmentVariables)).to.equal(0);
        expect(test.restartOnFailure, "restartOnFailure").to.equal(undefined);
        expect(test.bypassParser, "bypassParser").to.equal(undefined);
        expect(test.scheduleDate, "scheduleDate").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("getPreviousTestData scheduledInS3 should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedScheduledTestData).to.not.equal(undefined);
      const testId = sharedScheduledTestData!.testId;
      log("getPreviousTestData scheduledInS3 testId: " + testId, LogLevel.DEBUG, testId);
      TestManager.getPreviousTestData(testId).then((res: ErrorResponse | PreviousTestDataResponse) => {
        log ("getPreviousTestData scheduledInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const test: PreviousTestData = res.json as PreviousTestData;
        log("tests: " + test, LogLevel.DEBUG, test);
        expect(test.testId, "testId").to.equal(testId);
        expect(test.s3Folder, "s3Folder").to.equal(sharedScheduledTestData!.s3Folder);
        expect(test.yamlFile, "yamlFile").to.equal(BASIC_YAML_FILE);
        expect(test.queueName, "queueName").to.equal(queueName);
        expect(test.additionalFiles, "additionalFiles").to.equal(undefined);
        expect(test.version, "version").to.equal(latestPewPewVersion);
        expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
        expect(Object.keys(test.environmentVariables).length, "environmentVariables.length: " + Object.keys(test.environmentVariables)).to.equal(0);
        expect(test.restartOnFailure, "restartOnFailure").to.equal(false);
        expect(test.bypassParser, "bypassParser").to.equal(undefined);
        expect(test.scheduleDate, "scheduleDate").to.not.equal(undefined);
        expect(test.scheduleDate, "scheduleDate").to.be.greaterThan(Date.now());
        done();
      }).catch((error) => done(error));
    });

    it("getPreviousTestData with version should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithVersion).to.not.equal(undefined);
      const testId = testIdWithVersion!;
      log("getPreviousTestData validInS3 testId: " + testId, LogLevel.DEBUG, testId);
      TestManager.getPreviousTestData(testId).then((res: ErrorResponse | PreviousTestDataResponse) => {
        log ("getPreviousTestData validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const test: PreviousTestData = res.json as PreviousTestData;
        log("tests: " + test, LogLevel.DEBUG, test);
        expect(test.testId, "testId").to.equal(testId);
        expect(test.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(test.yamlFile, "yamlFile").to.equal(BASIC_YAML_FILE);
        expect(test.queueName, "queueName").to.equal(queueName);
        expect(test.additionalFiles, "additionalFiles").to.equal(undefined);
        expect(test.version, "version").to.equal(legacyVersion);
        expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
        expect(Object.keys(test.environmentVariables).length, "environmentVariables.length: " + Object.keys(test.environmentVariables)).to.equal(0);
        expect(test.restartOnFailure, "restartOnFailure").to.equal(undefined);
        expect(test.bypassParser, "bypassParser").to.equal(undefined);
        expect(test.scheduleDate, "scheduleDate").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("getPreviousTestData with vars should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv).to.not.equal(undefined);
      const testId = testIdWithEnv!;
      log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
      TestManager.getPreviousTestData(testId).then((res: ErrorResponse | PreviousTestDataResponse) => {
        log ("validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const test: PreviousTestData = res.json as PreviousTestData;
        log("tests: " + test, LogLevel.DEBUG, test);
        expect(test.testId, "testId").to.equal(testId);
        expect(test.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(test.yamlFile, "yamlFile").to.equal(path.basename(BASIC_FILEPATH_WITH_ENV));
        expect(test.queueName, "queueName").to.equal(queueName);
        expect(test.additionalFiles, "additionalFiles").to.equal(undefined);
        expect(test.version, "version").to.equal(latestPewPewVersion);
        expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
        expect(Object.keys(test.environmentVariables).length, "environmentVariables.length: " + Object.keys(test.environmentVariables)).to.be.greaterThan(0);
        expect(test.restartOnFailure, "restartOnFailure").to.equal(undefined);
        expect(test.bypassParser, "bypassParser").to.equal(undefined);
        expect(test.scheduleDate, "scheduleDate").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });

    it("getPreviousTestData with files should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithFiles).to.not.equal(undefined);
      const testId = testIdWithFiles!;
      log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
      TestManager.getPreviousTestData(testId).then((res: ErrorResponse | PreviousTestDataResponse) => {
        log ("validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const test: PreviousTestData = res.json as PreviousTestData;
        log("tests: " + test, LogLevel.DEBUG, test);
        expect(test.testId, "testId").to.equal(testId);
        expect(test.s3Folder, "s3Folder").to.not.equal(undefined);
        expect(test.yamlFile, "yamlFile").to.equal(path.basename(BASIC_FILEPATH_WITH_FILES));
        expect(test.queueName, "queueName").to.equal(queueName);
        expect(test.additionalFiles, "additionalFiles").to.not.equal(undefined);
        expect(test.additionalFiles!.length, "additionalFiles.length").to.be.greaterThan(1);
        expect(test.version, "version").to.equal(latestPewPewVersion);
        expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
        expect(Object.keys(test.environmentVariables).length, "environmentVariables.length: " + Object.keys(test.environmentVariables)).to.equal(0);
        expect(test.restartOnFailure, "restartOnFailure").to.equal(undefined);
        expect(test.bypassParser, "bypassParser").to.equal(undefined);
        expect(test.scheduleDate, "scheduleDate").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("PUT /test", () => {
    it("putTest basic should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedTestData).to.not.equal(undefined);
      const testId = sharedTestData!.testId;
      expect(testId).to.not.equal(undefined);
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH) },
        fields: { testId }
      };
      log("parsedForm", LogLevel.DEBUG, parsedForm);
      TestManager.putTest(parsedForm, authAdmin).then((res: ErrorResponse | MessageResponse) => {
        log("putTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        done();
      }).catch((error) => {
        log("putTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("putTest with environment variables should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv).to.not.equal(undefined);
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH_WITH_ENV) },
        fields: { testId: testIdWithEnv! }
      };
      log("parsedForm", LogLevel.DEBUG, parsedForm);
      TestManager.putTest(parsedForm, authAdmin).then((res: ErrorResponse | MessageResponse) => {
        log("putTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        done();
      }).catch((error) => {
        log("putTest error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("putTest with wrong yaml file should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const parsedForm: ParsedForm = {
        files: { yamlFile: createFileObject(BASIC_FILEPATH) },
        fields: { testId: testIdWithEnv! }
      };
      log("parsedForm", LogLevel.DEBUG, parsedForm);
      TestManager.putTest(parsedForm, authAdmin).then((res: ErrorResponse | MessageResponse) => {
        log("putTest res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(400);
        done();
      }).catch((error) => {
        log("putTest error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
