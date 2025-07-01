import {
  LogLevel,
  PEWPEW_BINARY_FOLDER,
  PEWPEW_VERSION_LATEST,
  PpaasTestId,
  PpaasTestMessage,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  TestStatusMessage,
  log,
  ppaass3message,
  ppaasteststatus,
  s3,
  sqs,
  util
} from "@fs/ppaas-common";
import {
  PewPewTest,
  copyTestStatus,
  findYamlCreatedFiles,
  getEndTime,
  versionGreaterThan
} from "../src/pewpewtest.js";
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
import { readFile, readdir } from "fs/promises";
import { PEWPEW_PATH } from "../src/tests.js";
import { expect } from "chai";
import { getHostname } from "../src/util/util.js";
import { join } from "path";

export const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
export const UNIT_TEST_FILEDIR: string = process.env.UNIT_TEST_FILEDIR || "test/";
const BASIC_TEST_FILENAME: string = process.env.BASIC_TEST_FILENAME || "basic.yaml";

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
});
