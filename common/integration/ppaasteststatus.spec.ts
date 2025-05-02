import {
  LogLevel,
  PEWPEW_VERSION_LATEST,
  PpaasTestId,
  PpaasTestStatus,
  TestStatus,
  TestStatusMessage,
  log,
  ppaasteststatus,
  s3
} from "../src/index.js";
import { expect } from "chai";
// import { getKey } from "../src/ppaasteststatus.js";

describe("PpaasTestStatus", () => {
  let ppaasTestId: PpaasTestId;
  // Required<> so that any new properties will fail until we add them to our test.
  let testStatus: Required<TestStatusMessage>;
  let ppaasTestWriteStatus: PpaasTestStatus;
  let ppaasTestReadStatus: PpaasTestStatus | undefined;
  let fileWritten: boolean = false;
  let fileRead: boolean = false;

  before(() => {
    // This test was failing until we reset everything. I don't know why and it bothers me.
    s3.config.s3Client = undefined as any;
    s3.init();
    ppaasTestId = PpaasTestId.makeTestId("UnitTest");
    testStatus = {
      instanceId: "i-testinstance",
      hostname: "localhost",
      ipAddress: "127.0.0.1",
      startTime: Date.now() - 60000,
      endTime: Date.now(),
      resultsFilename: [ppaasTestId.testId + ".json"],
      status: TestStatus.Running,
      errors: ["Test Error"],
      version: PEWPEW_VERSION_LATEST,
      queueName: "unittest",
      userId: "unittestuser"
    };
    ppaasTestWriteStatus = new PpaasTestStatus(ppaasTestId, testStatus);
  });

  after(async () => {
    const key = ppaasteststatus.getKey(ppaasTestId);
    try {
      await s3.deleteObject(key);
    } catch (error) {
      log(`Could not delete ${key} from s3`, LogLevel.WARN, error);
    }
  });

  describe("Send Status to S3", () => {
    it("PpaasTestStatus.writeStatus() should succeed", (done: Mocha.Done) => {
      log("creating ppaasTestStatus", LogLevel.DEBUG);
      try {
        ppaasTestWriteStatus = new PpaasTestStatus(ppaasTestId, testStatus);
        log("ppaasTestStatus", LogLevel.DEBUG, ppaasTestWriteStatus.sanitizedCopy());
        ppaasTestWriteStatus.writeStatus().then((url: string | undefined) => {
          log("PpaasTestStatus.send() result: " + url, LogLevel.DEBUG);
          expect(url).to.not.equal(undefined);
          fileWritten = true;
          done();
        }).catch((error) => {
          log("PpaasTestStatus.send() error", LogLevel.ERROR, error);
          done(error);
        });
      } catch (error) {
        log("Send To Communiations S3 Queue Error", LogLevel.ERROR, error);
        done(error);
      }
    });
  });

  describe("Read Status from S3", () => {
    let lastModifiedRemote: Date | undefined;
    let contents: string;

    before (async () => {
      expect(ppaasTestId).to.not.equal(undefined);
      if (!fileWritten) {
        await ppaasTestWriteStatus.writeStatus();
        fileWritten = true;
      }
      contents = JSON.stringify(ppaasTestWriteStatus.getTestStatusMessage());
      log("contents", LogLevel.DEBUG, { contents, testStatus });
      // Read it to get the accurate lastModifiedRemote
      await ppaasTestWriteStatus.readStatus(true);
      lastModifiedRemote = ppaasTestWriteStatus?.getLastModifiedRemote();
      log("read contents", LogLevel.DEBUG, { contents: JSON.stringify(ppaasTestWriteStatus.getTestStatusMessage()), testStatus });
    });

    it("PpaasTestStatus.getStatus exists", (done: Mocha.Done) => {
      PpaasTestStatus.getStatus(ppaasTestId).then((result: PpaasTestStatus | undefined) => {
        log("PpaasTestStatus.getStatus result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result?.getLastModifiedRemote().getTime()).to.equal(lastModifiedRemote?.getTime());
        ppaasTestReadStatus = result;
        fileRead = true;
        done();
      }).catch((error) => {
        log("PpaasTestStatus.getStatus error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PpaasTestStatus.getAllStatus exists", (done: Mocha.Done) => {
      PpaasTestStatus.getAllStatus("unittest")
      .then((result: Promise<PpaasTestStatus | undefined>[] | undefined) => {
        log("PpaasTestStatus.getAllStatus result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result!.length).to.be.greaterThan(0);
        Promise.all(result!).then((statuses: (PpaasTestStatus | undefined)[]) => {
          let foundStatus: PpaasTestStatus | undefined;
          for (const status of statuses) {
            expect(status).to.not.equal(undefined);
            if (status?.getTestId() === ppaasTestId.testId) {
              expect(status.getLastModifiedRemote().getTime()).to.equal(lastModifiedRemote?.getTime());
              foundStatus = status;
              ppaasTestReadStatus = status;
              fileRead = true;
              break;
            }
          }
          expect(foundStatus, "found ppaasTestStatus").to.not.equal(undefined);
          done();
        }).catch((error) => {
          log("PpaasTestStatus.getAllStatus error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("PpaasTestStatus.getAllStatus error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("getTestStatusMessage", () => {
    before (async () => {
      expect(ppaasTestId).to.not.equal(undefined);
      if (!fileWritten) {
        await ppaasTestWriteStatus.writeStatus();
        fileWritten = true;
        log("write contents", LogLevel.DEBUG, { contents: JSON.stringify(ppaasTestWriteStatus.getTestStatusMessage()), testStatus });
      }
      if (ppaasTestReadStatus === undefined) {
        ppaasTestReadStatus = new PpaasTestStatus(ppaasTestId, {
          startTime: Date.now(),
          endTime: Date.now(),
          resultsFilename: [],
          status: TestStatus.Unknown
        });
      }
      if (!fileRead) {
        ppaasTestReadStatus.readStatus(true);
        fileRead = true;
        log("read contents", LogLevel.DEBUG, { contents: JSON.stringify(ppaasTestReadStatus.getTestStatusMessage()), testStatus });
      }
    });

    it("getTestStatusMessage should have all properties of a TestStatusMessage", (done: Mocha.Done) => {
      if (ppaasTestReadStatus === undefined) {
        done("ppaasTestReadStatus was undefined");
        return;
      }
      const actualTestMessage = ppaasTestReadStatus.getTestStatusMessage();
      log("getTestStatusMessage", LogLevel.DEBUG, { testStatus, actualTestMessage });
      expect(Object.keys(actualTestMessage).length, `Actual Keys: ${Object.keys(actualTestMessage).toString()}\nExpected Keys: ${Object.keys(testStatus).toString()}\nMessage keys length`).to.equal(Object.keys(testStatus).length);
      for (const key in actualTestMessage) {
        expect(JSON.stringify(actualTestMessage[key as keyof TestStatusMessage]), key).to.equal(JSON.stringify(testStatus[key as keyof TestStatusMessage]));
      }
      done();
    });
  });
});
