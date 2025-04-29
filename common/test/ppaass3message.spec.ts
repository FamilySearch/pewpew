import {
  CommunicationsMessage,
  LogLevel,
  MessageType,
  PpaasS3Message,
  PpaasTestId,
  log,
  ppaass3message
} from "../src/index.js";
import {
  mockGetObject,
  mockListObject,
  mockListObjects,
  mockS3,
  mockUploadObject,
  resetMockS3
} from "./mock.js";
import { expect } from "chai";

describe("PpaasS3Message", () => {
  let ppaasTestId: PpaasTestId;
  const messageType: MessageType = MessageType.UpdateYaml;
  let ppaasS3Message: PpaasS3Message | undefined;
  let testFilename: string;
  let testFolder: string;
  let fullCommunicationsMessage: Required<CommunicationsMessage>;

  before(() => {
    mockS3();
    ppaasTestId = PpaasTestId.makeTestId("UnitTest");
    testFilename = ppaass3message.createS3Filename(ppaasTestId);
    testFolder = ppaasTestId.s3Folder;
    fullCommunicationsMessage = {
      testId: ppaasTestId.testId,
      messageType,
      messageData: {
        testKey: "testValue",
        secondKey: "secondValue"
      }
    };
  });

  after(async () => {
    // Call delete before the reset mock so we can "test" it
    if (ppaasS3Message) {
      await ppaasS3Message.deleteMessageFromS3();
    }
    resetMockS3();
  });

  it("getCommunicationsMessage should have all properties of a CommunicationsMessage", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasS3Message(fullCommunicationsMessage);
    const actualTestMessage = fullPpaasTestMessage.getCommunicationsMessage();
    expect(Object.keys(actualTestMessage).length, Object.keys(actualTestMessage).toString() + " length").to.equal(Object.keys(fullCommunicationsMessage).length);
    for (const key in actualTestMessage) {
      expect(JSON.stringify(actualTestMessage[key as keyof CommunicationsMessage]), key).to.equal(JSON.stringify(fullCommunicationsMessage[key as keyof CommunicationsMessage]));
    }
    done();
  });

  it("sanitizedCopy should not have messageData", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasS3Message(fullCommunicationsMessage);
    const actualTestMessage = fullPpaasTestMessage.sanitizedCopy();
    expect(Object.keys(actualTestMessage).length, Object.keys(actualTestMessage).toString() + " length").to.equal(Object.keys(fullCommunicationsMessage).length);
    for (const key in actualTestMessage) {
      if (key === "messageData") {
        expect(actualTestMessage.messageData, key).to.equal(undefined);
      } else if (key === "inS3") {
        expect(actualTestMessage.inS3, "inS3").to.equal(false);
      } else {
        expect(JSON.stringify(actualTestMessage[key as keyof CommunicationsMessage]), key).to.equal(JSON.stringify(fullCommunicationsMessage[key as keyof CommunicationsMessage]));
      }
    }
    done();
  });

  describe("Send To Communiations S3 Queue", () => {
    it("PpaasS3Message.send() should succeed", (done: Mocha.Done) => {
      mockUploadObject({ filename: testFilename, folder: testFolder });
      log("creating ppaasUnitS3Message", LogLevel.DEBUG);
      try {
        ppaasS3Message = new PpaasS3Message({ testId: ppaasTestId, messageType, messageData: undefined});
        log("ppaasUnitS3Message", LogLevel.DEBUG, ppaasS3Message.sanitizedCopy());
        ppaasS3Message.send().then((url: string | undefined) => {
          log("PpaasS3Message.send() result: " + url, LogLevel.DEBUG);
          expect(url).to.not.equal(undefined);
          done();
        }).catch((error) => {
          log("PpaasS3Message.send() error", LogLevel.ERROR, error);
          done(error);
        });
      } catch (error) {
        log("Send To Communiations S3 Queue Error", LogLevel.ERROR, error);
        done(error);
      }
    });
  });

  describe("Read From Communiations S3 Queue", () => {
    before (() => {
      if (ppaasS3Message === undefined) {
        // mockUploadObject(testFilename, testFolder);
        ppaasS3Message = new PpaasS3Message({ testId: ppaasTestId, messageType, messageData: undefined });
        log("ppaasUnitS3Message", LogLevel.DEBUG, ppaasS3Message.sanitizedCopy());
        // await ppaasS3Message.send();
      }
    });

    it("PpaasS3Message.getMessage should always succeed even if empty", (done: Mocha.Done) => {
      mockListObjects(undefined);
      PpaasS3Message.getMessage(ppaasTestId).then((result: PpaasS3Message | undefined) => {
        log("PpaasS3Message.getMessage result", LogLevel.DEBUG, result && result.sanitizedCopy());
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => {
        log("PpaasS3Message.getMessage error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("PpaasS3Message.getMessage should always succeed and return on messageType", (done: Mocha.Done) => {
      expect(ppaasS3Message, "ppaasS3Message").to.not.equal(undefined);
      mockListObject(testFilename, testFolder);
      const communicationsMessage: CommunicationsMessage = {
        testId: ppaasTestId.testId,
        messageType: ppaasS3Message!.messageType,
        messageData: undefined
      };
      mockGetObject(JSON.stringify(communicationsMessage), "application/json");
      PpaasS3Message.getMessage(ppaasTestId).then((result: PpaasS3Message | undefined) => {
        log("PpaasS3Message.getMessage result", LogLevel.DEBUG, result && result.sanitizedCopy());
        expect(result).to.not.equal(undefined);
        expect(result?.testId, "testId").to.equal(communicationsMessage.testId);
        expect(result?.messageType, "messageType").to.equal(communicationsMessage.messageType);
        expect(result?.messageData, "messageData").to.equal(communicationsMessage.messageData);
        done();
      }).catch((error) => {
        log("PpaasS3Message.getMessage error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
