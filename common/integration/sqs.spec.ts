import {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageCommandInput,
  GetQueueAttributesCommandInput,
  GetQueueAttributesCommandOutput,
  MessageAttributeValue,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
  Message as SQSMessage,
  SendMessageCommandInput,
  SendMessageCommandOutput
} from "@aws-sdk/client-sqs";
import { LogLevel, SqsQueueType, log, util } from "../src/index";
import {
  QUEUE_URL_COMMUNICATION,
  QUEUE_URL_SCALE_IN,
  QUEUE_URL_TEST,
  changeMessageVisibility,
  changeMessageVisibilityByHandle,
  cleanUpQueue,
  cleanUpQueues,
  deleteMessage,
  deleteMessageByHandle,
  deleteTestScalingMessage,
  getCommunicationMessage,
  getNewTestToRun,
  getQueueAttributes,
  getQueueAttributesMap,
  getTestScalingMessage,
  init as initSqs,
  receiveMessage,
  refreshTestScalingMessage,
  sendMessage,
  sendNewCommunicationsMessage,
  sendNewTestToRun,
  sendTestScalingMessage,
  setAccessCallback,
  config as sqsConfig
} from "../src/util/sqs";

import { expect } from "chai";

const { sleep } = util;

const UNIT_TEST_KEY_PREFIX: string = process.env.UNIT_TEST_KEY_PREFIX || "unittest";
const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
// eslint-disable-next-line eqeqeq
const TEST_CHANGE_VISIBILITY: boolean = process.env.TEST_CHANGE_VISIBILITY?.toLowerCase() == "true";
const CHANGE_VISIBILITY_SLEEP: number = 15 * 1000;
const CHANGE_VISIBILITY_WAIT: number = 60 * 1000;

describe("SqsUtil Integration", () => {
  let expectedQueueUrlTest: string;
  let expectedQueueUrlTestName: string;
  let expectedQueueUrlScale: string;
  let expectedQueueUrlScaleName: string;
  const receiveParamsTest: ReceiveMessageCommandInput = {
    AttributeNames: [
      "All"
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
        "All"
    ],
    QueueUrl: "",
    VisibilityTimeout: 30,
    WaitTimeSeconds: 10
  };

  const receiveParamsScale: ReceiveMessageCommandInput = {
    AttributeNames: [
      "All"
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
        "All"
    ],
    QueueUrl: "",
    VisibilityTimeout: 0, // Don't lock anything out in the real queue
    WaitTimeSeconds: 0
  };

  const receiveParamsComm: ReceiveMessageCommandInput = {
    AttributeNames: [
      "All"
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
        "All"
    ],
    QueueUrl: "",
    VisibilityTimeout: 5,
    WaitTimeSeconds: 0
  };
  let healthCheckDate: Date | undefined;

  before(async () => {
    // reset everything in case the mocks ran.
    sqsConfig.sqsClient = undefined as any;
    initSqs();
    log("QUEUE_URL_TEST=" + [...QUEUE_URL_TEST], LogLevel.DEBUG);
    log("QUEUE_URL_SCALE=" + [...QUEUE_URL_SCALE_IN], LogLevel.DEBUG);
    log("QUEUE_URL_COMMUNICATION=" + QUEUE_URL_COMMUNICATION, LogLevel.DEBUG);
    const startTime = Date.now();
    const total = await cleanUpQueues();
    const duration = Date.now() - startTime;
    // Get the names of the enum and create an object with name to count mapping
    log(`cleanUpQueues ${total}: ${duration}ms`, LogLevel.WARN, { total, duration });

    // Can't set these until after init.
    expectedQueueUrlTest = receiveParamsTest.QueueUrl = QUEUE_URL_TEST.values().next().value;
    expect(typeof expectedQueueUrlTest).to.equal("string");
    expect(expectedQueueUrlTest.length).to.be.greaterThan(0);
    expectedQueueUrlTestName = QUEUE_URL_TEST.keys().next().value;
    expect(typeof expectedQueueUrlTestName).to.equal("string");
    expect(expectedQueueUrlTestName.length).to.be.greaterThan(0);
    expectedQueueUrlScale = receiveParamsScale.QueueUrl = QUEUE_URL_SCALE_IN.values().next().value;
    expect(typeof expectedQueueUrlScale).to.equal("string");
    expect(expectedQueueUrlScale.length).to.be.greaterThan(0);
    expectedQueueUrlScaleName = QUEUE_URL_SCALE_IN.keys().next().value;
    expect(typeof expectedQueueUrlScaleName).to.equal("string");
    expect(expectedQueueUrlScaleName.length).to.be.greaterThan(0);
    receiveParamsComm.QueueUrl = QUEUE_URL_COMMUNICATION;
    log("queueUrl", LogLevel.DEBUG, { expectedQueueUrlScale, expectedQueueUrlScaleName, expectedQueueUrlTest, expectedQueueUrlTestName });
    setAccessCallback((date: Date) => healthCheckDate = date);
  });

  after(async () => {
    const startTime = Date.now();
    const total = await cleanUpQueues();
    const duration = Date.now() - startTime;
    // Get the names of the enum and create an object with name to count mapping
    log(`cleanUpQueues ${total}: ${duration}ms`, LogLevel.WARN, { total, duration });
  });

  describe("SQS Read/Write", () => {
    beforeEach(() => {
      // Set the access callback back undefined
      healthCheckDate = undefined;
    });

    afterEach (() => {
      // If this is still undefined the access callback failed and was not updated with the last access date
      log("afterEach healthCheckDate=" + healthCheckDate, healthCheckDate ? LogLevel.DEBUG : LogLevel.ERROR);
      expect(healthCheckDate).to.not.equal(undefined);
    });

    describe("Read From Test Retrieval SQS Queue", () => {
      it("ReceiveMessage should always succeed even if empty", (done: Mocha.Done) => {
        receiveMessage(receiveParamsTest).then((result: ReceiveMessageCommandOutput) => {
          log("receiveMessage result", LogLevel.DEBUG, result);
          expect(result).to.not.equal(undefined);
          // As long as we don't throw, it passes
          done();
        }).catch((error) => {
          done(error);
        });
      });
    });

    describe("Read From Scale In SQS Queue", () => {
      it("ReceiveMessage should always succeed even if empty", (done: Mocha.Done) => {
        receiveMessage(receiveParamsScale).then((result: ReceiveMessageCommandOutput) => {
          log("receiveMessage result", LogLevel.DEBUG, result);
          expect(result).to.not.equal(undefined);
          // As long as we don't throw, it passes
          done();
        }).catch((error) => {
          done(error);
        });
      });
    });

    describe("Read From Communications Retrieval SQS Queue", () => {
      it("ReceiveMessage should always succeed even if empty", (done: Mocha.Done) => {
        receiveMessage(receiveParamsComm).then((result: ReceiveMessageCommandOutput) => {
          log("receiveMessage result", LogLevel.DEBUG, result);
          expect(result).to.not.equal(undefined);
          // As long as we don't throw, it passes
          done();
        }).catch((error) => {
          done(error);
        });
      });
    });

    describe("Actual Messages From Communications Retrieval SQS Queue", () => {
      const testId: string = "UnitTest" + Date.now(); // Used to identify OUR Unit test message
      let messageHandle: string | undefined;
      const messageAttributes: Record<string, MessageAttributeValue> = {
        UnitTestMessage: {
          DataType: "String",
          StringValue: "true"
        },
        TestId: {
          DataType: "String",
          StringValue: testId
        },
        Recipient: {
          DataType: "String",
          StringValue: "UnitTest"
        },
        Sender: {
          DataType: "String",
          StringValue: "UnitTest"
        },
        Message: {
          DataType: "String",
          StringValue: "UnitTest"
        }
      };

      before (async () => {
        const sqsMessageRequest: SendMessageCommandInput = {
          MessageAttributes: messageAttributes,
          MessageBody: "Sending Message to the Communications Queue",
          QueueUrl: QUEUE_URL_COMMUNICATION
        };
        log("sendMessage request", LogLevel.DEBUG, sqsMessageRequest);
        await sendMessage(sqsMessageRequest);
      });

      after (async () => {
        if (messageHandle) {
          const sqsDeleteRequest: DeleteMessageCommandInput = {
            ReceiptHandle: messageHandle,
            QueueUrl: QUEUE_URL_COMMUNICATION
          };
          log("deleteMessage request", LogLevel.DEBUG, sqsDeleteRequest);
          await deleteMessage(sqsDeleteRequest);
        }
      });

      it("ReceiveMessage Communications should receive a message", (done: Mocha.Done) => {
        receiveMessage({ ...receiveParamsComm, WaitTimeSeconds: 1 }).then((result: ReceiveMessageCommandOutput) => {
          log("receiveMessage result", LogLevel.DEBUG, result);
          expect(result, "receiveMessage result " + JSON.stringify(result)).to.not.equal(undefined);
          expect(result.Messages, "receiveMessage result.messages").to.not.equal(undefined);
          expect(result.Messages!.length, "receiveMessage result length " + JSON.stringify(result)).to.be.greaterThan(0);
          // But we need to grab the handle for clean-up
          if (result && result.Messages && result.Messages.length > 0) {
            for (const message of result.Messages) {
              const receivedAttributes: Record<string, MessageAttributeValue> | undefined = message.MessageAttributes;
              if (receivedAttributes && Object.keys(receivedAttributes).includes("TestId") && receivedAttributes["TestId"].StringValue === testId) {
                messageHandle = message.ReceiptHandle;
              }
            }
          }
          done();
        }).catch((error) => {
          done(error);
        });
      });
    });

    describe("Actual Communications From Communications Retrieval SQS Queue", () => {
      const testId: string = "UnitTest" + Date.now(); // Used to identify OUR Unit test message
      const messageAttributes: Record<string, MessageAttributeValue> = {
        UnitTestMessage: {
          DataType: "String",
          StringValue: "true"
        },
        TestId: {
          DataType: "String",
          StringValue: testId
        },
        Recipient: {
          DataType: "String",
          StringValue: "UnitTest"
        },
        Sender: {
          DataType: "String",
          StringValue: "UnitTest"
        },
        Message: {
          DataType: "String",
          StringValue: "UnitTest"
        }
      };

      before (async () => {
        log("sendNewCommunicationsMessage request", LogLevel.DEBUG, messageAttributes);
        await sendNewCommunicationsMessage(messageAttributes);
      });

      after (async () => {
        const cleanUpParams: ReceiveMessageCommandInput = {
          AttributeNames: [
            "All"
          ],
          MaxNumberOfMessages: 1,
          MessageAttributeNames: [
              "All"
          ],
          QueueUrl: QUEUE_URL_COMMUNICATION,
          VisibilityTimeout: 10,
          WaitTimeSeconds: 0
        };
        let result: ReceiveMessageCommandOutput = await receiveMessage(cleanUpParams);
        while (result && Array.isArray(result.Messages) && result.Messages.length > 0) {
          for (const message of result.Messages) {
            await deleteMessageByHandle({ messageHandle: message.ReceiptHandle!, sqsQueueType: SqsQueueType.Communications });
          }
          result = await receiveMessage(cleanUpParams);
        }
      });

      it("getCommunicationMessages should receive a message", (done: Mocha.Done) => {
        getCommunicationMessage().then((message: SQSMessage | undefined) => {
          log("getCommunicationMessages result", LogLevel.DEBUG, message);
          expect(message, "getCommunicationMessages result " + JSON.stringify(message)).to.not.equal(undefined);
          // But we need to grab the handle for clean-up
          done();
        }).catch((error) => {
          done(error);
        });
      });
    });

    describe("Send to Real SQS Test Queue", () => {
      const messageAttributes: Record<string, MessageAttributeValue> = {
        UnitTestMessage: {
          DataType: "String",
          StringValue: "true"
        },
        TestId: {
          DataType: "String",
          StringValue: "UnitTest" + Date.now()
        },
        S3Folder: {
          DataType: "String",
          StringValue: UNIT_TEST_KEY_PREFIX
        },
        YamlFile: {
          DataType: "String",
          StringValue: UNIT_TEST_FILENAME
        },
        TestRunTime: {
          DataType: "String",
          StringValue: "1"
        }
      };

      after (async () => {
        const cleanUpParams: ReceiveMessageCommandInput = {
          AttributeNames: [
            "All"
          ],
          MaxNumberOfMessages: 1,
          MessageAttributeNames: [
              "All"
          ],
          QueueUrl: QUEUE_URL_TEST.values().next().value,
          VisibilityTimeout: 10,
          WaitTimeSeconds: 0
        };
        let result: ReceiveMessageCommandOutput = await receiveMessage(cleanUpParams);
        while (result && Array.isArray(result.Messages) && result.Messages.length > 0) {
          for (const message of result.Messages) {
            await deleteMessageByHandle({ messageHandle: message.ReceiptHandle!, sqsQueueType: SqsQueueType.Communications });
          }
          result = await receiveMessage(cleanUpParams);
        }
      });

      async function testChangeVisibility (message: SQSMessage): Promise<void> {
        log("testChangeVisibility", LogLevel.DEBUG, { message, TEST_CHANGE_VISIBILITY });
        if (!TEST_CHANGE_VISIBILITY || !message.ReceiptHandle) {
          return;
        }
        const changeMessageVisibilityRequest: ChangeMessageVisibilityCommandInput = {
          QueueUrl: receiveParamsTest.QueueUrl,
          VisibilityTimeout: receiveParamsTest.VisibilityTimeout!,
          ReceiptHandle: message.ReceiptHandle
        };
        try {
          const start: number = Date.now();
          log("testChangeVisibility start", LogLevel.DEBUG, { start });
          // loop sleeping for 15 seconds and then locking out the message again with changeVisibility
          do {
            log("testChangeVisibility changeMessageVisibility", LogLevel.DEBUG, changeMessageVisibilityRequest);
            await changeMessageVisibility(changeMessageVisibilityRequest);
            await sleep(CHANGE_VISIBILITY_SLEEP);
          } while (Date.now() - start < CHANGE_VISIBILITY_WAIT);
          log("testChangeVisibility end", LogLevel.DEBUG, { start: new Date(start), end: new Date() });
          // After x minutes, make sure we can't "get" the message
          const result: ReceiveMessageCommandOutput = await receiveMessage({ ...receiveParamsTest, WaitTimeSeconds: 3 });
          log("testChangeVisibility result", LogLevel.DEBUG, result);
          if (result.Messages && result.Messages.length > 0) {
            const duplicateMessage = result.Messages[0];
            log("changeMessageVisibility didn't lock out", LogLevel.WARN, { message, duplicateMessage, result });
            if (duplicateMessage.ReceiptHandle) {
              deleteMessageByHandle({ messageHandle: duplicateMessage.ReceiptHandle, sqsQueueType: SqsQueueType.Test })
              .catch((error) => log("Could not delete duplicate message", LogLevel.ERROR, error));
            }
            throw new Error("changeMessageVisibility didn't lock out");
          }
        } catch (error) {
          log(`Error testing changeMessageVisibility for ${message.ReceiptHandle}: ${error}`, LogLevel.ERROR, error);
          throw error;
        }
      }

      async function testChangeVisibilityByHandle (message: SQSMessage): Promise<void> {
        log("testChangeVisibilityByHandle", LogLevel.DEBUG, { message, TEST_CHANGE_VISIBILITY });
        if (!TEST_CHANGE_VISIBILITY || !message.ReceiptHandle) {
          return;
        }
        try {
          const start: number = Date.now();
          log("testChangeVisibilityByHandle start", LogLevel.DEBUG, { start });
          // loop sleeping for 15 seconds and then locking out the message again with changeVisibility
          do {
            log("testChangeVisibilityByHandle changeMessageVisibilityByHandle", LogLevel.DEBUG);
            await changeMessageVisibilityByHandle({ messageHandle: message.ReceiptHandle, sqsQueueType: SqsQueueType.Test });
            await sleep(CHANGE_VISIBILITY_SLEEP);
          } while (Date.now() - start < CHANGE_VISIBILITY_WAIT);
          log("testChangeVisibilityByHandle end", LogLevel.DEBUG, { start: new Date(start), end: new Date() });
          // After x minutes, make sure we can't "get" the message
          const result: ReceiveMessageCommandOutput = await receiveMessage({ ...receiveParamsTest, WaitTimeSeconds: 3 });
          log("testChangeVisibilityByHandle result", LogLevel.DEBUG, result);
          if (result.Messages && result.Messages.length > 0) {
            const duplicateMessage = result.Messages[0];
            log("changeMessageVisibilityByHandle didn't lock out", LogLevel.WARN, { message, duplicateMessage, result });
            if (duplicateMessage.ReceiptHandle) {
              deleteMessageByHandle({ messageHandle: duplicateMessage.ReceiptHandle, sqsQueueType: SqsQueueType.Test })
              .catch((error) => log("Could not delete duplicate message", LogLevel.ERROR, error));
            }
            throw new Error("changeMessageVisibilityByHandle didn't lock out");
          }
        } catch (error) {
          log(`Error testing changeMessageVisibilityByHandle for ${message.ReceiptHandle}: ${error}`, LogLevel.ERROR, error);
          throw error;
        }
      }

      it("SendMessage should succeed", (done: Mocha.Done) => {
        const realSendParams: SendMessageCommandInput = {
          MessageAttributes: messageAttributes,
          MessageBody: "Integration Test",
          QueueUrl: receiveParamsTest.QueueUrl
        };
        log("Send Test request", LogLevel.DEBUG, realSendParams);
        // Start the receive, and while it's waiting, send the message
        receiveMessage(receiveParamsTest).then((result: ReceiveMessageCommandOutput) => {
          log(`receiveMessage result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
          expect(result, "result").to.not.equal(undefined);
          expect(result.Messages, "result.Messages").to.not.equal(undefined);
          expect(result.Messages!.length, "result.Messages.length").to.equal(1);
          if (result && result.Messages && result.Messages.length > 0) {
            const message = result.Messages[0];
            expect(message.MessageAttributes, "message.MessageAttributes").to.not.equal(undefined);
            expect(Object.keys(message.MessageAttributes!)).to.include("UnitTestMessage");
            if (message.ReceiptHandle) {
              testChangeVisibility(message).then(() => {
                const params: DeleteMessageCommandInput = {
                  QueueUrl: QUEUE_URL_TEST.values().next().value,
                  ReceiptHandle: message.ReceiptHandle!
                };
                deleteMessage(params).then(() => {
                  log("deleteMessage Success", LogLevel.DEBUG);
                  done();
                }).catch((error) => {
                  log("deleteMessage Error", LogLevel.ERROR, error);
                  done(error);
                });
              }).catch((error) => {
                log("testChangeVisibility Error", LogLevel.ERROR, error);
                done(error);
              });
            } else {
              done();
            }
          } else {
            done(new Error("Did not receive message"));
          }
        }).catch((error) => {
          log("receiveMessage", LogLevel.ERROR, error);
          done(error);
        });
        // This send is asynchronous from the receive above
        sendMessage(realSendParams)
        .then((result: SendMessageCommandOutput) => {
          log("sendMessage Success: " + result.MessageId, LogLevel.DEBUG, result);
          expect(result).to.not.equal(undefined);
          expect(result.MessageId).to.not.equal(undefined);
        })
        .catch((error) => {
          log("sendMessage Error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("sendNewTestToRun should succeed", (done: Mocha.Done) => {
        log("Send Test attributes", LogLevel.DEBUG, messageAttributes);
        // Start the receive, and while it's waiting, send the message
        getNewTestToRun().then((message: SQSMessage | undefined) => {
          log(`getNewTestToRun result = ${JSON.stringify(message)}`, LogLevel.DEBUG);
          expect(message, "message").to.not.equal(undefined);
          expect(message!.MessageAttributes, "message.MessageAttributes").to.not.equal(undefined);
          expect(Object.keys(message!.MessageAttributes!)).to.include("UnitTestMessage");
          if (message && message.ReceiptHandle) {
            testChangeVisibilityByHandle(message).then(() => {
              deleteMessageByHandle({ messageHandle: message.ReceiptHandle!, sqsQueueType: SqsQueueType.Test }).then(() => {
                log("deleteMessageByHandle Success", LogLevel.DEBUG);
                done();
              }).catch((error) => {
                log("deleteMessageByHandle Error", LogLevel.ERROR, error);
                done(error);
              });
            }).catch((error) => {
              log("changeMessageVisibilityByHandle Error", LogLevel.ERROR, error);
              done(error);
            });
          } else {
            done();
          }
        }).catch((error) => {
          done(error);
        });
        // This send is asynchronous from the receive above
        sendNewTestToRun(messageAttributes, expectedQueueUrlTestName)
        .then((messageId: string | undefined) => {
          log("Send Test Success: " + messageId, LogLevel.DEBUG, messageId);
          expect(messageId).to.not.equal(undefined);
        }).catch((err) => {
          log("Send Test Error", LogLevel.ERROR, err);
          done(err);
        });
      });
    });

    describe("Send to Real SQS Scale Queue", () => {
      async function validateAndCleanupQueue (sizeExpected: number): Promise<void> {
        try {
          await sleep(1000);
          // getQueueAttributesMap was unreliable to get the size. Changed the clean-up to return a count.
          const sizeAfter: number = await cleanUpQueue(SqsQueueType.Scale);
          expect(sizeAfter, "sizeAfter").to.equal(sizeExpected);
        } catch (error) {
          log("validateQueue: Error getting the size of the scaling queue", LogLevel.ERROR, error);
          throw error;
        }
      }

      beforeEach(async () => {
        await cleanUpQueue(SqsQueueType.Scale);
      });

      after(async () => {
        await cleanUpQueue(SqsQueueType.Scale);
      });

      it("sendTestScalingMessage should succeed", (done: Mocha.Done) => {
        // Start the receive, and while it's waiting, send the message
        getTestScalingMessage().then((message: SQSMessage | undefined) => {
          log(`getTestScalingMessage result = ${JSON.stringify(message)}`, LogLevel.DEBUG);
          // As long as we don't throw, it passes
          if (message && message.ReceiptHandle && message.MessageAttributes && Object.keys(message.MessageAttributes).includes("Scale")) {
            deleteMessageByHandle({ messageHandle: message.ReceiptHandle, sqsQueueType: SqsQueueType.Scale }).then(() => {
              log("deleteMessageByHandle Success", LogLevel.DEBUG);
              done();
            })
            .catch((error) => {
              log("deleteMessageByHandle Error", LogLevel.ERROR, error);
              done(error);
            });
          } else {
            done();
          }
        }).catch((error) => {
          log("getTestScalingMessage Error", LogLevel.ERROR, error);
          done(error);
        });
        // This send is asynchronous from the receive above
        sendTestScalingMessage()
        .then((messageId: string | undefined) => {
          log("Send Scale Success: " + messageId, LogLevel.DEBUG, messageId);
          expect(messageId).to.not.equal(undefined);
        }).catch((err) => {
          log("Send Scale Error", LogLevel.ERROR, err);
          done(err);
        });
      });

      it("refreshTestScalingMessage should succeed if empty", (done: Mocha.Done) => {
        refreshTestScalingMessage().then((result: string | undefined) => {
          log(`refreshTestScalingMessage result = ${result}`, LogLevel.DEBUG);
          expect(result, "result").to.not.equal(undefined);
          validateAndCleanupQueue(1).then(() => done())
          .catch((error) => {
            log("validateQueue error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((error) => {
          log("refreshTestScalingMessage error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("refreshTestScalingMessage should succeed if has 1", (done: Mocha.Done) => {
        sendTestScalingMessage()
        .then((messageId: string | undefined) => {
          log("Send Scale Success: " + messageId, LogLevel.DEBUG, messageId);
          expect(messageId).to.not.equal(undefined);
          refreshTestScalingMessage().then((result: string | undefined) => {
            log(`refreshTestScalingMessage result = ${result}`, LogLevel.DEBUG);
            expect(result, "result").to.not.equal(undefined);
            validateAndCleanupQueue(1).then(() => done())
            .catch((error) => {
              log("validateQueue error", LogLevel.ERROR, error);
              done(error);
            });
          }).catch((error) => {
            log("refreshTestScalingMessage error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((err) => {
          log("Send Scale Error", LogLevel.ERROR, err);
          done(err);
        });
      });

      it("refreshTestScalingMessage should succeed if has 2", (done: Mocha.Done) => {
        sendTestScalingMessage()
        .then((messageId: string | undefined) => {
          log("Send Scale Success: " + messageId, LogLevel.DEBUG, messageId);
          expect(messageId).to.not.equal(undefined);
          sendTestScalingMessage()
          .then((messageId2: string | undefined) => {
            log("Send Scale Success: " + messageId2, LogLevel.DEBUG, messageId2);
            expect(messageId2).to.not.equal(undefined);
            refreshTestScalingMessage().then((result: string | undefined) => {
              log(`refreshTestScalingMessage result = ${result}`, LogLevel.DEBUG);
              expect(result, "result").to.not.equal(undefined);
              validateAndCleanupQueue(2).then(() => done())
              .catch((error) => {
                log("validateQueue error", LogLevel.ERROR, error);
                done(error);
              });
            }).catch((error) => {
              log("refreshTestScalingMessage error", LogLevel.ERROR, error);
              done(error);
            });
          }).catch((err) => {
            log("Send Scale Error", LogLevel.ERROR, err);
            done(err);
          });
        }).catch((err) => {
          log("Send Scale Error", LogLevel.ERROR, err);
          done(err);
        });
      });

      it("deleteTestScalingMessage should succeed if empty", (done: Mocha.Done) => {
        deleteTestScalingMessage().then((dmessageId: string | undefined) => {
          expect(dmessageId, "dmessageId").to.equal(undefined);
          validateAndCleanupQueue(0).then(() => done())
          .catch((error) => {
            log("validateQueue error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((error) => {
          log("deleteTestScalingMessage error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("deleteTestScalingMessage should succeed if has 1", (done: Mocha.Done) => {
        sendTestScalingMessage()
        .then((messageId: string | undefined) => {
          log("Send Scale Success: " + messageId, LogLevel.DEBUG, messageId);
          expect(messageId).to.not.equal(undefined);
          deleteTestScalingMessage().then((dmessageId: string | undefined) => {
            expect(dmessageId, "dmessageId").to.not.equal(undefined);
            validateAndCleanupQueue(0).then(() => done())
            .catch((error) => {
              log("validateQueue error", LogLevel.ERROR, error);
              done(error);
            });
          }).catch((error) => {
            log("deleteTestScalingMessage error", LogLevel.ERROR, error);
            done(error);
          });
        }).catch((err) => {
          log("Send Scale Error", LogLevel.ERROR, err);
          done(err);
        });
      });

      it("deleteTestScalingMessage should succeed if has 2", (done: Mocha.Done) => {
        sendTestScalingMessage()
        .then((messageId: string | undefined) => {
          log("Send Scale Success: " + messageId, LogLevel.DEBUG, messageId);
          expect(messageId).to.not.equal(undefined);
          sendTestScalingMessage()
          .then((messageId2: string | undefined) => {
            log("Send Scale Success2: " + messageId2, LogLevel.DEBUG, messageId2);
            expect(messageId2).to.not.equal(undefined);
            deleteTestScalingMessage().then((dmessageId: string | undefined) => {
              expect(dmessageId, "dmessageId").to.not.equal(undefined);
              validateAndCleanupQueue(1).then(() => done())
              .catch((error) => {
                log("validateQueue error", LogLevel.ERROR, error);
                done(error);
              });
            }).catch((error) => {
              log("deleteTestScalingMessage error", LogLevel.ERROR, error);
              done(error);
            });
          }).catch((err) => {
            log("Send Scale Error", LogLevel.ERROR, err);
            done(err);
          });
        }).catch((err) => {
          log("Send Scale Error", LogLevel.ERROR, err);
          done(err);
        });
      });
    });
  });

  describe("SQS getQueueAttributes", () => {
    it("should getQueueAttributes with test params", (done: Mocha.Done) => {
      const params: GetQueueAttributesCommandInput = {
        QueueUrl: QUEUE_URL_TEST.values().next().value,
        AttributeNames: ["All"]
      };
      getQueueAttributes(params).then((result: GetQueueAttributesCommandOutput) => {
        log("getQueueAttributes() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.Attributes).to.not.equal(undefined);
        expect(result.Attributes!.QueueArn).to.not.equal(undefined);
        expect(result.Attributes!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result.Attributes!.ApproximateNumberOfMessages, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributes() error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should getQueueAttributes with scale params", (done: Mocha.Done) => {
      const params: GetQueueAttributesCommandInput = {
        QueueUrl: QUEUE_URL_SCALE_IN.values().next().value,
        AttributeNames: ["All"]
      };
      getQueueAttributes(params).then((result: GetQueueAttributesCommandOutput) => {
        log("getQueueAttributes() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.Attributes).to.not.equal(undefined);
        expect(result.Attributes!.QueueArn).to.not.equal(undefined);
        expect(result.Attributes!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result.Attributes!.ApproximateNumberOfMessages, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributes() error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should getQueueAttributes with communications params", (done: Mocha.Done) => {
      const params: GetQueueAttributesCommandInput = {
        QueueUrl: QUEUE_URL_COMMUNICATION,
        AttributeNames: ["All"]
      };
      getQueueAttributes(params).then((result: GetQueueAttributesCommandOutput) => {
        log("getQueueAttributes() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.Attributes).to.not.equal(undefined);
        expect(result.Attributes!.QueueArn).to.not.equal(undefined);
        expect(result.Attributes!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result.Attributes!.ApproximateNumberOfMessages, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributes() error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should getQueueAttributesMap with test params", (done: Mocha.Done) => {
      getQueueAttributesMap(SqsQueueType.Test, expectedQueueUrlTestName).then((result: Record<string, string> | undefined) => {
        log("getQueueAttributesMap() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result!.QueueArn).to.not.equal(undefined);
        expect(result!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result!.ApproximateNumberOfMessages, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributesMap() error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should getQueueAttributesMap with scale params", (done: Mocha.Done) => {
      getQueueAttributesMap(SqsQueueType.Scale, expectedQueueUrlScaleName).then((result: Record<string, string> | undefined) => {
        log("getQueueAttributesMap() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result!.QueueArn).to.not.equal(undefined);
        expect(result!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result!.ApproximateNumberOfMessages, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributesMap() error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should getQueueAttributesMap with communications params", (done: Mocha.Done) => {
      getQueueAttributesMap(SqsQueueType.Communications).then((result: Record<string, string> | undefined) => {
        log("getQueueAttributesMap() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result!.QueueArn).to.not.equal(undefined);
        expect(result!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result!.ApproximateNumberOfMessages, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributesMap() error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
