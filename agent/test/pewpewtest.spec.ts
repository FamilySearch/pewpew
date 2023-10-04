import {
  LogLevel,
  PpaasTestId,
  PpaasTestStatus,
  TestStatus,
  TestStatusMessage,
  log,
  logger
} from "@fs/ppaas-common";
import {
  copyTestStatus,
  findYamlCreatedFiles,
  versionGreaterThan
} from "../src/pewpewtest";
import { expect } from "chai";
import { readdir } from "fs/promises";

export const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
export const UNIT_TEST_FILEDIR: string = process.env.UNIT_TEST_FILEDIR || "test/";
const CREATE_TEST_FILENAME: string = process.env.CREATE_TEST_FILENAME || "createtest.yaml";

logger.config.LogFileName = "ppaas-agent";

describe("PewPewTest", () => {
  describe("findYamlCreatedFiles", () => {
    let localFiles: string[];

    before (async () => {
      localFiles = await readdir(UNIT_TEST_FILEDIR);
      log(`localFiles = ${JSON.stringify(localFiles)}`, LogLevel.DEBUG);
      const unitTestFound = localFiles.indexOf(UNIT_TEST_FILENAME);
      if (unitTestFound >= 0) {
        localFiles.splice(unitTestFound, 1);
      }
      const pewpewFound = localFiles.indexOf("pewpew");
      if (pewpewFound >= 0) {
        localFiles.splice(pewpewFound, 1);
      }
      log(`localFiles removed = ${JSON.stringify(localFiles)}`, LogLevel.DEBUG);
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
      expect(versionGreaterThan("latest", "")).to.equal(true);
      done();
    });

    it("latest is always greater than latest", (done: Mocha.Done) => {
      expect(versionGreaterThan("latest", "latest")).to.equal(true);
      done();
    });

    it("greater than latest is false", (done: Mocha.Done) => {
      expect(versionGreaterThan("0.5.5", "latest")).to.equal(false);
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
    const ppaasTestId: PpaasTestId = PpaasTestId.makeTestId(CREATE_TEST_FILENAME);
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
      version:"version3",
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
});
