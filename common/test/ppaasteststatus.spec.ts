import {
  LogLevel,
  PpaasTestId,
  PpaasTestStatus,
  TestStatus,
  TestStatusMessage,
  log
} from "../src/index";
import {
  mockGetObject,
  mockGetObjectError,
  mockGetObjectTagging,
  mockListObject,
  mockListObjects,
  mockS3,
  mockUploadObject,
  resetMockS3
} from "./mock";
import { createS3Filename } from "../src/ppaasteststatus";
import { expect } from "chai";

class PpaasUnitTestStatus extends PpaasTestStatus {
  public setUrl (value: string | undefined) {
    this.url = value;
  }
}

describe("PpaasTestStatus", () => {
  let ppaasTestId: PpaasTestId;
  // Required<> so that any new properties will fail until we add them to our test.
  let testStatus: Required<TestStatusMessage>;
  let ppaasTestStatus: PpaasTestStatus | undefined;
  let testFilename: string;
  let testFolder: string;

  before(() => {
    mockS3();
    mockGetObjectTagging(undefined);
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
      version: "latest",
      queueName: "unittest",
      userId: "unittestuser"
    };
    testFilename = createS3Filename(ppaasTestId);
    testFolder = ppaasTestId.s3Folder;
  });

  after(() => {
    resetMockS3();
  });

  it("getTestStatusMessage should have all properties of a TestStatusMessage", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasTestStatus(ppaasTestId, testStatus);
    const actualTestMessage = fullPpaasTestMessage.getTestStatusMessage();
    expect(Object.keys(actualTestMessage).length, `Actual Keys: ${Object.keys(actualTestMessage).toString()}\nExpected Keys: ${Object.keys(testStatus).toString()}\nMessage keys length`).to.equal(Object.keys(testStatus).length);
    for (const key in actualTestMessage) {
      expect(JSON.stringify(actualTestMessage[key as keyof TestStatusMessage]), key).to.equal(JSON.stringify(testStatus[key as keyof TestStatusMessage]));
    }
    done();
  });

  it("sanitizedCopy should only be a TestStatusMessage + testId", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasUnitTestStatus(ppaasTestId, testStatus);
    const exepectedUrl = "bogus";
    fullPpaasTestMessage.setUrl(exepectedUrl);
    const actualTestMessage = fullPpaasTestMessage.sanitizedCopy();
    // should have all the TestStatus + lastModifiedRemote && testId && url
    expect(Object.keys(actualTestMessage).length, `Actual Keys: ${Object.keys(actualTestMessage).toString()}\nExpected Keys: ${Object.keys(testStatus).toString()}\nMessage keys length`).to.equal(Object.keys(testStatus).length + 3);
    for (const key in actualTestMessage) {
      switch (key) {
        case "lastModifiedRemote":
          expect(JSON.stringify(actualTestMessage.lastModifiedRemote), key).to.equal(JSON.stringify(new Date(0)));
          break;
        case "testId":
          expect(actualTestMessage.testId, key).to.equal(ppaasTestId.testId);
          break;
        case "url":
          expect(actualTestMessage.url, key).to.equal(exepectedUrl);
          break;
        default:
          expect(JSON.stringify(actualTestMessage[key as keyof TestStatusMessage]), key).to.equal(JSON.stringify(testStatus[key as keyof TestStatusMessage]));
          break;
      }
    }
    done();
  });

  describe("Send Status to S3", () => {
    it("PpaasTestStatus.writeStatus() should succeed", (done: Mocha.Done) => {
      mockUploadObject({ filename: testFilename, folder: testFolder });
      log("creating ppaasTestStatus", LogLevel.DEBUG);
      try {
        ppaasTestStatus = new PpaasTestStatus(ppaasTestId, testStatus);
        log("ppaasTestStatus", LogLevel.DEBUG, ppaasTestStatus.sanitizedCopy());
        ppaasTestStatus.writeStatus().then((url: string | undefined) => {
          log("PpaasTestStatus.send() result: " + url, LogLevel.DEBUG);
          expect(url).to.not.equal(undefined);
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
      if (ppaasTestStatus === undefined) {
        ppaasTestStatus = new PpaasTestStatus(ppaasTestId, testStatus);
        mockUploadObject({ filename: testFilename, folder: testFolder });
        await ppaasTestStatus.writeStatus();
      }
      contents = JSON.stringify(ppaasTestStatus.getTestStatusMessage());
      log("contents", LogLevel.DEBUG, { contents, testStatus });
    });

    beforeEach(() => {
      lastModifiedRemote = ppaasTestStatus?.getLastModifiedRemote();
    });

    it("PpaasTestStatus.getStatus not existent", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasTestStatus.getStatus(PpaasTestId.makeTestId("noexist")).then((result: PpaasTestStatus | undefined) => {
        log("PpaasTestStatus.getStatus result", LogLevel.DEBUG, result);
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => {
        log("PpaasTestStatus.getStatus error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PpaasTestStatus.getStatus exists", (done: Mocha.Done) => {
      mockListObject(testFilename, testFolder);
      mockGetObject(contents, "application/json", lastModifiedRemote);
      PpaasTestStatus.getStatus(ppaasTestId).then((result: PpaasTestStatus | undefined) => {
        log("PpaasTestStatus.getStatus result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        if (result) {
          lastModifiedRemote = result.getLastModifiedRemote();
        }
        done();
      }).catch((error) => {
        log("PpaasTestStatus.getStatus error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PpaasTestStatus.getStatus not existent", (done: Mocha.Done) => {
      mockListObjects([]);
      PpaasTestStatus.getAllStatus("noexist").then((result: Promise<PpaasTestStatus | undefined>[] | undefined) => {
        log("PpaasTestStatus.getAllStatus result", LogLevel.DEBUG, result);
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => {
        log("PpaasTestStatus.getAllStatus error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PpaasTestStatus.getAllStatus exists", (done: Mocha.Done) => {
      mockListObject(testFilename, testFolder, lastModifiedRemote);
      mockGetObject(contents, "application/json", lastModifiedRemote);
      PpaasTestStatus.getAllStatus("unittest")
      .then((result: Promise<PpaasTestStatus | undefined>[] | undefined) => {
        log("PpaasTestStatus.getAllStatus result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result!.length).to.be.greaterThan(0);
        Promise.all(result!).then((statuses: (PpaasTestStatus | undefined)[]) => {
          let foundStatus: PpaasTestStatus | undefined;
          for (const status of statuses) {
            expect(status).to.not.equal(undefined);
            if (status!.getTestId() === ppaasTestId.testId) {
              foundStatus = status;
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

    it("PpaasTestStatus.getAllStatus ignored", (done: Mocha.Done) => {
      mockListObject(testFilename, testFolder, lastModifiedRemote);
      PpaasTestStatus.getAllStatus("unittest", 1000, [ppaasTestId.testId])
      .then((result: Promise<PpaasTestStatus | undefined>[] | undefined) => {
        log("PpaasTestStatus.getAllStatus result", LogLevel.DEBUG, result);
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => {
        log("PpaasTestStatus.getAllStatus error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PpaasTestStatus.readStatus should not change lastModified", (done: Mocha.Done) => {
      if (ppaasTestStatus && lastModifiedRemote) {
        mockListObject(testFilename, testFolder, lastModifiedRemote);
        mockGetObjectError(304);
        ppaasTestStatus.readStatus().then((result: Date) => {
          log("PpaasTestStatus.readStatus result", LogLevel.DEBUG, result);
          expect(result.getTime()).to.equal(lastModifiedRemote!.getTime());
          done();
        }).catch((error) => {
          log("PpaasTestStatus.readStatus error", LogLevel.ERROR, error);
          done(error);
        });
      } else {
        done(new Error("ppaasTestStatus was not initialized"));
      }
    });

    it("PpaasTestStatus.readStatus should update values", (done: Mocha.Done) => {
      if (ppaasTestStatus && lastModifiedRemote) {
        const emptyStatus: TestStatusMessage = {
          startTime: Date.now() - 60000,
          endTime: Date.now(),
          resultsFilename: ["bad"],
          status: TestStatus.Created
        };
        mockListObject(testFilename, testFolder, lastModifiedRemote);
        mockGetObject(contents, "application/json", lastModifiedRemote);
        const emptyTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, emptyStatus);
        emptyTestStatus.readStatus().then((result: Date) => {
          log("PpaasTestStatus.readStatus result", LogLevel.DEBUG, result);
          expect(result.getTime(), "getTime()").to.equal(lastModifiedRemote!.getTime());
          expect(emptyTestStatus.startTime, "startTime").to.equal(testStatus.startTime);
          expect(emptyTestStatus.endTime, "endTime").to.equal(testStatus.endTime);
          expect(emptyTestStatus.resultsFilename.length, "resultsFilename.length").to.equal(1);
          expect(emptyTestStatus.resultsFilename[0], "resultsFilename[0]").to.equal(testStatus.resultsFilename[0]);
          expect(emptyTestStatus.getLastModifiedRemote().getTime(), "getLastModifiedRemote()").to.equal(lastModifiedRemote!.getTime());
          expect(emptyTestStatus.errors, "errors").to.not.equal(undefined);
          expect(emptyTestStatus.errors!.length, "errors.length").to.equal(1);
          expect(emptyTestStatus.errors![0], "errors[0]").to.equal(testStatus.errors![0]);
          expect(emptyTestStatus.instanceId, "instanceId").to.equal(testStatus.instanceId);
          expect(emptyTestStatus.hostname, "hostname").to.equal(testStatus.hostname);
          expect(emptyTestStatus.ipAddress, "ipAddress").to.equal(testStatus.ipAddress);
          expect(emptyTestStatus.version, "version").to.equal(testStatus.version);
          expect(emptyTestStatus.queueName, "queueName").to.equal(testStatus.queueName);
          done();
        }).catch((error) => {
          log("PpaasTestStatus.readStatus error", LogLevel.ERROR, error);
          done(error);
        });
      } else {
        done(new Error("ppaasTestStatus was not initialized"));
      }
    });
  });
});
