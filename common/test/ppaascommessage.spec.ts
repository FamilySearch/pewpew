import {
  CommunicationsMessage,
  LogLevel,
  MessageType,
  PpaasCommunicationsMessage,
  log,
  sqs
} from "../src/index.js";
import {
  mockReceiveMessageAttributes,
  mockReceiveMessages,
  mockSendMessage,
  mockSqs,
  resetMockSqs
} from "./mock.js";
import { MessageAttributeValue } from "@aws-sdk/client-sqs";
// import { QUEUE_URL_COMMUNICATION} from "../src/util/sqs.js";
import { expect } from "chai";

class PPaasUnitCommunicationsMessage extends PpaasCommunicationsMessage {
  public constructor ({ testId,
    messageType,
    messageData }: Partial<CommunicationsMessage>) {
  super({ testId, messageType, messageData });
    this.unittestMessage = true;
  }

  public setReceiptHandle (receiptHandle: string | undefined) {
    this.receiptHandle = receiptHandle;
  }
}

describe("PpaasCommunicationsMessage", () => {
  const testId: string = "UnitTest" + Date.now();
  const messageType: MessageType = MessageType.TestStatus;
  let ppaasUnitCommunicationsMessage: PPaasUnitCommunicationsMessage;
  let fullCommunicationsMessage: Required<CommunicationsMessage>;

  before(() => {
    mockSqs();
    log("QUEUE_URL_COMMUNICATION=" + sqs.QUEUE_URL_COMMUNICATION, LogLevel.DEBUG);
    ppaasUnitCommunicationsMessage = new PPaasUnitCommunicationsMessage({ testId, messageType, messageData: undefined });
    fullCommunicationsMessage = {
      testId,
      messageType,
      messageData: {
        testKey: "testValue",
        secondKey: "secondValue"
      }
    };
  });

  after(() => {
    resetMockSqs();
  });

  it("getCommunicationsMessage should have all properties of a CommunicationsMessage", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasCommunicationsMessage(fullCommunicationsMessage);
    const actualTestMessage = fullPpaasTestMessage.getCommunicationsMessage();
    expect(Object.keys(actualTestMessage).length, Object.keys(actualTestMessage).toString() + " length").to.equal(Object.keys(fullCommunicationsMessage).length);
    for (const key in actualTestMessage) {
      expect(JSON.stringify(actualTestMessage[key as keyof CommunicationsMessage]), key).to.equal(JSON.stringify(fullCommunicationsMessage[key as keyof CommunicationsMessage]));
    }
    done();
  });

  it("sanitizedCopy should not have messageData", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PPaasUnitCommunicationsMessage(fullCommunicationsMessage);
    const expectedReceiptHandle = "testhandle";
    fullPpaasTestMessage.setReceiptHandle(expectedReceiptHandle);
    const actualTestMessage = fullPpaasTestMessage.sanitizedCopy();
    expect(Object.keys(actualTestMessage).length, Object.keys(actualTestMessage).toString() + " length").to.equal(Object.keys(fullCommunicationsMessage).length);
    for (const key in actualTestMessage) {
      if (key === "messageData") {
        expect(actualTestMessage.messageData, key).to.equal(undefined);
      } else if (key === "receiptHandle") {
        expect(actualTestMessage.receiptHandle, key).to.equal(expectedReceiptHandle);
      } else {
        expect(JSON.stringify(actualTestMessage[key as keyof CommunicationsMessage]), key).to.equal(JSON.stringify(fullCommunicationsMessage[key as keyof CommunicationsMessage]));
      }
    }
    done();
  });

  describe("Send To Communiations Retrieval SQS Queue", () => {
    it("PPaasUnitCommunicationsMessage.send() controller Should succeed", (done: Mocha.Done) => {
      mockSendMessage();
      ppaasUnitCommunicationsMessage.send().then((messageId: string | undefined) => {
        expect(messageId).to.not.equal(undefined);
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });

  describe("Read From Communiations Retrieval SQS Queue", () => {
    it("PPaasUnitCommunicationsMessage.getMessage() should always succeed even if empty", (done: Mocha.Done) => {
      mockReceiveMessages(undefined);
      PpaasCommunicationsMessage.getMessage().then((result: PpaasCommunicationsMessage | undefined) => {
        log("getAnyMessageForController result", LogLevel.DEBUG, result && result.sanitizedCopy());
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("PPaasUnitCommunicationsMessage.getMessage() should receive new MessageType", (done: Mocha.Done) => {
      const messageAttributes: Record<string, MessageAttributeValue> = {
        TestId: {
          DataType: "String",
          StringValue: testId
        },
        MessageType: {
          DataType: "String",
          StringValue: MessageType[messageType]
        }
      };
      mockReceiveMessageAttributes(messageAttributes);
      PpaasCommunicationsMessage.getMessage().then((result: PpaasCommunicationsMessage | undefined) => {
        log("getAnyMessageForController result", LogLevel.DEBUG, result && result.sanitizedCopy());
        expect(result).to.not.equal(undefined);
        expect(result?.testId, "testId").to.equal(testId);
        expect(result?.messageType, "messageType").to.equal(messageType);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("PPaasUnitCommunicationsMessage.getMessage() should receive String Data", (done: Mocha.Done) => {
      const messageData = "test message";
      const messageAttributes: Record<string, MessageAttributeValue> = {
        TestId: {
          DataType: "String",
          StringValue: testId
        },
        MessageType: {
          DataType: "String",
          StringValue: MessageType[messageType]
        },
        MessageData: {
          DataType: "String",
          StringValue: messageData
        }
      };
      mockReceiveMessageAttributes(messageAttributes);
      PpaasCommunicationsMessage.getMessage().then((result: PpaasCommunicationsMessage | undefined) => {
        log("getAnyMessageForController result", LogLevel.DEBUG, result && result.sanitizedCopy());
        expect(result).to.not.equal(undefined);
        expect(result?.testId, "testId").to.equal(testId);
        expect(result?.messageType, "messageType").to.equal(messageType);
        expect(result?.messageData, "messageType").to.equal(messageData);
        done();
      }).catch((error) => {
        done(error);
      });
    });

    it("PPaasUnitCommunicationsMessage.getMessage() should receive Binary Data", (done: Mocha.Done) => {
      const messageData = { test: true, text: "test" };
      const messageAttributes: Record<string, MessageAttributeValue> = {
        TestId: {
          DataType: "String",
          StringValue: testId
        },
        MessageType: {
          DataType: "String",
          StringValue: MessageType[messageType]
        },
        MessageData: {
          DataType: "Binary",
          BinaryValue: Buffer.from(JSON.stringify(messageData))
        }
      };
      mockReceiveMessageAttributes(messageAttributes);
      PpaasCommunicationsMessage.getMessage().then((result: PpaasCommunicationsMessage | undefined) => {
        log("getAnyMessageForController result", LogLevel.DEBUG, result && result.sanitizedCopy());
        expect(result).to.not.equal(undefined);
        expect(result?.testId, "testId").to.equal(testId);
        expect(JSON.stringify(result?.messageType), "messageType").to.equal(JSON.stringify(messageType));
        done();
      }).catch((error) => {
        done(error);
      });
    });
  });
});
