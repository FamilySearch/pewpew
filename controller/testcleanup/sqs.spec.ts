import {
  LogLevel,
  SqsQueueType,
  log,
  sqs
} from "@fs/ppaas-common";
import {
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput
} from "@aws-sdk/client-sqs";
import { expect } from "chai";

// Clean-up for the integration/acceptance tests when run locally.
// On the real build environments they go away, but not on unittest
describe("SQSCleanup", () => {
  sqs.setAccessCallback((date: Date) => log("SQSCleanup SQS Access Callback: " + date, LogLevel.DEBUG));
  const queueTypes: SqsQueueType[] = [SqsQueueType.Test, SqsQueueType.Scale, SqsQueueType.Communications];
  const receiveMessageParams: Omit<ReceiveMessageCommandInput, "QueueUrl"> = {
    AttributeNames: ["All"],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: ["All"],
    VisibilityTimeout: 1,
    WaitTimeSeconds: 1
  };

  before (async () => {
    sqs.init();
    const startTime = Date.now();
    const total = await sqs.cleanUpQueues();
    const duration = Date.now() - startTime;
    log(`cleanUpQueue ${total}: ${duration}ms`, LogLevel.WARN, { total, duration });
  });

  it("queue should be empty", (done: Mocha.Done) => {
    Promise.all(queueTypes.map((queueType) => sqs.getQueueAttributesMap(queueType)))
    .then((queueAttributeMaps: (Record<string, string> | undefined)[]) => {
      log("getQueueAttributesMap()", LogLevel.DEBUG, queueAttributeMaps);
      for (const [i, queueAttributeMap] of queueAttributeMaps.entries()) {
        const queueTypeName = SqsQueueType[queueTypes[i]];
        expect(queueAttributeMap, "queueAttributeMap " + queueTypeName).to.not.equal(undefined);
        // These are strings not numbers
        expect(queueAttributeMap!.ApproximateNumberOfMessages, "queueAttributeMap.ApproximateNumberOfMessages " + queueTypeName).to.equal("0");
        expect(queueAttributeMap!.ApproximateNumberOfMessagesNotVisible, "queueAttributeMap.ApproximateNumberOfMessagesNotVisible " + queueTypeName).to.equal("0");
        expect(queueAttributeMap!.ApproximateNumberOfMessagesDelayed, "queueAttributeMap.ApproximateNumberOfMessagesDelayed " + queueTypeName).to.equal("0");
      }
      done();
    }).catch((error) => done(error));
  });

  it("receive should be empty", (done: Mocha.Done) => {
    Promise.all(queueTypes.map((queueType) => sqs.receiveMessage({ ...receiveMessageParams, QueueUrl: sqs.getQueueUrl(queueType) })))
    .then((results: ReceiveMessageCommandOutput[]) => {
      log("result: SQS.ReceiveMessageResult", LogLevel.DEBUG, results);
      for (const [i, result] of results.entries()) {
        const queueTypeName = SqsQueueType[queueTypes[i]];
        expect(result, "result " + queueTypeName).to.not.equal(undefined);
        expect(result.Messages, "result.Messages " + queueTypeName).to.equal(undefined);
      }
      done();
    }).catch((error) => done(error));
  });
});
