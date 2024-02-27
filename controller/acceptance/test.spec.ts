import {
  API_TEST,
  AllTests,
  EnvironmentVariablesFile,
  FileData,
  FormDataPost,
  FormDataPut,
  PreviousTestData,
  TestData,
  TestManagerError
} from "../types";
import { LogLevel, PpaasTestId, TestStatus, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import FormData from "form-data";
import { createReadStream } from "fs";
import { expect } from "chai";
import { getPewPewVersions } from "./pewpew.spec";
import { getQueueNames } from "./queues.spec";
import { latestPewPewVersion } from "../pages/api/util/clientutil";
import path from "path";

async function fetch (
  url: string,
  config?: AxiosRequestConfig
): Promise<Response> {
  try {
    const response: Response = await _axios({
      method: config?.method || "get",
      url,
      maxRedirects: 0,
      validateStatus: (status) => status < 500, // Resolve only if the status code is less than 500
      ...(config || {})
    });
    return response;
  } catch (error) {
    throw error;
  }
}

// Re-create these here so we don't have to run yamlparser.spec by importing it
const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
export const BASIC_FILEPATH = path.join(UNIT_TEST_FOLDER, "basic.yaml");
const BASIC_FILEPATH_WITH_ENV = path.join(UNIT_TEST_FOLDER, "basicwithenv.yaml");
const BASIC_FILEPATH_WITH_FILES = path.join(UNIT_TEST_FOLDER, "basicwithfiles.yaml");
const BASIC_FILEPATH_NO_PEAK_LOAD = path.join(UNIT_TEST_FOLDER, "basicnopeakload.yaml");
const BASIC_FILEPATH_HEADERS_ALL = path.join(UNIT_TEST_FOLDER, "basicheadersall.yaml");
export const SCRIPTING_FILEPATH = path.join(UNIT_TEST_FOLDER, "scripting.yaml");
const SCRIPTING_FILEPATH_WITH_ENV = path.join(UNIT_TEST_FOLDER, "scriptingwithenv.yaml");
const SCRIPTING_FILEPATH_WITH_FILES = path.join(UNIT_TEST_FOLDER, "scriptingwithfiles.yaml");
const SCRIPTING_FILEPATH_NO_PEAK_LOAD = path.join(UNIT_TEST_FOLDER, "scriptingnopeakload.yaml");
const SCRIPTING_FILEPATH_HEADERS_ALL = path.join(UNIT_TEST_FOLDER, "scriptingheadersall.yaml");
const NOT_YAML_FILEPATH = path.join(UNIT_TEST_FOLDER, "text.txt");
const NOT_YAML_FILEPATH2 = path.join(UNIT_TEST_FOLDER, "text2.txt");
const ZIP_TEST_DIR_PATH: string = path.join(UNIT_TEST_FOLDER, "testdir.zip");
const ZIP_TEST_FILES_PATH: string = path.join(UNIT_TEST_FOLDER, "testfiles.zip");
const ZIP_TEST_FILES_11_PATH: string = path.join(UNIT_TEST_FOLDER, "testfiles11.zip");
const ZIP_TEST_INVALID_PATH: string = path.join(UNIT_TEST_FOLDER, "testinvalid.zip");
const ZIP_TEST_YAML_PATH: string = path.join(UNIT_TEST_FOLDER, "testyaml.zip");
const ZIP_TEST_YAML_ENV_PATH: string = path.join(UNIT_TEST_FOLDER, "testyamlenv.zip");
const ZIP_TEST_YAMLS_PATH: string = path.join(UNIT_TEST_FOLDER, "testyamls.zip");
/** Environment variables that will be posted from the client on re-run */
const defaultEnvironmentVariablesFromPrior: EnvironmentVariablesFile = {
  SERVICE_URL_AGENT: { value: "127.0.0.1:8080", hidden: false }
};
const defaultEnvironmentVariables: EnvironmentVariablesFile = {
  ...defaultEnvironmentVariablesFromPrior,
  TEST1: { value: "true", hidden: true },
  TEST2: "true"
};

// Beanstalk	<SYSTEM_NAME>_<SERVICE_NAME>_URL
export const integrationUrl = "http://" + (process.env.BUILD_APP_URL || `localhost:${process.env.PORT || "8081"}`);

let sharedPpaasTestId: PpaasTestId | undefined;
let sharedTestData: TestData | undefined;
let sharedScheduledTestData: TestData | undefined;

function appendFileData (formData: FormData, formName: string, fileData: string | FileData) {
  if (typeof fileData === "string") {
    formData.append(formName, fileData);
  } else {
    formData.append(formName, fileData.value, fileData.options);
  }
}

function convertFormDataPostToFormData (formDataPost: Partial<FormDataPost>): FormData {
  const formData: FormData = new FormData();
  // yamlFile: FileData | string;
  if (formDataPost.yamlFile) {
    appendFileData(formData, "yamlFile", formDataPost.yamlFile);
  }
  // additionalFiles?: FileData | string | (FileData | string)[];
  if (formDataPost.additionalFiles) {
    if (Array.isArray(formDataPost.additionalFiles)) {
      for (const additionalFile of formDataPost.additionalFiles) {
        appendFileData(formData, "additionalFiles", additionalFile);
      }
    } else {
      appendFileData(formData, "additionalFiles", formDataPost.additionalFiles);
    }
  }
  // queueName: string;
  formData.append("queueName", formDataPost.queueName);
  // testId?: string;
  if (formDataPost.testId) { formData.append("testId", formDataPost.testId); }
  // environmentVariables?: string;
  if (formDataPost.environmentVariables !== undefined) { formData.append("environmentVariables", formDataPost.environmentVariables); }
  // version?: string;
  if (formDataPost.version !== undefined) { formData.append("version", formDataPost.version); }
  // restartOnFailure?: "true" | "false";
  if (formDataPost.restartOnFailure !== undefined) { formData.append("restartOnFailure", formDataPost.restartOnFailure); }
  // scheduleDate?: number;
  if (formDataPost.scheduleDate !== undefined) { formData.append("scheduleDate", formDataPost.scheduleDate); }
  // daysOfWeek?: number | number[] | string;
  if (formDataPost.daysOfWeek !== undefined) { formData.append("daysOfWeek", formDataPost.daysOfWeek); }
  // endDate?: number;
  if (formDataPost.endDate !== undefined) { formData.append("endDate", formDataPost.endDate); }

  return formData;
}

function convertFormDataPutToFormData (formDataPut: FormDataPut): FormData {
  const formData: FormData = new FormData();
  // yamlFile: FileData | string;
  appendFileData(formData, "yamlFile", formDataPut.yamlFile);
  formData.append("testId", formDataPut.testId);
  return formData;
}

export async function getPpaasTestId (): Promise<PpaasTestId> {
  if (sharedPpaasTestId) { return sharedPpaasTestId; }
  await initSharedTestData();
  return sharedPpaasTestId!;
}

export async function getTestData (): Promise<TestData> {
  if (sharedTestData) { return sharedTestData; }
  await initSharedTestData();
  return sharedTestData!;
}

export async function getScheduledTestData (): Promise<TestData> {
  if (sharedScheduledTestData) { return sharedScheduledTestData; }
  await initSharedScheduledTestData();
  return sharedScheduledTestData!;
}

export function unsetScheduledTestData (): void {
  sharedScheduledTestData = undefined;
}

async function initSharedTestData (): Promise<void> {
  if (sharedPpaasTestId && sharedTestData) { return; }
  const url: string = integrationUrl + API_TEST;
  log("smoke tests url=" + url, LogLevel.DEBUG);
  try {
    const queueNames: string[] = await getQueueNames();
    const filename: string = path.basename(BASIC_FILEPATH);
    log("POST /test queueNames", LogLevel.DEBUG, queueNames);
    const formData: FormDataPost = {
      yamlFile: {
        value: createReadStream(BASIC_FILEPATH),
        options: { filename }
      },
      queueName: queueNames[0]
    };
    const data = convertFormDataPostToFormData(formData);
    const headers = data.getHeaders();
    log("POST formData", LogLevel.DEBUG, { test: formData, headers });
    const res: Response = await fetch(url, {
      method: "POST",
      data,
      headers
    });
    log("POST /test res", LogLevel.DEBUG, res);
    const bodyText = JSON.stringify(res.data);
    expect(res.status, bodyText).to.equal(200);
    const body: TestData = res.data;
    log("body: " + bodyText, LogLevel.DEBUG, body);
    expect(body).to.not.equal(undefined);
    expect(body.testId, "testId").to.not.equal(undefined);
    expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
    expect(typeof body.testId, "typeof testId").to.equal("string");
    expect(typeof body.s3Folder, "typeof s3Folder").to.equal("string");
    expect(body.status).to.equal(TestStatus.Created);
    sharedTestData = body;
    sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
  } catch (error) {
    log("POST /test error", LogLevel.ERROR, error);
    throw error;
  }
}

async function initSharedScheduledTestData (): Promise<void> {
  if (sharedScheduledTestData) { return; }
  const url: string = integrationUrl + API_TEST;
  log("smoke tests url=" + url, LogLevel.DEBUG);
  try {
    const queueNames: string[] = await getQueueNames();
    const filename: string = path.basename(BASIC_FILEPATH);
    log("POST /test queueNames", LogLevel.DEBUG, queueNames);
    const formData: FormDataPost = {
      yamlFile: {
        value: createReadStream(BASIC_FILEPATH),
        options: { filename }
      },
      queueName: queueNames[0],
      scheduleDate: Date.now() + 600000
    };
    const data = convertFormDataPostToFormData(formData);
    const headers = data.getHeaders();
    log("POST formData", LogLevel.DEBUG, { test: formData, headers });
    const res: Response = await fetch(url, {
      method: "POST",
      data,
      headers
    });
    log("POST /test res", LogLevel.DEBUG, res);
    const bodyText = JSON.stringify(res.data);
    expect(res.status, bodyText).to.equal(200);
    const body: TestData = res.data;
    log("body: " + bodyText, LogLevel.DEBUG, body);
    expect(body).to.not.equal(undefined);
    expect(body.testId, "testId").to.not.equal(undefined);
    expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
    expect(typeof body.testId, "typeof testId").to.equal("string");
    expect(typeof body.s3Folder, "typeof s3Folder").to.equal("string");
    expect(body.status).to.equal(TestStatus.Scheduled);
    sharedScheduledTestData = body;
  } catch (error) {
    log("POST /test error", LogLevel.ERROR, error);
    throw error;
  }
}

describe("Test API Integration", () => {
  const basicFilepath: string = BASIC_FILEPATH;
  const basicFilepathWithEnv: string = BASIC_FILEPATH_WITH_ENV;
  let testIdWithEnv: string | undefined;
  let testIdWithFiles: string | undefined;
  let testIdWithVersion: string | undefined;
  let url: string;
  let queueName: string = "unittests";
  let legacyVersion: string;
  let scriptingVersion: string;

  before(async () => {
    url = integrationUrl + API_TEST;
    log("smoke tests url=" + url, LogLevel.DEBUG);
    const sharedQueueNames = await getQueueNames();
    const sharedPewPewVersions = await getPewPewVersions();
    expect(sharedQueueNames, "sharedQueueNames").to.not.equal(undefined);
    expect(sharedQueueNames!.length, "sharedQueueNames.length").to.be.greaterThan(0);
    queueName = sharedQueueNames[0];
    log("queueName", LogLevel.DEBUG, { queueName });
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
  });

  describe("POST /test", () => {
    before(() => getQueueNames());

    describe("legacy tests", () => {
    it("POST /test should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          // testId = body.testId;
          // If this runs before the other acceptance tests populate the shared data
          sharedTestData = body;
          sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with version latest should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        version: latestPewPewVersion,
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          // testId = body.testId;
          // If this runs before the other acceptance tests populate the shared data
          sharedTestData = body;
          sharedPpaasTestId = PpaasTestId.getFromTestId(body.testId);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with version legacy should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const environmentVariables: EnvironmentVariablesFile = {
        PROFILE: { value: "version", hidden: false }
      };
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        version: legacyVersion,
        environmentVariables: JSON.stringify(environmentVariables),
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          testIdWithVersion = body.testId;
          // We can't use this for shared since it has version different
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with version bogus should respond 400 Bad Request", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        version: "bogus",
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("invalid version");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with version scripting should respond 400 Bad Request", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        version: scriptingVersion,
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("failed to parse");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with extra options should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const environmentVariables: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariables,
        NOT_NEEDED: { value: "true", hidden: false },
        ALSO_NOT_NEEDED: { value: "false", hidden: true }
      };
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        restartOnFailure: "true",
        environmentVariables: JSON.stringify(environmentVariables),
        additionalFiles: [{
          value: createReadStream(NOT_YAML_FILEPATH),
          options: { filename: path.basename(NOT_YAML_FILEPATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test missing vars should respond 400 Bad Request", (done: Mocha.Done) => {
      const filepath: string = basicFilepathWithEnv;
      const filename: string = path.basename(filepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(filepath),
          options: { filename }
        },
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("SERVICE_URL_AGENT");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test missing files should respond 400 Bad Request", (done: Mocha.Done) => {
      const filepath: string = BASIC_FILEPATH_WITH_FILES;
      const filename: string = path.basename(filepath);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(filepath),
          options: { filename }
        },
        queueName,
        additionalFiles: [{
          value: createReadStream(NOT_YAML_FILEPATH),
          options: { filename: extrafilename }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include(extrafilename2);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with vars should respond 200 OK", (done: Mocha.Done) => {
      const filepath: string = basicFilepathWithEnv;
      const filename: string = path.basename(filepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(filepath),
          options: { filename }
        },
        queueName,
        environmentVariables: JSON.stringify(defaultEnvironmentVariables)
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          testIdWithEnv = body.testId;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with files should respond 200 OK", (done: Mocha.Done) => {
      const filepath: string = BASIC_FILEPATH_WITH_FILES;
      const filename: string = path.basename(filepath);
      const extrafilepath: string = NOT_YAML_FILEPATH;
      const extrafilename: string = path.basename(extrafilepath);
      const extrafilepath2: string = NOT_YAML_FILEPATH2;
      const extrafilename2: string = path.basename(extrafilepath2);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(filepath),
          options: { filename }
        },
        queueName,
        additionalFiles: [{
          value: createReadStream(extrafilepath),
          options: { filename: extrafilename }
        },{
          value: createReadStream(extrafilepath2),
          options: { filename: extrafilename2 }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          testIdWithFiles = body.testId;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with no peak load should respond 200 OK", (done: Mocha.Done) => {
      const filepath: string = BASIC_FILEPATH_NO_PEAK_LOAD;
      const filename: string = path.basename(filepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(filepath),
          options: { filename }
        },
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with headers_all should respond 200 OK", (done: Mocha.Done) => {
      const filepath: string = BASIC_FILEPATH_HEADERS_ALL;
      const filename: string = path.basename(filepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(filepath),
          options: { filename }
        },
        queueName
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with zip yaml with vars should response 200 OK", (done: Mocha.Done) => {
      const environmentVariables: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariables,
        NOT_NEEDED: { value: "true", hidden: false },
        ALSO_NOT_NEEDED: { value: "false", hidden: true }
      };
      const formData: Partial<FormDataPost> = {
        queueName,
        restartOnFailure: "true",
        environmentVariables: JSON.stringify(environmentVariables),
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_YAML_ENV_PATH),
          options: { filename: path.basename(ZIP_TEST_YAML_ENV_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test zip yaml missing vars should respond 400 Bad Request", (done: Mocha.Done) => {
      const formData: Partial<FormDataPost> = {
        queueName,
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_YAML_ENV_PATH),
          options: { filename: path.basename(ZIP_TEST_YAML_ENV_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("SERVICE_URL_AGENT");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test yaml and zip yaml should respond 400 Bad Request", (done: Mocha.Done) => {
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename: path.basename(basicFilepath) }
        },
        queueName,
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_YAML_PATH),
          options: { filename: path.basename(ZIP_TEST_YAML_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("Received multiple yamlFiles");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test zip yaml multiple yaml missing vars should respond 400 Bad Request", (done: Mocha.Done) => {
      const formData: Partial<FormDataPost> = {
        queueName,
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_YAMLS_PATH),
          options: { filename: path.basename(ZIP_TEST_YAMLS_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("Received multiple yamlFiles");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with zip yaml and zip files should respond 200 OK", (done: Mocha.Done) => {
      const formData: Partial<FormDataPost> = {
        queueName,
        restartOnFailure: "true",
        environmentVariables: JSON.stringify({
          ...defaultEnvironmentVariables,
          NOT_NEEDED: { value: "true", hidden: false },
          ALSO_NOT_NEEDED: { value: "false", hidden: true }
        }),
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_YAML_ENV_PATH),
          options: { filename: path.basename(ZIP_TEST_YAML_ENV_PATH) }
        },
        {
          value: createReadStream(ZIP_TEST_FILES_PATH),
          options: { filename: path.basename(ZIP_TEST_FILES_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with yaml and zip files should respond 200 OK", (done: Mocha.Done) => {
      const filePath = BASIC_FILEPATH_WITH_FILES;
      const formData: Partial<FormDataPost> = {
        yamlFile: {
          value: createReadStream(filePath),
          options: { filename: path.basename(filePath) }
        },
        queueName,
        restartOnFailure: "true",
        environmentVariables: JSON.stringify({ NOT_NEEDED: "true", ALSO_NOT_NEEDED: "false" }),
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_FILES_PATH),
          options: { filename: path.basename(ZIP_TEST_FILES_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.testId).to.not.equal(undefined);
          expect(body.s3Folder).to.not.equal(undefined);
          expect(body.status).to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test invalid zip should respond 400 Bad Request", (done: Mocha.Done) => {
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename: path.basename(basicFilepath) }
        },
        queueName,
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_INVALID_PATH),
          options: { filename: path.basename(ZIP_TEST_INVALID_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("End of central directory record signature not found");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test directory zip should respond 400 Bad Request", (done: Mocha.Done) => {
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename: path.basename(basicFilepath) }
        },
        queueName,
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_DIR_PATH),
          options: { filename: path.basename(ZIP_TEST_DIR_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("Zip files with directories are not supported");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test over 10 zip should respond 400 Bad Request", (done: Mocha.Done) => {
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename: path.basename(basicFilepath) }
        },
        queueName,
        additionalFiles: [{
          value: createReadStream(ZIP_TEST_FILES_11_PATH),
          options: { filename: path.basename(ZIP_TEST_FILES_11_PATH) }
        }]
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("has more than 10 files");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        scheduleDate: Date.now() + 600000
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Scheduled);
          expect(body.startTime, "startTime").to.equal(formData.scheduleDate);
          expect(body.endTime, "endTime").to.be.greaterThan(formData.scheduleDate!);
          const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
          // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
          expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(formData.scheduleDate);
          // If this runs before the other acceptance tests populate the shared data
          sharedScheduledTestData = body;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled in the past should respond 400 Bad Request", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        scheduleDate: Date.now() - 600000
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          const body: TestManagerError = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.message).to.not.equal(undefined);
          expect(body.message).to.include("Could not addTest");
          expect(body.error).to.not.equal(undefined);
          expect(body.error).to.include("past");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled in the invalid date should respond 400 Bad Request", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: Omit<FormDataPost, "scheduleDate"> & { scheduleDate: string } = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        scheduleDate: "bad"
      };
      const data = convertFormDataPostToFormData(formData as any);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          const body: TestManagerError = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.message).to.not.equal(undefined);
          expect(body.message).to.include("invalid scheduleDate");
          expect(body.error).to.not.equal(undefined);
          expect(body.error).to.include("not a number");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled recurring should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        scheduleDate: Date.now() + 600000,
        endDate: Date.now() + (7 * 24 * 60 * 60000),
        daysOfWeek: JSON.stringify([0,1,2,3,4,5,6])
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Scheduled);
          expect(body.startTime, "startTime").to.equal(formData.scheduleDate);
          expect(body.endTime, "endTime").to.be.greaterThan(formData.scheduleDate!);
          const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
          // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
          expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(formData.scheduleDate);
          // If this runs before the other acceptance tests populate the shared data
          sharedScheduledTestData = body;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled recurring no endDate should respond 400 Bad Request", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        scheduleDate: Date.now() + 600000,
        daysOfWeek: JSON.stringify([0,1,2,3,4,5,6])
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          const body: TestManagerError = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.message).to.not.equal(undefined);
          expect(body.message).to.include("both daysOfWeek and endDate");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled recurring no daysOfWeek should respond 400 Bad Request", (done: Mocha.Done) => {
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename }
        },
        queueName,
        scheduleDate: Date.now() + 600000,
        endDate: Date.now() + 6000000
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          const body: TestManagerError = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body).to.not.equal(undefined);
          expect(body.message).to.not.equal(undefined);
          expect(body.message).to.include("both daysOfWeek and endDate");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId, "sharedPpaasTestId").to.not.equal(undefined);
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: filename,
        queueName,
        testId: sharedPpaasTestId!.testId
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData prior testId", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(sharedPpaasTestId!.testId);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Created);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test missing hidden vars and prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const filename: string = path.basename(basicFilepathWithEnv);
      const changedVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST2: "false"
      };
      const formData: FormDataPost = {
        yamlFile: filename,
        queueName,
        environmentVariables: JSON.stringify(changedVars),
        testId: testIdWithEnv!
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData with vars and prior testId", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("TEST1");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test missing legacy vars and prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const filename: string = path.basename(basicFilepathWithEnv);
      const changedVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "false", hidden: true }
      };
      const formData: FormDataPost = {
        yamlFile: filename,
        queueName,
        environmentVariables: JSON.stringify(changedVars),
        testId: testIdWithEnv!
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData with vars and prior testId", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include("TEST2");
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test with vars and prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv, "testIdWithEnv").to.not.equal(undefined);
      const filename: string = path.basename(basicFilepathWithEnv);
      const changedVars: EnvironmentVariablesFile = {
        ...defaultEnvironmentVariablesFromPrior,
        TEST1: { value: "false", hidden: true },
        TEST2: "false"
      };
      const formData: FormDataPost = {
        yamlFile: filename,
        queueName,
        environmentVariables: JSON.stringify(changedVars),
        testId: testIdWithEnv!
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData with vars and prior testId", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(testIdWithEnv);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Created);
          // If this runs before the other acceptance tests populate the shared data
          testIdWithEnv = body.testId;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // In this case, even though the previous test has the files, if we don't pass them in to the fields it should fail
    it("POST /test missing files prior testId should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(testIdWithFiles, "testIdWithFiles").to.not.equal(undefined);
      const filename: string = path.basename(BASIC_FILEPATH_WITH_FILES);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const formData: FormDataPost = {
        yamlFile: filename,
        queueName,
        testId: testIdWithFiles!,
        additionalFiles: extrafilename
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include(extrafilename2);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test missing files prior testId, new yaml needs files should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(sharedPpaasTestId, "sharedPpaasTestId").to.not.equal(undefined);
      const filename: string = path.basename(BASIC_FILEPATH_WITH_FILES);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const formData: FormDataPost = {
        yamlFile: {
          value: createReadStream(BASIC_FILEPATH_WITH_FILES),
          options: { filename }
        },
        queueName,
        testId: sharedPpaasTestId!.testId
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          log("body: " + bodyText, LogLevel.DEBUG, bodyText);
          expect(bodyText).to.not.equal(undefined);
          expect(bodyText).to.include(extrafilename);
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // Now we pass in the prior files
    it("POST /test with files prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithFiles, "testIdWithFiles").to.not.equal(undefined);
      const filename: string = path.basename(BASIC_FILEPATH_WITH_FILES);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const formData: FormDataPost = {
        yamlFile: filename,
        additionalFiles: JSON.stringify([extrafilename, extrafilename2]),
        queueName,
        testId: testIdWithFiles!
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData with files prior testId", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Created);
          // If this runs before the other acceptance tests populate the shared data
          testIdWithFiles = body.testId;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    // Now we pass in the prior files
    it("POST /test with files prior testId one changed file should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithFiles, "testIdWithFiles").to.not.equal(undefined);
      const filename: string = path.basename(BASIC_FILEPATH_WITH_FILES);
      const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
      const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
      const formData: FormDataPost = {
        yamlFile: filename,
        additionalFiles: [{
          value: createReadStream(NOT_YAML_FILEPATH),
          options: { filename: extrafilename }
        }, extrafilename2],
        queueName,
        testId: testIdWithFiles!
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData with files prior testId", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Created);
          // If this runs before the other acceptance tests populate the shared data
          testIdWithFiles = body.testId;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /test scheduled prior testId should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId).to.not.equal(undefined);
      const filename: string = path.basename(basicFilepath);
      const formData: FormDataPost = {
        yamlFile: filename,
        queueName,
        testId: sharedPpaasTestId!.testId,
        scheduleDate: Date.now() + 600000
      };
      const data = convertFormDataPostToFormData(formData);
      const headers = data.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data,
        headers
      }).then((res: Response) => {
        log("POST /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          const body: TestData = JSON.parse(bodyText);
          log("body: " + bodyText, LogLevel.DEBUG, body);
          expect(body, "body").to.not.equal(undefined);
          expect(body.testId, "testId").to.not.equal(undefined);
          expect(body.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(body.status, "status").to.equal(TestStatus.Scheduled);
          expect(body.startTime, "startTime").to.equal(formData.scheduleDate);
          expect(body.endTime, "endTime").to.be.greaterThan(formData.scheduleDate!);
          const ppaasTestId = PpaasTestId.getFromTestId(body.testId);
          // We can't re-use the schedule date for the testId since we don't want conflicts if you schedule the same test twice
          expect(ppaasTestId.date.getTime(), "ppaasTestId.date").to.not.equal(formData.scheduleDate);
          // If this runs before the other acceptance tests populate the shared data
          sharedScheduledTestData = body;
          done();
      }).catch((error) => {
        log("POST /test error", LogLevel.ERROR, error);
        done(error);
      });
    });
    });

    describe("scripting tests", () => {
      const scriptingFilepath: string = SCRIPTING_FILEPATH;
      const scriptingFilepathWithEnv: string = SCRIPTING_FILEPATH_WITH_ENV;

      // Can't currently test latest since if an agent tries to run it, it will fail
      it("POST /test with version scripting should respond 200 OK", (done: Mocha.Done) => {
        const filename: string = path.basename(scriptingFilepath);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(scriptingFilepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(200);
            const body: TestData = JSON.parse(bodyText);
            log("body: " + bodyText, LogLevel.DEBUG, body);
            expect(body).to.not.equal(undefined);
            expect(body.testId).to.not.equal(undefined);
            expect(body.s3Folder).to.not.equal(undefined);
            expect(body.status).to.equal(TestStatus.Created);
            // We can't use this for shared since it has version different
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test with version legacy should respond 400 Bad Request", (done: Mocha.Done) => {
        const filename: string = path.basename(scriptingFilepath);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(scriptingFilepath),
            options: { filename }
          },
          version: legacyVersion,
          queueName
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(400);
            log("body: " + bodyText, LogLevel.DEBUG, bodyText);
            expect(bodyText).to.not.equal(undefined);
            expect(bodyText).to.include("failed to parse");
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test with extra options should respond 200 OK", (done: Mocha.Done) => {
        const filename: string = path.basename(scriptingFilepath);
        const environmentVariables: EnvironmentVariablesFile = {
          ...defaultEnvironmentVariables,
          NOT_NEEDED: { value: "true", hidden: false },
          ALSO_NOT_NEEDED: { value: "false", hidden: true }
        };
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(scriptingFilepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName,
          restartOnFailure: "true",
          environmentVariables: JSON.stringify(environmentVariables),
          additionalFiles: [{
            value: createReadStream(NOT_YAML_FILEPATH),
            options: { filename: path.basename(NOT_YAML_FILEPATH) }
          }]
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(200);
            const body = JSON.parse(bodyText);
            log("body: " + bodyText, LogLevel.DEBUG, body);
            expect(body).to.not.equal(undefined);
            expect(body.testId).to.not.equal(undefined);
            expect(body.s3Folder).to.not.equal(undefined);
            expect(body.status).to.equal(TestStatus.Created);
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test missing vars should respond 400 Bad Request", (done: Mocha.Done) => {
        const filepath: string = scriptingFilepathWithEnv;
        const filename: string = path.basename(filepath);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(filepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(400);
            log("body: " + bodyText, LogLevel.DEBUG, bodyText);
            expect(bodyText).to.not.equal(undefined);
            expect(bodyText).to.include("SERVICE_URL_AGENT");
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test missing files should respond 400 Bad Request", (done: Mocha.Done) => {
        const filepath: string = SCRIPTING_FILEPATH_WITH_FILES;
        const filename: string = path.basename(filepath);
        const extrafilename: string = path.basename(NOT_YAML_FILEPATH);
        const extrafilename2: string = path.basename(NOT_YAML_FILEPATH2);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(filepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName,
          additionalFiles: [{
            value: createReadStream(NOT_YAML_FILEPATH),
            options: { filename: extrafilename }
          }]
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(400);
            log("body: " + bodyText, LogLevel.DEBUG, bodyText);
            expect(bodyText).to.not.equal(undefined);
            expect(bodyText).to.include(extrafilename2);
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test with vars should respond 200 OK", (done: Mocha.Done) => {
        const filepath: string = scriptingFilepathWithEnv;
        const filename: string = path.basename(filepath);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(filepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName,
          environmentVariables: JSON.stringify(defaultEnvironmentVariables)
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(200);
            const body = JSON.parse(bodyText);
            log("body: " + bodyText, LogLevel.DEBUG, body);
            expect(body).to.not.equal(undefined);
            expect(body.testId).to.not.equal(undefined);
            expect(body.s3Folder).to.not.equal(undefined);
            expect(body.status).to.equal(TestStatus.Created);
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test with files should respond 200 OK", (done: Mocha.Done) => {
        const filepath: string = SCRIPTING_FILEPATH_WITH_FILES;
        const filename: string = path.basename(filepath);
        const extrafilepath: string = NOT_YAML_FILEPATH;
        const extrafilename: string = path.basename(extrafilepath);
        const extrafilepath2: string = NOT_YAML_FILEPATH2;
        const extrafilename2: string = path.basename(extrafilepath2);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(filepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName,
          additionalFiles: [{
            value: createReadStream(extrafilepath),
            options: { filename: extrafilename }
          },{
            value: createReadStream(extrafilepath2),
            options: { filename: extrafilename2 }
          }]
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(200);
            const body = JSON.parse(bodyText);
            log("body: " + bodyText, LogLevel.DEBUG, body);
            expect(body).to.not.equal(undefined);
            expect(body.testId).to.not.equal(undefined);
            expect(body.s3Folder).to.not.equal(undefined);
            expect(body.status).to.equal(TestStatus.Created);
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test with no peak load should respond 200 OK", (done: Mocha.Done) => {
        const filepath: string = SCRIPTING_FILEPATH_NO_PEAK_LOAD;
        const filename: string = path.basename(filepath);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(filepath),
            options: { filename }
          },
          queueName
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(200);
            const body = JSON.parse(bodyText);
            log("body: " + bodyText, LogLevel.DEBUG, body);
            expect(body).to.not.equal(undefined);
            expect(body.testId).to.not.equal(undefined);
            expect(body.s3Folder).to.not.equal(undefined);
            expect(body.status).to.equal(TestStatus.Created);
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("POST /test with headers_all should respond 200 OK", (done: Mocha.Done) => {
        const filepath: string = SCRIPTING_FILEPATH_HEADERS_ALL;
        const filename: string = path.basename(filepath);
        const formData: FormDataPost = {
          yamlFile: {
            value: createReadStream(filepath),
            options: { filename }
          },
          version: scriptingVersion,
          queueName
        };
        const data = convertFormDataPostToFormData(formData);
        const headers = data.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        fetch(url, {
          method: "POST",
          data,
          headers
        }).then((res: Response) => {
          log("POST /test res", LogLevel.DEBUG, res);
          const bodyText = JSON.stringify(res.data);
            expect(res.status, bodyText).to.equal(200);
            const body = JSON.parse(bodyText);
            log("body: " + bodyText, LogLevel.DEBUG, body);
            expect(body).to.not.equal(undefined);
            expect(body.testId).to.not.equal(undefined);
            expect(body.s3Folder).to.not.equal(undefined);
            expect(body.status).to.equal(TestStatus.Created);
            done();
        }).catch((error) => {
          log("POST /test error", LogLevel.ERROR, error);
          done(error);
        });
      });
    });
  });

  describe("GET /test", () => {
    it("GET /test should respond 200 OK", (done: Mocha.Done) => {
      fetch(url).then((res) => {
        log("GET /test response", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        const tests: unknown = res.data;
          log("tests: " + tests, LogLevel.DEBUG, tests);
          expect(tests && typeof tests === "object" && "runningTests" in tests).to.equal(true);
          expect(tests && typeof tests === "object" && "recentTests" in tests).to.equal(true);
          expect(tests && typeof tests === "object" && "requestedTests" in tests).to.equal(true);
          const allTests = tests as AllTests;
          expect(allTests.runningTests).to.not.equal(undefined);
          expect(Array.isArray(allTests.runningTests)).to.equal(true);
          expect(allTests.recentTests).to.not.equal(undefined);
          expect(Array.isArray(allTests.recentTests)).to.equal(true);
          expect(allTests.requestedTests).to.not.equal(undefined);
          expect(Array.isArray(allTests.requestedTests)).to.equal(true);
          done();
      }).catch((error) => done(error));
    });

    it("GET /test?testId=invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url + "?testId=invalid").then((res) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("GET /test?testId=validButNotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
      const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").testId;
      log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      fetch(url + "?testId=" + validButNotInS3).then((res) => {
        expect(res.status).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    describe("GET /test populated", () => {
      before (async () => {
        await getPpaasTestId();
      });

      afterEach (async () => {
        const res = await fetch(url);
        expect(res.status).to.equal(200);
        const tests: unknown = res.data;
        log("test populated: " + tests, LogLevel.DEBUG, tests);
        expect(tests && typeof tests === "object" && "runningTests" in tests).to.equal(true);
        expect(tests && typeof tests === "object" && "recentTests" in tests).to.equal(true);
        expect(tests && typeof tests === "object" && "requestedTests" in tests).to.equal(true);
        const allTests = tests as AllTests;
        expect(allTests.runningTests, "runningTests").to.not.equal(undefined);
        expect(Array.isArray(allTests.runningTests), "runningTests").to.equal(true);
        expect(allTests.recentTests, "recentTests").to.not.equal(undefined);
        expect(Array.isArray(allTests.recentTests), "recentTests").to.equal(true);
        expect(allTests.requestedTests, "requestedTests").to.not.equal(undefined);
        expect(Array.isArray(allTests.requestedTests), "requestedTests").to.equal(true);
        // Running should have at least one now
        expect(allTests.runningTests.length, "tests.runningTests.length: " + allTests.runningTests.length).to.be.greaterThan(0);
        // recent should be zero. But if the agent acceptance are run before this it will be 1
        // expect(allTests.recentTests.length, "tests.recentTests.length: " + allTests.recentTests.length).to.equal(0);
        // expect(allTests.requestedTests.length, "tests.requestedTests.length: " + allTests.requestedTests.length).to.be.greaterThanOrEqual(0);
      });

      it("GET /test?testId=validInS3 should respond 200 OK", (done: Mocha.Done) => {
        expect(sharedPpaasTestId).to.not.equal(undefined);
        const testId = sharedPpaasTestId!.testId;
        log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
        fetch(url + "?testId=" + testId).then((res) => {
          log ("validInS3 response", LogLevel.DEBUG, res);
          expect(res.status).to.equal(200);
          done();
        }).catch((error) => done(error));
      });
    });
  });

  describe("GET /test?newTest", () => {
    before (async () => {
      await getPpaasTestId();
    });

    it("GET /test?newTest&testId=invalid should respond 400 Bad Request", (done: Mocha.Done) => {
      fetch(url + "?newTest&testId=invalid").then((res) => {
        expect(res.status).to.equal(400);
        done();
      }).catch((error) => done(error));
    });

    it("GET /test?newTest&testId=validButNotInS3 should respond 404 Not Found", (done: Mocha.Done) => {
      const validButNotInS3 = PpaasTestId.makeTestId("validButNotInS3").testId;
      log("validButNotInS3 testId: " + validButNotInS3, LogLevel.DEBUG, validButNotInS3);
      fetch(url + "?newTest&testId=" + validButNotInS3).then((res) => {
        expect(res.status).to.equal(404);
        done();
      }).catch((error) => done(error));
    });

    it("GET /test?newTest&testId=validInS3 should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId).to.not.equal(undefined);
      const testId = sharedPpaasTestId!.testId;
      log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
      fetch(url + "?newTest&testId=" + testId).then((res) => {
        log ("validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.data)).to.equal(200);
        const body: unknown = res.data;
        expect(typeof body, "typeof body").to.equal("object");
        expect(typeof (body as PreviousTestData).testId, "typeof testId").to.equal("string");
        expect(typeof (body as PreviousTestData).s3Folder, "typeof s3Folder").to.equal("string");
        expect(typeof (body as PreviousTestData).yamlFile, "typeof yamlFile").to.equal("string");
        expect(typeof (body as PreviousTestData).version, "typeof version").to.equal("string");
        expect(typeof (body as PreviousTestData).environmentVariables, "typeof environmentVariables").to.equal("object");
        const test: PreviousTestData = body as any;
          log("tests: " + test, LogLevel.DEBUG, test);
          expect(test.testId, "testId").to.equal(testId);
          expect(test.s3Folder, "s3Folder").to.equal(sharedPpaasTestId!.s3Folder);
          expect(test.yamlFile, "yamlFile").to.equal(path.basename(basicFilepath));
          expect(test.queueName, "queueName").to.equal(queueName);
          expect(test.additionalFiles, "additionalFiles").to.equal(undefined);
          expect(test.version, "version").to.equal(latestPewPewVersion);
          expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
          expect(Object.keys(test.environmentVariables).length, "environmentVariables.keys.length: " + Object.keys(test.environmentVariables)).to.equal(0);
          expect(test.restartOnFailure, "restartOnFailure").to.equal(undefined);
          expect(test.bypassParser, "bypassParser").to.equal(undefined);
          expect(test.scheduleDate, "scheduleDate").to.equal(undefined);
          done();
      }).catch((error) => done(error));
    });

    it("GET /test?newTest&testId=validInS3WithVersion should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithVersion).to.not.equal(undefined);
      const testId = testIdWithVersion;
      log("validInS3 testId: " + testId, LogLevel.DEBUG, testId);
      fetch(url + "?newTest&testId=" + testId).then((res) => {
        log ("validInS3 response", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.data)).to.equal(200);
        const body: unknown = res.data;
        expect(typeof body, "typeof body").to.equal("object");
        expect(typeof (body as PreviousTestData).testId, "typeof testId").to.equal("string");
        expect(typeof (body as PreviousTestData).s3Folder, "typeof s3Folder").to.equal("string");
        expect(typeof (body as PreviousTestData).yamlFile, "typeof yamlFile").to.equal("string");
        expect(typeof (body as PreviousTestData).version, "typeof version").to.equal("string");
        expect(typeof (body as PreviousTestData).environmentVariables, "typeof environmentVariables").to.equal("object");
        const test: PreviousTestData = body as any;
          log("tests: " + test, LogLevel.DEBUG, test);
          expect(test.testId, "testId").to.equal(testId);
          expect(test.s3Folder, "s3Folder").to.not.equal(undefined);
          expect(test.yamlFile, "yamlFile").to.equal(path.basename(basicFilepath));
          expect(test.queueName, "queueName").to.equal(queueName);
          expect(test.additionalFiles, "additionalFiles").to.equal(undefined);
          expect(test.version, "version").to.equal(legacyVersion);
          expect(test.environmentVariables, "environmentVariables").to.not.equal(undefined);
          expect(Object.keys(test.environmentVariables).length, "environmentVariables.keys.length: " + Object.keys(test.environmentVariables)).to.equal(1);
          expect(test.restartOnFailure, "restartOnFailure").to.equal(undefined);
          expect(test.bypassParser, "bypassParser").to.equal(undefined);
          expect(test.scheduleDate, "scheduleDate").to.equal(undefined);
          done();
      }).catch((error) => done(error));
    });
  });

  describe("PUT /test", () => {
    before (async () => {
      await getPpaasTestId();
    });

    it("PUT /test basic should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPpaasTestId).to.not.equal(undefined);
      const formData: FormDataPut = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename: path.basename(basicFilepath) }
        },
        testId: sharedPpaasTestId!.testId
      };
      const data = convertFormDataPutToFormData(formData);
      const headers = data.getHeaders();
      log("PUT formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "PUT",
        data,
        headers
      }).then((res: Response) => {
        log("PUT /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          done();
      }).catch((error) => {
        log("PUT /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PUT /test with environment variables should respond 200 OK", (done: Mocha.Done) => {
      expect(testIdWithEnv).to.not.equal(undefined);
      const formData: FormDataPut = {
        yamlFile: {
          value: createReadStream(basicFilepathWithEnv),
          options: { filename: path.basename(basicFilepathWithEnv) }
        },
        testId: testIdWithEnv!
      };
      const data = convertFormDataPutToFormData(formData);
      const headers = data.getHeaders();
      log("PUT formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "PUT",
        data,
        headers
      }).then((res: Response) => {
        log("PUT /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(200);
          done();
      }).catch((error) => {
        log("PUT /test error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PUT /test with wrong yaml file should respond 400 Bad Request", (done: Mocha.Done) => {
      expect(testIdWithEnv).to.not.equal(undefined);
      const formData: FormDataPut = {
        yamlFile: {
          value: createReadStream(basicFilepath),
          options: { filename: path.basename(basicFilepath) }
        },
        testId: testIdWithEnv!
      };
      const data = convertFormDataPutToFormData(formData);
      const headers = data.getHeaders();
      log("PUT formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "PUT",
        data,
        headers
      }).then((res: Response) => {
        log("PUT /test res", LogLevel.DEBUG, res);
        const bodyText = JSON.stringify(res.data);
          expect(res.status, bodyText).to.equal(400);
          done();
      }).catch((error) => {
        log("PUT /test error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
