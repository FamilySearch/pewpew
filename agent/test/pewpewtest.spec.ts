import {
  LogLevel,
  PEWPEW_BINARY_FOLDER,
  PEWPEW_VERSION_LATEST,
  PpaasS3File,
  PpaasTestId,
  PpaasTestMessage,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  TestStatusMessage,
  log,
  logger,
  ppaass3message,
  ppaasteststatus,
  s3,
  sqs,
  util
} from "@fs/ppaas-common";
import {
  PewPewTest,
  SPLUNK_FORWARDER_EXTRA_TIME,
  copyTestStatus,
  findYamlCreatedFiles,
  getEndTime,
  versionGreaterThan
} from "../src/pewpewtest.js";
import { access, mkdir, readFile, readdir, writeFile } from "fs/promises";
import {
  mockCopyObject,
  mockGetObject,
  mockGetObjectError,
  mockGetObjectTagging,
  mockListObject,
  mockListObjects,
  mockReceiveMessage,
  mockS3,
  mockSendMessage,
  mockSqs,
  mockUploadObject,
  resetMockS3,
  resetMockSqs
} from "./mock.js";
import { PEWPEW_PATH } from "../src/tests.js";
import { expect } from "chai";
import { getHostname } from "../src/util/util.js";
import { join } from "path";

export const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
export const UNIT_TEST_FILEDIR: string = process.env.UNIT_TEST_FILEDIR || "test/";
const BASIC_TEST_FILENAME: string = process.env.BASIC_TEST_FILENAME || "basic.yaml";
const LOCAL_FILE_LOCATION: string = process.env.LOCAL_FILE_LOCATION || process.env.TEMP || "/tmp";

// Helper function to check if a file/directory exists
async function fileExists (path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Test subclass to expose protected cleanup() method for unit testing
class PewPewTestPublicCleanup extends PewPewTest {
  public cleanup (splunkForwarderExtraTime?: number): Promise<void> {
    return super.cleanup(splunkForwarderExtraTime);
  }
}

describe("PewPewTest", () => {
  before(() => {
    mockS3();
    mockSqs();
    mockSendMessage();
    mockUploadObject();
    mockCopyObject();
    mockGetObjectTagging();
  });

  after(() => {
    resetMockS3();
    resetMockSqs();
  });

  describe("findYamlCreatedFiles", () => {
    let localFiles: string[];

    before (async () => {
      localFiles = (await readdir(UNIT_TEST_FILEDIR))
      .filter((filename) => filename !== UNIT_TEST_FILENAME && !util.PEWPEW_BINARY_EXECUTABLE_NAMES.includes(filename));
      log(`localFiles = ${JSON.stringify(localFiles)}`, LogLevel.DEBUG);
    });

    it("Find Yaml should find nothing when everything passed", (done: Mocha.Done) => {
      findYamlCreatedFiles(UNIT_TEST_FILEDIR, UNIT_TEST_FILENAME, localFiles)
      .then((foundFiles: string[] | undefined) => {
        log(`empty foundFiles = ${JSON.stringify(foundFiles)}`, LogLevel.DEBUG);
        expect(foundFiles).to.equal(undefined);
        done();
      })
      .catch((error) => {
        log(`empty foundFiles error = ${error}`, LogLevel.ERROR, error);
        done(error);
      });
    });

    it("Find Yaml should find one file", (done: Mocha.Done) => {
      const slicedArray: string[] = localFiles.slice(1);
      findYamlCreatedFiles(UNIT_TEST_FILEDIR, UNIT_TEST_FILENAME, slicedArray)
      .then((foundFiles: string[] | undefined) => {
        log(`non-empty foundFiles = ${JSON.stringify(foundFiles)}`, LogLevel.DEBUG);
        expect(foundFiles).to.not.equal(undefined);
        expect(foundFiles!.length).to.equal(1);
        done();
      })
      .catch((error) => {
        log(`empty foundFiles error = ${error}`, LogLevel.ERROR, error);
        done(error);
      });
    });

    it("Find Yaml should find all the files", (done: Mocha.Done) => {
      const emptryArray: string[] = [];
      findYamlCreatedFiles(UNIT_TEST_FILEDIR, UNIT_TEST_FILENAME, emptryArray)
      .then((foundFiles: string[] | undefined) => {
        log(`non-empty foundFiles = ${JSON.stringify(foundFiles)}`, LogLevel.DEBUG);
        expect(foundFiles, "foundFiles").to.not.equal(undefined);
        expect(foundFiles!.length, `foundFiles.length: ${JSON.stringify(foundFiles)}, localFiles.length: ${JSON.stringify(localFiles)}`).to.equal(localFiles.length);
        done();
      })
      .catch((error) => {
        log(`empty foundFiles error = ${error}`, LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("versionGreaterThan", () => {
    it("latest is always greater", (done: Mocha.Done) => {
      expect(versionGreaterThan(PEWPEW_VERSION_LATEST, "")).to.equal(true);
      done();
    });

    it("latest is always greater than latest", (done: Mocha.Done) => {
      expect(versionGreaterThan(PEWPEW_VERSION_LATEST, PEWPEW_VERSION_LATEST)).to.equal(true);
      done();
    });

    it("greater than latest is false", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.5", PEWPEW_VERSION_LATEST)).to.equal(false);
      done();
    });

    it("beta is not greater than non-beta same version", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.4-beta", "0.5.4")).to.equal(false);
      done();
    });

    it("beta is greater than previous version", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.5-beta", "0.5.4")).to.equal(true);
      done();
    });

    it("Patch version is greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.5", "0.5.4")).to.equal(true);
      done();
    });

    it("Patch version is not greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.3", "0.5.4")).to.equal(false);
      done();
    });

    it("Minor version is greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.6.1", "0.5.4")).to.equal(true);
      done();
    });

    it("Minor version is not greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.3", "0.6.0")).to.equal(false);
      done();
    });

    it("Major version is greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("1.0.0", "0.5.4")).to.equal(true);
      done();
    });

    it("Major version is not greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.3", "1.0.0")).to.equal(false);
      done();
    });

    it("compare version patch greater than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.5", "0.5.6-preview1")).to.equal(false);
      done();
    });

    it("compare version patch less than", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.5", "0.5.5-preview1")).to.equal(true);
      done();
    });
  });

  describe("copyTestStatus", () => {
    const ppaasTestId: PpaasTestId = PpaasTestId.makeTestId(BASIC_TEST_FILENAME);
    const now = Date.now();
    const basicTestStatusMessage: TestStatusMessage = {
      startTime: now + 1,
      endTime: now + 2,
      resultsFilename: ["test1"],
      status: TestStatus.Created
    };
    const fullTestStatusMessage: Required<TestStatusMessage> = {
      startTime: now + 3,
      endTime: now + 4,
      resultsFilename: ["bogus"],
      status: TestStatus.Running,
      instanceId: "instance1",
      hostname: "host1",
      ipAddress: "ipAddress1",
      errors: ["error1"],
      version: "version1",
      queueName: "queue1",
      userId: "user1"
    };
    const fullTestStatusMessageChanged: Required<TestStatusMessage> = {
      startTime: now + 5,
      endTime: now + 6,
      resultsFilename: ["bogus1", "bogus2"],
      status: TestStatus.Finished,
      instanceId: "instance2",
      hostname: "host2",
      ipAddress: "ipAddress2",
      errors: ["error2", "error3"],
      version: "version2",
      queueName: "queue2",
      userId: "user2"
    };
    const extendedTestStatusMessage: TestStatusMessage = {
      startTime: now + 1,
      endTime: now + 2,
      resultsFilename: ["test2"],
      status: TestStatus.Failed,
      version: "version3",
      userId: "user3"
    };

    it("current basic, undefined in s3 should keep the same", (done: Mocha.Done) => {
      try {
        const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
        const expectedTestStatusMessage = basicTestStatusMessage;
        copyTestStatus(ppaasTestStatus, undefined, basicTestStatusMessage);
        expect(ppaasTestStatus.startTime, "startTime").to.equal(expectedTestStatusMessage.startTime);
        expect(ppaasTestStatus.endTime, "endTime").to.equal(expectedTestStatusMessage.endTime);
        expect(JSON.stringify(ppaasTestStatus.resultsFilename), "resultsFilename").to.equal(JSON.stringify(expectedTestStatusMessage.resultsFilename));
        expect(ppaasTestStatus.status, "status").to.equal(expectedTestStatusMessage.status);
        expect(ppaasTestStatus.instanceId, "instanceId").to.equal(expectedTestStatusMessage.instanceId);
        expect(ppaasTestStatus.hostname, "hostname").to.equal(expectedTestStatusMessage.hostname);
        expect(JSON.stringify(ppaasTestStatus.errors), "resultsFierrorslename").to.equal(JSON.stringify(expectedTestStatusMessage.errors));
        expect(ppaasTestStatus.version, "version").to.equal(expectedTestStatusMessage.version);
        expect(ppaasTestStatus.queueName, "queueName").to.equal(expectedTestStatusMessage.queueName);
        expect(ppaasTestStatus.userId, "userId").to.equal(expectedTestStatusMessage.userId);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("current full, undefined in s3 should keep the same", (done: Mocha.Done) => {
      try {
        const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, fullTestStatusMessage);
        const expectedTestStatusMessage = fullTestStatusMessage;
        copyTestStatus(ppaasTestStatus, undefined, fullTestStatusMessage);
        expect(ppaasTestStatus.startTime, "startTime").to.equal(expectedTestStatusMessage.startTime);
        expect(ppaasTestStatus.endTime, "endTime").to.equal(expectedTestStatusMessage.endTime);
        expect(JSON.stringify(ppaasTestStatus.resultsFilename), "resultsFilename").to.equal(JSON.stringify(expectedTestStatusMessage.resultsFilename));
        expect(ppaasTestStatus.status, "status").to.equal(expectedTestStatusMessage.status);
        expect(ppaasTestStatus.instanceId, "instanceId").to.equal(expectedTestStatusMessage.instanceId);
        expect(ppaasTestStatus.hostname, "hostname").to.equal(expectedTestStatusMessage.hostname);
        expect(JSON.stringify(ppaasTestStatus.errors), "resultsFierrorslename").to.equal(JSON.stringify(expectedTestStatusMessage.errors));
        expect(ppaasTestStatus.version, "version").to.equal(expectedTestStatusMessage.version);
        expect(ppaasTestStatus.queueName, "queueName").to.equal(expectedTestStatusMessage.queueName);
        expect(ppaasTestStatus.userId, "userId").to.equal(expectedTestStatusMessage.userId);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("current full, basic in s3 should keep the same", (done: Mocha.Done) => {
      try {
        const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, fullTestStatusMessage);
        const expectedTestStatusMessage = fullTestStatusMessage;
        copyTestStatus(ppaasTestStatus, basicTestStatusMessage, fullTestStatusMessage);
        expect(ppaasTestStatus.startTime, "startTime").to.equal(expectedTestStatusMessage.startTime);
        expect(ppaasTestStatus.endTime, "endTime").to.equal(expectedTestStatusMessage.endTime);
        expect(JSON.stringify(ppaasTestStatus.resultsFilename), "resultsFilename").to.equal(JSON.stringify(expectedTestStatusMessage.resultsFilename));
        expect(ppaasTestStatus.status, "status").to.equal(expectedTestStatusMessage.status);
        expect(ppaasTestStatus.instanceId, "instanceId").to.equal(expectedTestStatusMessage.instanceId);
        expect(ppaasTestStatus.hostname, "hostname").to.equal(expectedTestStatusMessage.hostname);
        expect(JSON.stringify(ppaasTestStatus.errors), "resultsFierrorslename").to.equal(JSON.stringify(expectedTestStatusMessage.errors));
        expect(ppaasTestStatus.version, "version").to.equal(expectedTestStatusMessage.version);
        expect(ppaasTestStatus.queueName, "queueName").to.equal(expectedTestStatusMessage.queueName);
        expect(ppaasTestStatus.userId, "userId").to.equal(expectedTestStatusMessage.userId);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("current basic, full in s3 should use full values where basic is missing", (done: Mocha.Done) => {
      try {
        const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
        const expectedTestStatusMessage = { ...fullTestStatusMessage, ...basicTestStatusMessage };
        copyTestStatus(ppaasTestStatus, fullTestStatusMessage, basicTestStatusMessage);
        expect(ppaasTestStatus.startTime, "startTime").to.equal(expectedTestStatusMessage.startTime);
        expect(ppaasTestStatus.endTime, "endTime").to.equal(expectedTestStatusMessage.endTime);
        expect(JSON.stringify(ppaasTestStatus.resultsFilename), "resultsFilename").to.equal(JSON.stringify(expectedTestStatusMessage.resultsFilename));
        expect(ppaasTestStatus.status, "status").to.equal(expectedTestStatusMessage.status);
        expect(ppaasTestStatus.instanceId, "instanceId").to.equal(expectedTestStatusMessage.instanceId);
        expect(ppaasTestStatus.hostname, "hostname").to.equal(expectedTestStatusMessage.hostname);
        expect(JSON.stringify(ppaasTestStatus.errors), "resultsFierrorslename").to.equal(JSON.stringify(expectedTestStatusMessage.errors));
        expect(ppaasTestStatus.version, "version").to.equal(expectedTestStatusMessage.version);
        expect(ppaasTestStatus.queueName, "queueName").to.equal(expectedTestStatusMessage.queueName);
        expect(ppaasTestStatus.userId, "userId").to.equal(expectedTestStatusMessage.userId);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("current basic, extended in s3 should use extended values where basic is missing", (done: Mocha.Done) => {
      try {
        const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
        const expectedTestStatusMessage = { ...extendedTestStatusMessage, ...basicTestStatusMessage };
        copyTestStatus(ppaasTestStatus, extendedTestStatusMessage, basicTestStatusMessage);
        expect(ppaasTestStatus.startTime, "startTime").to.equal(expectedTestStatusMessage.startTime);
        expect(ppaasTestStatus.endTime, "endTime").to.equal(expectedTestStatusMessage.endTime);
        expect(JSON.stringify(ppaasTestStatus.resultsFilename), "resultsFilename").to.equal(JSON.stringify(expectedTestStatusMessage.resultsFilename));
        expect(ppaasTestStatus.status, "status").to.equal(expectedTestStatusMessage.status);
        expect(ppaasTestStatus.instanceId, "instanceId").to.equal(expectedTestStatusMessage.instanceId);
        expect(ppaasTestStatus.hostname, "hostname").to.equal(expectedTestStatusMessage.hostname);
        expect(JSON.stringify(ppaasTestStatus.errors), "resultsFierrorslename").to.equal(JSON.stringify(expectedTestStatusMessage.errors));
        expect(ppaasTestStatus.version, "version").to.equal(expectedTestStatusMessage.version);
        expect(ppaasTestStatus.queueName, "queueName").to.equal(expectedTestStatusMessage.queueName);
        expect(ppaasTestStatus.userId, "userId").to.equal(expectedTestStatusMessage.userId);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("current full2, full in s3 should use full2 values", (done: Mocha.Done) => {
      try {
        const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, fullTestStatusMessageChanged);
        const expectedTestStatusMessage = fullTestStatusMessageChanged;
        copyTestStatus(ppaasTestStatus, fullTestStatusMessage, fullTestStatusMessageChanged);
        expect(ppaasTestStatus.startTime, "startTime").to.equal(expectedTestStatusMessage.startTime);
        expect(ppaasTestStatus.endTime, "endTime").to.equal(expectedTestStatusMessage.endTime);
        expect(JSON.stringify(ppaasTestStatus.resultsFilename), "resultsFilename").to.equal(JSON.stringify(expectedTestStatusMessage.resultsFilename));
        expect(ppaasTestStatus.status, "status").to.equal(expectedTestStatusMessage.status);
        expect(ppaasTestStatus.instanceId, "instanceId").to.equal(expectedTestStatusMessage.instanceId);
        expect(ppaasTestStatus.hostname, "hostname").to.equal(expectedTestStatusMessage.hostname);
        expect(JSON.stringify(ppaasTestStatus.errors), "resultsFierrorslename").to.equal(JSON.stringify(expectedTestStatusMessage.errors));
        expect(ppaasTestStatus.version, "version").to.equal(expectedTestStatusMessage.version);
        expect(ppaasTestStatus.queueName, "queueName").to.equal(expectedTestStatusMessage.queueName);
        expect(ppaasTestStatus.userId, "userId").to.equal(expectedTestStatusMessage.userId);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  // rm app-ppaas*; DOWNLOAD_PEWPEW=false PEWPEW_PATH=./test/pewpew  npm run test
  describe("PewPewTest Run Pewpew Test", () => {
    let ppaasTestId: PpaasTestId | undefined;
    // let s3File: PpaasS3File | undefined;
    let expectedTestMessage: Required<TestMessage>;
    let expectedTestStatusMessage: Required<TestStatusMessage>;
    let ipAddress: string;
    let hostname: string;
    const createTestFilename = BASIC_TEST_FILENAME;

    before(() => {
      mockS3();
      mockSqs();
      mockSendMessage();
      mockUploadObject();
      mockCopyObject();
      mockGetObjectTagging();
      // Prepopulate PpaasTestStatus and make sure all expected data is still there after run
      expectedTestStatusMessage = {
        instanceId: "bogus",
        hostname: "bogus",
        ipAddress: "bogus",
        startTime: Date.now() - 5000,
        endTime: Date.now() - 5000,
        resultsFilename: [],
        status: TestStatus.Unknown,
        errors: [],
        version: "bogus",
        queueName: "bogus",
        userId: "unittestuser"
      };
      (expectedTestStatusMessage as TestStatusMessage).errors = undefined; // Set it back to empty so it can get cleared out
      try {
        ipAddress = util.getLocalIpAddress();
        hostname = getHostname();
      } catch (error) {
        log("Could not retrieve ipAddress", LogLevel.ERROR, error);
      }
    });

    beforeEach(async () => {
      // Mock the pewpew file download each time to reset the stream
      mockGetObject({
        body: await readFile(PEWPEW_PATH),
        contentType: "application/octet-stream",
        keyMatch: `${s3.KEYSPACE_PREFIX}${PEWPEW_BINARY_FOLDER}/${PEWPEW_VERSION_LATEST}/${util.PEWPEW_BINARY_EXECUTABLE}`
      });

      ppaasTestId = PpaasTestId.makeTestId(createTestFilename);
      const s3Folder = ppaasTestId.s3Folder;
      // Yaml file
      mockGetObject({ body: await readFile(join(UNIT_TEST_FILEDIR, createTestFilename)), contentType: "text/yaml", keyMatch: `${s3.KEYSPACE_PREFIX}${s3Folder}/${createTestFilename}` });
      // .info
      const now = Date.now();
      const basicTestStatusMessage: TestStatusMessage = {
        startTime: now + 1,
        endTime: now + 2,
        resultsFilename: [],
        status: TestStatus.Created
      };
      const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
      const testStatusKey = s3.KEYSPACE_PREFIX + ppaasteststatus.getKey(ppaasTestId);
      mockListObject({ filename: ppaasteststatus.createS3Filename(ppaasTestId), folder: s3Folder, keyMatch: testStatusKey });
      mockGetObject({ body: JSON.stringify(ppaasTestStatus.getTestStatusMessage()), contentType: "application/json", keyMatch: testStatusKey });
      // .msg
      const s3MessageKey = s3.KEYSPACE_PREFIX + ppaass3message.getKey(ppaasTestId);
      mockListObjects({ contents: undefined, keyMatch: s3MessageKey });
      mockGetObjectError({ statusCode: 404, code: "Not Found", keyMatch: s3MessageKey });

      expectedTestMessage = {
        testId: ppaasTestId.testId,
        s3Folder,
        yamlFile: createTestFilename,
        testRunTimeMn: 1,
        version: PEWPEW_VERSION_LATEST,
        envVariables: { SERVICE_URL_AGENT: "127.0.0.1:8080" },
        restartOnFailure: false,
        additionalFiles: [],
        bucketSizeMs: 5000,
        bypassParser: false,
        userId: "unittestuser"
      };
      const testMessage: PpaasTestMessage = new PpaasTestMessage(expectedTestMessage);
      log("Send Test request", LogLevel.DEBUG, testMessage.sanitizedCopy());
      // await testMessage.send(sqs.QUEUE_URL_TEST.keys().next().value);
      mockReceiveMessage({
        testId: ppaasTestId.testId,
        testMessage: JSON.stringify(testMessage.getTestMessage()),
        queueUrlMatch: sqs.QUEUE_URL_TEST.values().next().value
      });
      mockReceiveMessage({
        testId: ppaasTestId.testId,
        queueUrlMatch: sqs.QUEUE_URL_SCALE_IN.values().next().value
      });
    });

    afterEach(async function () {
      // Verify cleanup: test directory and log files should be deleted
      if (ppaasTestId) {
        const testDirectory = join(LOCAL_FILE_LOCATION, ppaasTestId.testId);
        const stdoutLogFile = join(logger.config.LogFileLocation, logger.pewpewStdOutFilename(ppaasTestId.testId));
        const stderrLogFile = join(logger.config.LogFileLocation, logger.pewpewStdErrFilename(ppaasTestId.testId));

        // Wait a bit for fire-and-forget cleanup to complete
        if (SPLUNK_FORWARDER_EXTRA_TIME > 0 && SPLUNK_FORWARDER_EXTRA_TIME < 10000) {
          // Wait for cleanup + small buffer (tests use SPLUNK_FORWARDER_EXTRA_TIME=1000)
          await util.sleep(SPLUNK_FORWARDER_EXTRA_TIME + 500);
        }

        log(`Checking cleanup for unit test ${ppaasTestId.testId}`, LogLevel.DEBUG, { testDirectory, stdoutLogFile, stderrLogFile });

        const testDirExists = await fileExists(testDirectory);
        expect(testDirExists, `Test directory should be cleaned up: ${testDirectory}`).to.equal(false);

        if (SPLUNK_FORWARDER_EXTRA_TIME <= 5000) {
          const stdoutExists = await fileExists(stdoutLogFile);
          const stderrExists = await fileExists(stderrLogFile);
          expect(stdoutExists, `Stdout log file should be cleaned up: ${stdoutLogFile}`).to.equal(false);
          expect(stderrExists, `Stderr log file should be cleaned up: ${stderrLogFile}`).to.equal(false);
        }
      }
    });

    it("Retrieve Test and launch should succeed", (done: Mocha.Done) => {
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        log("PewPewTest.retrieve Success: " + test?.toString(), LogLevel.DEBUG);
        expect(test).to.not.equal(undefined);
        expect(test!.getTestId()).to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile()).to.not.equal(undefined);
        expect(test!.getResultsFile()).to.equal(undefined);
        const constructorTestStatusMessage = test!.getTestStatusMessage();
        log("test.getTestStatusMessage: " + constructorTestStatusMessage?.toString(), LogLevel.DEBUG);
        expect(constructorTestStatusMessage, "constructorTestStatusMessage").to.not.equal(undefined);
        expect(constructorTestStatusMessage.hostname, "constructorTestStatusMessage.hostname").to.equal(hostname);
        expect(constructorTestStatusMessage.ipAddress, "constructorTestStatusMessage.ipAddress").to.equal(ipAddress);
        expect(constructorTestStatusMessage.startTime, "constructorTestStatusMessage.startTime").to.be.greaterThan(expectedTestStatusMessage.startTime);
        const beforeStartTime = constructorTestStatusMessage.startTime;
        expect(constructorTestStatusMessage.endTime, "constructorTestStatusMessage.endTime").to.equal(getEndTime(constructorTestStatusMessage.startTime, expectedTestMessage.testRunTimeMn));
        // const beforeEndTime = constructorTestStatusMessage.endTime;
        expect(Array.isArray(constructorTestStatusMessage.resultsFilename), "Array.isArray constructorTestStatusMessage.resultsFilename").to.equal(true);
        expect(constructorTestStatusMessage.resultsFilename.length, "constructorTestStatusMessage.resultsFilename.length").to.equal(0);
        expect(constructorTestStatusMessage.status, "constructorTestStatusMessage.status").to.equal(TestStatus.Created);
        expect(constructorTestStatusMessage.errors, "constructorTestStatusMessage.errors").to.equal(undefined);
        expect(constructorTestStatusMessage.version, "constructorTestStatusMessage.version").to.equal(expectedTestMessage.version);
        expect(constructorTestStatusMessage.queueName, "constructorTestStatusMessage.queueName").to.equal(PpaasTestMessage.getAvailableQueueNames()[0]);
        expect(constructorTestStatusMessage.userId, "constructorTestStatusMessage.userId").to.equal(expectedTestStatusMessage.userId);

        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        await test!.launch();
          expect(test!.getResultsFile()).to.not.equal(undefined);
          // Start and endtime will have updated again. Status will be finished and endTime will be actual endtime
          const finishedTestStatusMessage = test!.getTestStatusMessage();
          expect(finishedTestStatusMessage, "finishedTestStatusMessage").to.not.equal(undefined);
          expect(finishedTestStatusMessage.hostname, "finishedTestStatusMessage.hostname").to.equal(hostname);
          expect(finishedTestStatusMessage.ipAddress, "finishedTestStatusMessage.ipAddress").to.equal(ipAddress);
          expect(finishedTestStatusMessage.startTime, "finishedTestStatusMessage.startTime").to.be.greaterThan(beforeStartTime);
          expect(finishedTestStatusMessage.endTime, "finishedTestStatusMessage.endTime").to.be.greaterThan(beforeStartTime + 29); // Test is only 30 seconds long
          expect(Array.isArray(finishedTestStatusMessage.resultsFilename), "Array.isArray finishedTestStatusMessage.resultsFilename").to.equal(true);
          expect(finishedTestStatusMessage.resultsFilename.length, "finishedTestStatusMessage.resultsFilename.length").to.equal(1);
          expect(finishedTestStatusMessage.status, "finishedTestStatusMessage.status").to.equal(TestStatus.Finished);
          expect(finishedTestStatusMessage.errors, "finishedTestStatusMessage.errors: " + JSON.stringify(finishedTestStatusMessage.errors)).to.equal(undefined);
          expect(finishedTestStatusMessage.version, "finishedTestStatusMessage.version").to.equal(expectedTestMessage.version);
          expect(finishedTestStatusMessage.queueName, "finishedTestStatusMessage.queueName").to.equal(PpaasTestMessage.getAvailableQueueNames()[0]);
          expect(finishedTestStatusMessage.userId, "finishedTestStatusMessage.userId").to.equal(expectedTestStatusMessage.userId);
          done();
      }).catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });

  });

  describe("Cleanup Method Unit Tests", () => {
    let ppaasTestId: PpaasTestId;
    let testMessage: PpaasTestMessage;
    let test: PewPewTestPublicCleanup;
    let testDirectory: string;
    let stdoutLogFile: string;
    let stderrLogFile: string;

    beforeEach(async () => {
      mockS3();
      mockSqs();
      mockSendMessage();
      mockUploadObject();
      mockCopyObject();
      mockGetObjectTagging();

      ppaasTestId = PpaasTestId.makeTestId("cleanup-test.yaml");
      const s3Folder = ppaasTestId.s3Folder;

      // Mock PpaasTestStatus S3 operations (constructor tries to read existing status)
      const testStatusKey = s3.KEYSPACE_PREFIX + ppaasteststatus.getKey(ppaasTestId);
      mockListObject({
        filename: ppaasteststatus.createS3Filename(ppaasTestId),
        folder: s3Folder,
        keyMatch: testStatusKey
      });
      const now = Date.now();
      const basicTestStatusMessage: TestStatusMessage = {
        startTime: now + 1,
        endTime: now + 2,
        resultsFilename: [],
        status: TestStatus.Created
      };
      const ppaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
      mockGetObject({
        body: JSON.stringify(ppaasTestStatus.getTestStatusMessage()),
        contentType: "application/json",
        keyMatch: testStatusKey
      });

      const testMessageData: TestMessage = {
        testId: ppaasTestId.testId,
        s3Folder,
        yamlFile: "cleanup-test.yaml",
        testRunTimeMn: 1,
        version: PEWPEW_VERSION_LATEST,
        envVariables: { SERVICE_URL_AGENT: "127.0.0.1:8080" },
        restartOnFailure: false,
        additionalFiles: [],
        bucketSizeMs: 5000,
        bypassParser: false,
        userId: "cleanuptest"
      };

      testMessage = new PpaasTestMessage(testMessageData);
      test = new PewPewTestPublicCleanup(testMessage);

      // Create test directory and files to be cleaned up
      testDirectory = join(LOCAL_FILE_LOCATION, ppaasTestId.testId);
      stdoutLogFile = join(logger.config.LogFileLocation, logger.pewpewStdOutFilename(ppaasTestId.testId));
      stderrLogFile = join(logger.config.LogFileLocation, logger.pewpewStdErrFilename(ppaasTestId.testId));

      // Initialize the log file S3File objects so cleanup knows about them
      // Normally these are set in launch(), but we're testing cleanup directly
      test["pewpewStdOutS3File"] = new PpaasS3File({
        filename: logger.pewpewStdOutFilename(ppaasTestId.testId),
        s3Folder: ppaasTestId.s3Folder,
        localDirectory: logger.config.LogFileLocation,
        tags: s3.defaultTestExtraFileTags()
      });
      test["pewpewStdErrS3File"] = new PpaasS3File({
        filename: logger.pewpewStdErrFilename(ppaasTestId.testId),
        s3Folder: ppaasTestId.s3Folder,
        localDirectory: logger.config.LogFileLocation,
        tags: s3.defaultTestExtraFileTags()
      });

      // Create test directory with a dummy file
      await mkdir(testDirectory, { recursive: true });
      await writeFile(join(testDirectory, "test-file.txt"), "test content");

      // Create log files
      await writeFile(stdoutLogFile, JSON.stringify({ message: "stdout test" }));
      await writeFile(stderrLogFile, JSON.stringify({ message: "stderr test" }));

      log(`Created test files for cleanup test: ${ppaasTestId.testId}`, LogLevel.DEBUG, { testDirectory, stdoutLogFile, stderrLogFile });
    });

    it("Should cleanup with splunkForwarderExtraTime=0 (immediate)", async () => {
      // Verify files exist before cleanup
      expect(await fileExists(testDirectory), "Test directory should exist before cleanup").to.equal(true);
      expect(await fileExists(stdoutLogFile), "Stdout log file should exist before cleanup").to.equal(true);
      expect(await fileExists(stderrLogFile), "Stderr log file should exist before cleanup").to.equal(true);

      // Call cleanup with 0 to test immediate deletion
      await test.cleanup(0);

      // Give a brief moment for fire-and-forget to complete
      await util.sleep(1500);

      // Verify files are deleted
      expect(await fileExists(testDirectory), "Test directory should be deleted").to.equal(false);
      expect(await fileExists(stdoutLogFile), "Stdout log file should be deleted").to.equal(false);
      expect(await fileExists(stderrLogFile), "Stderr log file should be deleted").to.equal(false);

      log("Cleanup with splunkForwarderExtraTime=0 completed and verified", LogLevel.DEBUG);
    });

    it("Should cleanup with splunkForwarderExtraTime=-1 (immediate)", async () => {
      // Verify files exist before cleanup
      expect(await fileExists(testDirectory), "Test directory should exist before cleanup").to.equal(true);
      expect(await fileExists(stdoutLogFile), "Stdout log file should exist before cleanup").to.equal(true);
      expect(await fileExists(stderrLogFile), "Stderr log file should exist before cleanup").to.equal(true);

      // Call cleanup with -1 to test immediate deletion
      await test.cleanup(-1);

      // Give a brief moment for fire-and-forget to complete
      await util.sleep(1500);

      // Verify files are deleted
      expect(await fileExists(testDirectory), "Test directory should be deleted").to.equal(false);
      expect(await fileExists(stdoutLogFile), "Stdout log file should be deleted").to.equal(false);
      expect(await fileExists(stderrLogFile), "Stderr log file should be deleted").to.equal(false);

      log("Cleanup with splunkForwarderExtraTime=-1 completed and verified", LogLevel.DEBUG);
    });

    it("Should cleanup with default SPLUNK_FORWARDER_EXTRA_TIME", async () => {
      // Verify files exist before cleanup
      expect(await fileExists(testDirectory), "Test directory should exist before cleanup").to.equal(true);
      expect(await fileExists(stdoutLogFile), "Stdout log file should exist before cleanup").to.equal(true);
      expect(await fileExists(stderrLogFile), "Stderr log file should exist before cleanup").to.equal(true);

      // Call cleanup with no parameter to use default
      await test.cleanup();

      // Test directory should be deleted immediately
      expect(await fileExists(testDirectory), "Test directory should be deleted immediately").to.equal(false);

      // Log files won't be deleted yet (would take 90s by default)
      // Just verify the method completed successfully
      log(`Cleanup with default SPLUNK_FORWARDER_EXTRA_TIME (${SPLUNK_FORWARDER_EXTRA_TIME}ms) initiated`, LogLevel.DEBUG);
    });

    it("Should cleanup with custom time (2000ms)", async () => {
      // Verify files exist before cleanup
      expect(await fileExists(testDirectory), "Test directory should exist before cleanup").to.equal(true);
      expect(await fileExists(stdoutLogFile), "Stdout log file should exist before cleanup").to.equal(true);
      expect(await fileExists(stderrLogFile), "Stderr log file should exist before cleanup").to.equal(true);

      // Call cleanup with custom time
      await test.cleanup(2000);

      // Test directory should be deleted immediately
      expect(await fileExists(testDirectory), "Test directory should be deleted immediately").to.equal(false);

      // Wait for log files to be deleted (2000ms + buffer)
      await util.sleep(3000);

      // Verify log files are deleted
      expect(await fileExists(stdoutLogFile), "Stdout log file should be deleted after wait").to.equal(false);
      expect(await fileExists(stderrLogFile), "Stderr log file should be deleted after wait").to.equal(false);

      log("Cleanup with splunkForwarderExtraTime=2000 completed and verified", LogLevel.DEBUG);
    });
  });
});
