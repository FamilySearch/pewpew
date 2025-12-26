import {
  BYPASS_PARSER_RUNTIME_DEFAULT,
  PewPewTest,
  SPLUNK_FORWARDER_EXTRA_TIME,
  getEndTime
} from "../src/pewpewtest.js";
import {
  LogLevel,
  MessageType,
  PEWPEW_BINARY_FOLDER,
  PEWPEW_VERSION_LATEST,
  PpaasS3Message,
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
const {
  createS3Filename: createS3FilenameS3Message,
  getKey: getKeyS3Message
} = ppaass3message;
const {
  createS3Filename: createS3FilenameTestStatus,
  getKey: getKeyTestStatus
} = ppaasteststatus;
import { access, readFile } from "fs/promises";
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
} from "../test/mock.js";
import { PEWPEW_PATH } from "../src/tests.js";
import { expect } from "chai";
import { getHostname } from "../src/util/util.js";
import { join } from "path";

const CREATE_TEST_FILENAME: string = process.env.CREATE_TEST_FILENAME || "createtest.yaml";
const CREATE_TEST_FILEDIR: string = process.env.CREATE_TEST_FILEDIR || "createtest";
const CREATE_TEST_SHORTERDIR: string = process.env.CREATE_TEST_SHORTERDIR || "createtest/shorter";
const CREATE_TEST_RUN_TIME_MN: number = 2;
// In tests, allow more timing variation due to faster SPLUNK_FORWARDER_EXTRA_TIME
// Production uses 90000ms, but tests use 1000ms, so we need at least 10s buffer for timing variations
const END_TIME_BUFFER = SPLUNK_FORWARDER_EXTRA_TIME < 10000 ? 10000 : SPLUNK_FORWARDER_EXTRA_TIME;
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

describe("PewPewTest Create Test", () => {
  let ppaasTestId: PpaasTestId | undefined;
  let ipAddress: string;
  let hostname: string;

  before(() => {
    mockS3();
    mockSqs();
    mockSendMessage();
    mockUploadObject();
    mockCopyObject();
    mockGetObjectTagging();
    log("smoke queue url=" + [...sqs.QUEUE_URL_TEST], LogLevel.DEBUG);

    try {
      ipAddress = util.getLocalIpAddress();
      hostname = getHostname();
    } catch (error) {
      log("Could not retrieve ipAddress", LogLevel.ERROR, error);
    }
  });

  after(() => {
    resetMockS3();
    resetMockSqs();
  });

  describe("Get Test from Real SQS Queue", () => {
    const createTestFilename = CREATE_TEST_FILENAME;
    let expectedTestMessage: Required<TestMessage>;
    let expectedTestStatusMessage: Required<TestStatusMessage>;

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
      mockGetObject({ body: await readFile(join(CREATE_TEST_FILEDIR, createTestFilename)), contentType: "text/yaml", keyMatch: `${s3.KEYSPACE_PREFIX}${s3Folder}/${createTestFilename}` });
      // .info
      const now = Date.now();
      const basicTestStatusMessage: TestStatusMessage = {
        startTime: now + 1,
        endTime: now + 2,
        resultsFilename: [],
        status: TestStatus.Created
      };
      const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
      const testStatusKey = s3.KEYSPACE_PREFIX + getKeyTestStatus(ppaasTestId);
      mockListObject({ filename: createS3FilenameTestStatus(ppaasTestId), folder: s3Folder, keyMatch: testStatusKey });
      mockGetObject({ body: JSON.stringify(ppaasTestStatus.getTestStatusMessage()), contentType: "application/json", keyMatch: testStatusKey });
      // .msg
      const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId);
      mockListObjects({ contents: undefined, keyMatch: s3MessageKey });
      mockGetObjectError({ statusCode: 404, code: "Not Found", keyMatch: s3MessageKey });

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

      expectedTestMessage = {
        testId: ppaasTestId.testId,
        s3Folder,
        yamlFile: createTestFilename,
        testRunTimeMn: CREATE_TEST_RUN_TIME_MN,
        version: PEWPEW_VERSION_LATEST,
        envVariables: { SERVICE_URL_AGENT: "127.0.0.1:8080" },
        restartOnFailure: false,
        additionalFiles: [],
        bucketSizeMs: 60000,
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

        // Wait a bit for fire-and-forget cleanup to complete (log files are deleted after SPLUNK_FORWARDER_EXTRA_TIME)
        // For tests, we set SPLUNK_FORWARDER_EXTRA_TIME=1000 in .env.test
        if (SPLUNK_FORWARDER_EXTRA_TIME > 0 && SPLUNK_FORWARDER_EXTRA_TIME < 10000) {
          // Wait for cleanup + small buffer (tests use SPLUNK_FORWARDER_EXTRA_TIME=1000)
          await util.sleep(SPLUNK_FORWARDER_EXTRA_TIME * 3 + 500);
        }

        log(`Checking cleanup for test ${ppaasTestId.testId}`, LogLevel.DEBUG, { testDirectory, stdoutLogFile, stderrLogFile });

        const testDirExists = await fileExists(testDirectory);
        expect(testDirExists, `Test directory should be cleaned up: ${testDirectory}`).to.equal(false);

        // Log files might still exist if SPLUNK_FORWARDER_EXTRA_TIME is long, so only check if we waited
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
        expect(test, "test").to.not.equal(undefined);
        expect(test!.getTestId(), "getTestId()").to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile(), "getYamlFile()").to.not.equal(undefined);
        expect(test!.getResultsFile(), "getResultsFile()").to.equal(undefined);
        const constructorTestStatusMessage = test!.getTestStatusMessage();
        log("test.getTestStatusMessage: " + constructorTestStatusMessage?.toString(), LogLevel.DEBUG);
        expect(constructorTestStatusMessage, "constructorTestStatusMessage").to.not.equal(undefined);
        expect(constructorTestStatusMessage.hostname, "constructorTestStatusMessage.hostname").to.equal(hostname);
        expect(constructorTestStatusMessage.ipAddress, "constructorTestStatusMessage.ipAddress").to.equal(ipAddress);
        expect(constructorTestStatusMessage.startTime, "constructorTestStatusMessage.startTime").to.be.greaterThan(expectedTestStatusMessage.startTime);
        const beforeStartTime = constructorTestStatusMessage.startTime;
        expect(constructorTestStatusMessage.endTime, "constructorTestStatusMessage.endTime").to.equal(getEndTime(constructorTestStatusMessage.startTime, expectedTestMessage.testRunTimeMn));
        const beforeEndTime = constructorTestStatusMessage.endTime;
        expect(Array.isArray(constructorTestStatusMessage.resultsFilename), "Array.isArray constructorTestStatusMessage.resultsFilename").to.equal(true);
        expect(constructorTestStatusMessage.resultsFilename.length, "constructorTestStatusMessage.resultsFilename.length").to.equal(0);
        expect(constructorTestStatusMessage.status, "constructorTestStatusMessage.status").to.equal(TestStatus.Created);
        expect(constructorTestStatusMessage.errors, "constructorTestStatusMessage.errors").to.equal(undefined);
        expect(constructorTestStatusMessage.version, "constructorTestStatusMessage.version").to.equal(expectedTestMessage.version);
        expect(constructorTestStatusMessage.queueName, "constructorTestStatusMessage.queueName").to.equal(PpaasTestMessage.getAvailableQueueNames()[0]);
        expect(constructorTestStatusMessage.userId, "constructorTestStatusMessage.userId").to.equal(expectedTestStatusMessage.userId);

        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        await test!.launch();
        expect(test!.getResultsFile(), "getResultsFile()").to.not.equal(undefined);
        // Start and endtime will have updated again. Status will be finished and endTime will be actual endtime
        const finishedTestStatusMessage = test!.getTestStatusMessage();
        expect(finishedTestStatusMessage, "finishedTestStatusMessage").to.not.equal(undefined);
        expect(finishedTestStatusMessage.hostname, "finishedTestStatusMessage.hostname").to.equal(hostname);
        expect(finishedTestStatusMessage.ipAddress, "finishedTestStatusMessage.ipAddress").to.equal(ipAddress);
        expect(finishedTestStatusMessage.startTime, "finishedTestStatusMessage.startTime").to.be.greaterThan(beforeStartTime);
        // Tests can complete earlier than planned endTime, so allow reasonable buffer
        // Use END_TIME_BUFFER to account for timing variations in test vs production environments
        expect(finishedTestStatusMessage.endTime, "finishedTestStatusMessage.endTime").to.be.greaterThan(beforeEndTime - END_TIME_BUFFER);
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

    it("Retrieve Test and launch, then stop should succeed", (done: Mocha.Done) => {
      expect(ppaasTestId, "ppaasTestId").to.not.equal(undefined);
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        expect(test).to.not.equal(undefined);
        expect(test!.getTestId()).to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile()).to.not.equal(undefined);
        expect(test!.getResultsFile()).to.equal(undefined);
        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);

        // Wait 65 seconds (at least one bucket) then send a stop message
        setTimeout(() => {
          const stopMessage = new PpaasS3Message({
            testId: ppaasTestId!,
            messageType: MessageType.StopTest,
            messageData: undefined
          });
          // .msg
          const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId!);
          mockListObject({ filename: createS3FilenameS3Message(ppaasTestId!), folder: ppaasTestId!.s3Folder, keyMatch: s3MessageKey, once: true });
          mockGetObject({ body: JSON.stringify(stopMessage.getCommunicationsMessage()), contentType: "application/json", keyMatch: s3MessageKey });
          log("Stop Message sent", LogLevel.WARN);
        }, 65000);

        const startTime: number = Date.now();
        await test!.launch();
        expect(test!.getResultsFile(), "getResultsFile()").to.not.equal(undefined);
        expect(Date.now() - startTime, "Actual Run Time").to.be.lessThan(120000);
        done();
      })
      .catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });

    it("Retrieve Test and launch, then kill should succeed", (done: Mocha.Done) => {
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        expect(test).to.not.equal(undefined);
        expect(test!.getTestId()).to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile()).to.not.equal(undefined);
        expect(test!.getResultsFile()).to.equal(undefined);
        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        // Wait 65 seconds (at least one bucket) then send a kill message
        setTimeout(() => {
          const killMessage = new PpaasS3Message({
            testId: ppaasTestId!,
            messageType: MessageType.KillTest,
            messageData: undefined
          });
          // .msg
          const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId!);
          mockListObject({ filename: createS3FilenameS3Message(ppaasTestId!), folder: ppaasTestId!.s3Folder, keyMatch: s3MessageKey, once: true });
          mockGetObject({ body: JSON.stringify(killMessage.getCommunicationsMessage()), contentType: "application/json", keyMatch: s3MessageKey });
          log("Kill Message sent", LogLevel.WARN);
        }, 65000);

        const startTime: number = Date.now();
        try {
        await test!.launch();
          // Should have thrown
          done(new Error("test.launch() should have failed with pewpew exited with kill"));
        } catch (error) {
          // Kill should throw
          log("'Retrieve Test and launch, then kill should succeed' result", LogLevel.DEBUG, error);
          try {
            expect(`${error}`, "test.launch() error").to.include("pewpew exited with code null and signal SIGKILL");
            expect(test!.getResultsFile(), "resultsFile").to.not.equal(undefined);
            expect(Date.now() - startTime, "Actual Run Time").to.be.lessThan(120000);
            done();
          } catch (error2) {
            log ("'Retrieve Test and launch, then kill should succeed' error in catch", LogLevel.ERROR, error2);
            done(error2);
          }
        }
      }).catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });

    it("Retrieve Test and launch, then update shorter", (done: Mocha.Done) => {
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        expect(test).to.not.equal(undefined);
        expect(test!.getTestId()).to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile()).to.not.equal(undefined);
        expect(test!.getResultsFile()).to.equal(undefined);
        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        // Wait 65 seconds (at least one bucket) then update shorter
        setTimeout(async () => {
          // s3File = new PpaasS3File({
          //   filename: createTestFilename,
          //   s3Folder: ppaasTestId!.s3Folder,
          //   localDirectory: CREATE_TEST_SHORTERDIR
          // });
          mockGetObject({
            body: await readFile(join(CREATE_TEST_SHORTERDIR, createTestFilename)),
            contentType: "text/yaml",
            keyMatch: `${s3.KEYSPACE_PREFIX}${ppaasTestId!.s3Folder}/${createTestFilename}`
          });

          const updateMessage = new PpaasS3Message({
            testId: ppaasTestId!,
            messageType: MessageType.UpdateYaml,
            messageData: createTestFilename
          });
          // .msg
          const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId!);
          mockListObject({ filename: createS3FilenameS3Message(ppaasTestId!), folder: ppaasTestId!.s3Folder, keyMatch: s3MessageKey, once: true });
          mockGetObject({ body: JSON.stringify(updateMessage.getCommunicationsMessage()), contentType: "application/json", keyMatch: s3MessageKey });
          log("Update Shorter sent", LogLevel.WARN);
        }, 30000);

        const startTime: number = Date.now();
        await test!.launch();
        expect(test!.getResultsFile()).to.not.equal(undefined);
        expect(Date.now() - startTime, "Actual Run Time").to.be.lessThan(120000);
        done();
      })
      .catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });
  });

  describe("Bypass Parser Test", () => {
    const createTestFilename = CREATE_TEST_FILENAME;
    let expectedTestMessage: TestMessage;
    let expectedTestStatusMessage: TestStatusMessage;

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
      mockGetObject({ body: await readFile(join(CREATE_TEST_FILEDIR, createTestFilename)), contentType: "text/yaml", keyMatch: `${s3.KEYSPACE_PREFIX}${s3Folder}/${createTestFilename}` });
      // .info
      const now = Date.now();
      const basicTestStatusMessage: TestStatusMessage = {
        startTime: now + 1,
        endTime: now + 2,
        resultsFilename: [],
        status: TestStatus.Created
      };
      const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
      const testStatusKey = s3.KEYSPACE_PREFIX + getKeyTestStatus(ppaasTestId);
      mockListObject({ filename: createS3FilenameTestStatus(ppaasTestId), folder: s3Folder, keyMatch: testStatusKey });
      mockGetObject({ body: JSON.stringify(ppaasTestStatus.getTestStatusMessage()), contentType: "application/json", keyMatch: testStatusKey });
      // .msg
      const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId);
      mockListObjects({ contents: undefined, keyMatch: s3MessageKey });
      mockGetObjectError({ statusCode: 404, code: "Not Found", keyMatch: s3MessageKey });

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
        queueName: "bogus"
      };
      (expectedTestStatusMessage as TestStatusMessage).errors = undefined; // Set it back to empty so it can get cleared out

      expectedTestMessage = {
        testId: ppaasTestId.testId,
        s3Folder,
        yamlFile: createTestFilename,
        version: PEWPEW_VERSION_LATEST,
        envVariables: {
          SERVICE_URL_AGENT: "127.0.0.1:8080",
          RUST_LOG: "info",
          RUST_BACKTRACE: "full"
        },
        restartOnFailure: false,
        bypassParser: true
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
          await util.sleep(SPLUNK_FORWARDER_EXTRA_TIME * 3 + 500);
        }

        log(`Checking cleanup for bypass test ${ppaasTestId.testId}`, LogLevel.DEBUG, { testDirectory, stdoutLogFile, stderrLogFile });

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

    it("Retrieve Test and launch bypass should succeed", (done: Mocha.Done) => {
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        expect(test, "test").to.not.equal(undefined);
        expect(test!.getTestId(), "getTestId()").to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile(), "getYamlFile()").to.not.equal(undefined);
        expect(test!.getResultsFile(), "getResultsFile()").to.equal(undefined);
        const constructorTestStatusMessage = test!.getTestStatusMessage();
        log("test.getTestStatusMessage: " + constructorTestStatusMessage?.toString(), LogLevel.DEBUG);
        expect(constructorTestStatusMessage, "constructorTestStatusMessage").to.not.equal(undefined);
        expect(constructorTestStatusMessage.hostname, "constructorTestStatusMessage.hostname").to.equal(hostname);
        expect(constructorTestStatusMessage.ipAddress, "constructorTestStatusMessage.ipAddress").to.equal(ipAddress);
        expect(constructorTestStatusMessage.startTime, "constructorTestStatusMessage.startTime").to.be.greaterThan(expectedTestStatusMessage.startTime);
        const beforeStartTime = constructorTestStatusMessage.startTime;
        // Bypass parser defaults to 60 minutes
        expect(constructorTestStatusMessage.endTime, "constructorTestStatusMessage.endTime").to.equal(getEndTime(constructorTestStatusMessage.startTime, BYPASS_PARSER_RUNTIME_DEFAULT));
        const beforeEndTime = constructorTestStatusMessage.endTime;
        expect(Array.isArray(constructorTestStatusMessage.resultsFilename), "Array.isArray constructorTestStatusMessage.resultsFilename").to.equal(true);
        expect(constructorTestStatusMessage.resultsFilename.length, "constructorTestStatusMessage.resultsFilename.length").to.equal(0);
        expect(constructorTestStatusMessage.status, "constructorTestStatusMessage.status").to.equal(TestStatus.Created);
        expect(constructorTestStatusMessage.errors, "constructorTestStatusMessage.errors").to.equal(undefined);
        expect(constructorTestStatusMessage.version, "constructorTestStatusMessage.version").to.equal(expectedTestMessage.version);
        expect(constructorTestStatusMessage.queueName, "constructorTestStatusMessage.queueName").to.equal(PpaasTestMessage.getAvailableQueueNames()[0]);

        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        await test!.launch();
        expect(test!.getResultsFile(), "getResultsFile()").to.not.equal(undefined);
        // Start and endtime will have updated again. Status will be finished and endTime will be actual endtime
        const finishedTestStatusMessage = test!.getTestStatusMessage();
        expect(finishedTestStatusMessage, "finishedTestStatusMessage").to.not.equal(undefined);
        expect(finishedTestStatusMessage.hostname, "finishedTestStatusMessage.hostname").to.equal(hostname);
        expect(finishedTestStatusMessage.ipAddress, "finishedTestStatusMessage.ipAddress").to.equal(ipAddress);
        expect(finishedTestStatusMessage.startTime, "finishedTestStatusMessage.startTime").to.be.greaterThan(beforeStartTime);
        // Bypass parser defaults to 60 minutes
        // Tests can complete earlier than planned endTime, so allow reasonable buffer
        // Use END_TIME_BUFFER to account for timing variations in test vs production environments
        expect(finishedTestStatusMessage.endTime, "finishedTestStatusMessage.endTime").to.be.greaterThan(getEndTime(constructorTestStatusMessage.startTime, CREATE_TEST_RUN_TIME_MN) - END_TIME_BUFFER);
        expect(finishedTestStatusMessage.endTime, "finishedTestStatusMessage.endTime").to.be.lessThan(beforeEndTime);
        expect(Array.isArray(finishedTestStatusMessage.resultsFilename), "Array.isArray finishedTestStatusMessage.resultsFilename").to.equal(true);
        expect(finishedTestStatusMessage.resultsFilename.length, "finishedTestStatusMessage.resultsFilename.length").to.equal(1);
        expect(finishedTestStatusMessage.status, "finishedTestStatusMessage.status").to.equal(TestStatus.Finished);
        expect(finishedTestStatusMessage.errors, "finishedTestStatusMessage.errors: " + JSON.stringify(finishedTestStatusMessage.errors)).to.equal(undefined);
        expect(finishedTestStatusMessage.version, "finishedTestStatusMessage.version").to.equal(expectedTestMessage.version);
        expect(finishedTestStatusMessage.queueName, "finishedTestStatusMessage.queueName").to.equal(PpaasTestMessage.getAvailableQueueNames()[0]);
        done();
      }).catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });

    it("Retrieve Test and launch bypass, then stop should succeed", (done: Mocha.Done) => {
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        expect(test).to.not.equal(undefined);
        expect(test!.getTestId()).to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile()).to.not.equal(undefined);
        expect(test!.getResultsFile()).to.equal(undefined);
        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        // Wait 65 seconds (at least one bucket) then send a stop message
        setTimeout(() => {
          const stopMessage = new PpaasS3Message({
            testId: ppaasTestId!,
            messageType: MessageType.StopTest,
            messageData: undefined
          });
          // .msg
          const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId!);
          mockListObject({ filename: createS3FilenameS3Message(ppaasTestId!), folder: ppaasTestId!.s3Folder, keyMatch: s3MessageKey, once: true });
          mockGetObject({ body: JSON.stringify(stopMessage.getCommunicationsMessage()), contentType: "application/json", keyMatch: s3MessageKey });
          log("Stop Message sent", LogLevel.WARN);
        }, 65000);

        const startTime: number = Date.now();
        await test!.launch();
        expect(test!.getResultsFile()).to.not.equal(undefined);
        expect(Date.now() - startTime, "Actual Run Time").to.be.lessThan(120000);
        done();
      })
      .catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });

    it("Retrieve Test and launch bypass, then update shorter", (done: Mocha.Done) => {
      PewPewTest.retrieve().then(async (test: PewPewTest | undefined) => {
        expect(test).to.not.equal(undefined);
        expect(test!.getTestId()).to.equal(ppaasTestId!.testId);
        expect(test!.getYamlFile()).to.not.equal(undefined);
        expect(test!.getResultsFile()).to.equal(undefined);
        log("Test retrieved: " + test!.getYamlFile(), LogLevel.DEBUG);
        // Wait 65 seconds (at least one bucket) then update shorter
        setTimeout(async () => {
          // s3File = new PpaasS3File({
          //   filename: createTestFilename,
          //   s3Folder: ppaasTestId!.s3Folder,
          //   localDirectory: CREATE_TEST_SHORTERDIR
          // });
          mockGetObject({
            body: await readFile(join(CREATE_TEST_SHORTERDIR, createTestFilename)),
            contentType: "text/yaml",
            keyMatch: `${s3.KEYSPACE_PREFIX}${ppaasTestId!.s3Folder}/${createTestFilename}`
          });

          const updateMessage = new PpaasS3Message({
            testId: ppaasTestId!,
            messageType: MessageType.UpdateYaml,
            messageData: createTestFilename
          });
          // .msg
          const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId!);
          mockListObject({ filename: createS3FilenameS3Message(ppaasTestId!), folder: ppaasTestId!.s3Folder, keyMatch: s3MessageKey, once: true });
          mockGetObject({ body: JSON.stringify(updateMessage.getCommunicationsMessage()), contentType: "application/json", keyMatch: s3MessageKey });
          log("Update Shorter sent", LogLevel.WARN);
        }, 30000);

        const startTime: number = Date.now();
        await test!.launch();
        expect(test!.getResultsFile()).to.not.equal(undefined);
        expect(Date.now() - startTime, "Actual Run Time").to.be.lessThan(120000);
        done();
      })
      .catch((error) => {
        log("Test Failed", LogLevel.WARN, error);
        done(error);
      });
    });
  });

});
