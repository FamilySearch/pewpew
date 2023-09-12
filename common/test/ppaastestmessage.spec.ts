import { AgentQueueDescription, LogLevel, PpaasTestMessage, TestMessage, log } from "../src/index";
import { UNIT_TEST_FILENAME, UNIT_TEST_KEY_PREFIX } from "../test/s3.spec";
import {
  mockReceiveMessageAttributes,
  mockSendMessage,
  mockSqs,
  resetMockSqs
} from "../test/mock";
import { MessageAttributeValue } from "@aws-sdk/client-sqs";
import { QUEUE_URL_TEST } from "../src/util/sqs";
import { expect } from "chai";

class PPaasUnitTestMessage extends PpaasTestMessage {
  public constructor (testMessage: TestMessage) {
    super(testMessage);
    this.unittestMessage = true;
  }
}

describe("PpaasTestMessage", () => {
  const testId: string = "UnitTest" + Date.now();
  const s3Folder: string = UNIT_TEST_KEY_PREFIX;
  const yamlFile: string = UNIT_TEST_FILENAME;
  const testRunTimeMn: number = 1;
  let ppaasUnitTestMessage: PPaasUnitTestMessage;
  let ppaasTestMessage: PpaasTestMessage | undefined;
  const fullTestMessage: Required<TestMessage> = {
    testId,
    s3Folder,
    yamlFile,
    testRunTimeMn,
    envVariables: {
      var1: "var1value",
      var2: "var2value",
      var3: "var3value"
    },
    restartOnFailure: true,
    bucketSizeMs: 60000,
    version: "latest",
    additionalFiles: ["file1", "file2"],
    userId: "bruno@madrigal.family",
    bypassParser: false
  };

  before(() => {
    mockSqs();
    log("QUEUE_URL_TEST=" + [...QUEUE_URL_TEST], LogLevel.DEBUG);
    ppaasUnitTestMessage = new PPaasUnitTestMessage({ testId, s3Folder, yamlFile, testRunTimeMn, envVariables: {}, restartOnFailure: true, bucketSizeMs: 60000, version: "latest" });
  });

  after(() => {
    resetMockSqs();
  });

  it("getAvailableQueueNames should always return at least one entry", (done: Mocha.Done) => {
    const queueNames: string[] = PpaasTestMessage.getAvailableQueueNames();
    log(`PpaasTestMessage.getAvailableQueueNames queueNames = ${queueNames}`, queueNames.length > 0 ? LogLevel.DEBUG : LogLevel.ERROR, queueNames);
    expect(queueNames.length, "queueNames = " + JSON.stringify(queueNames)).to.be.greaterThan(0);
    done();
  });

  it("getAvailableQueueMap should always return at least one entry", (done: Mocha.Done) => {
    const queueMap: AgentQueueDescription = PpaasTestMessage.getAvailableQueueMap();
    log("PpaasTestMessage.getAvailableQueueNames queueNames", Object.keys(queueMap).length > 0 ? LogLevel.DEBUG : LogLevel.ERROR, queueMap);
    expect(Object.keys(queueMap).length, "queueMap = " + JSON.stringify(queueMap)).to.be.greaterThan(0);
    done();
  });

  it("Send Test Should succeed", (done: Mocha.Done) => {
    mockSendMessage();
    ppaasUnitTestMessage.send(QUEUE_URL_TEST.keys().next().value).then(() => {
      // As long as we don't throw, it passes
      done();
    }).catch((error) => {
      done(error);
    });
  });

  it("getNewTestToRun should always succeed even if empty", (done: Mocha.Done) => {
    const messageAttributes: Record<string, MessageAttributeValue> = {
      TestId: {
        DataType: "String",
        StringValue: testId
      },
      TestMessage: {
        DataType: "Binary",
        BinaryValue: Buffer.from(JSON.stringify(ppaasUnitTestMessage.getTestMessage()))
      }
    };
    mockReceiveMessageAttributes(messageAttributes);
    PpaasTestMessage.getNewTestToRun().then((result: PpaasTestMessage | undefined) => {
      log(`receiveMessage result = ${result && result.toString()}`, LogLevel.DEBUG);
      expect(result, "result").to.not.equal(undefined);
      expect(result?.receiptHandle, "result.receiptHandle").to.not.equal(undefined);
      expect(result?.testId, "result.testId").to.not.equal(undefined);
      ppaasTestMessage = result;
      done();
    }).catch((error) => {
      done(error);
    });
  });

  it("extendMessageVisibility should succeed", (done: Mocha.Done) => {
    if (ppaasTestMessage === undefined) {
      ppaasTestMessage = new PpaasTestMessage({ testId, s3Folder, yamlFile, testRunTimeMn, envVariables: {}, restartOnFailure: true, bucketSizeMs: 60000, version: "latest" });
    }
    if (ppaasTestMessage.receiptHandle === undefined) {
      ppaasTestMessage.receiptHandle = "unit-test-receipt-handle";
    }
    ppaasTestMessage.extendMessageLockout().then(() => done()).catch((error) => done(error));
  });

  it("deleteMessageFromQueue should succeed", (done: Mocha.Done) => {
    if (ppaasTestMessage === undefined) {
      ppaasTestMessage = new PpaasTestMessage({ testId, s3Folder, yamlFile, testRunTimeMn, envVariables: {}, restartOnFailure: true, bucketSizeMs: 60000, version: "latest" });
    }
    if (ppaasTestMessage.receiptHandle === undefined) {
      ppaasTestMessage.receiptHandle = "unit-test-receipt-handle";
    }
    ppaasTestMessage.deleteMessageFromQueue().then(() => done()).catch((error) => done(error));
  });

  it("getTestMessage should have all properties of a TestMessage", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasTestMessage(fullTestMessage);
    const actualTestMessage = fullPpaasTestMessage.getTestMessage();
    expect(Object.keys(actualTestMessage).length, Object.keys(actualTestMessage).toString() + " length").to.equal(Object.keys(fullTestMessage).length);
    for (const key in actualTestMessage) {
      expect(JSON.stringify(actualTestMessage[key as keyof TestMessage]), key).to.equal(JSON.stringify(fullTestMessage[key as keyof TestMessage]));
    }
    done();
  });

  it("sanitizedCopy should only have the keys of envVariables", (done: Mocha.Done) => {
    const fullPpaasTestMessage = new PpaasTestMessage(fullTestMessage);
    const actualTestMessage = fullPpaasTestMessage.sanitizedCopy();
    expect(Object.keys(actualTestMessage).length, Object.keys(actualTestMessage).toString() + " length").to.equal(Object.keys(fullTestMessage).length);
    for (const key in actualTestMessage) {
      if (key === "envVariables") {
        expect(JSON.stringify(actualTestMessage.envVariables), key).to.equal(JSON.stringify(Object.keys(fullTestMessage.envVariables)));
      } else {
        expect(JSON.stringify(actualTestMessage[key as keyof TestMessage]), key).to.equal(JSON.stringify(fullTestMessage[key as keyof TestMessage]));
      }
    }
    done();
  });
});
