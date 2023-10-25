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
import { LogLevel, SqsQueueType, log } from "../src/index";
import {
  QUEUE_URL_COMMUNICATION,
  QUEUE_URL_SCALE_IN,
  QUEUE_URL_TEST,
  changeMessageVisibility,
  changeMessageVisibilityByHandle,
  deleteMessage,
  deleteMessageByHandle,
  deleteTestScalingMessage,
  getCommunicationMessage,
  getNewTestToRun,
  getQueueAttributes,
  getQueueAttributesMap,
  getQueueUrl,
  getTestScalingMessage,
  receiveMessage,
  refreshTestScalingMessage,
  sendMessage,
  sendNewCommunicationsMessage,
  sendNewTestToRun,
  sendTestScalingMessage,
  setAccessCallback
} from "../src/util/sqs";
import {
  mockGetQueueAttributes,
  mockReceiveMessageAttributes,
  mockReceiveMessages,
  mockSendMessage,
  mockSqs,
  resetMockSqs
} from "./mock";
import { expect } from "chai";


describe("SqsUtil", () => {
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

  before(() => {
    mockSqs();
    log("QUEUE_URL_TEST=" + [...QUEUE_URL_TEST], LogLevel.DEBUG);
    log("QUEUE_URL_SCALE=" + [...QUEUE_URL_SCALE_IN], LogLevel.DEBUG);
    log("QUEUE_URL_COMMUNICATION=" + QUEUE_URL_COMMUNICATION, LogLevel.DEBUG);
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

  after(() => {
    // Reset the mock
    resetMockSqs();
  });

  describe("getQueueUrl", () => {
    it("Should return communications", (done: Mocha.Done) => {
      try {
        expect(getQueueUrl(SqsQueueType.Communications)).to.equal(QUEUE_URL_COMMUNICATION);
        done();
      } catch (error) {
        log("getQueueUrl error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return test default", (done: Mocha.Done) => {
      try {
        expect(getQueueUrl(SqsQueueType.Test)).to.equal(expectedQueueUrlTest);
        done();
      } catch (error) {
        log("getQueueUrl error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return scale default", (done: Mocha.Done) => {
      try {
        expect(getQueueUrl(SqsQueueType.Scale)).to.equal(expectedQueueUrlScale);
        done();
      } catch (error) {
        log("getQueueUrl error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return test named", (done: Mocha.Done) => {
      try {
        expect(getQueueUrl(SqsQueueType.Test, expectedQueueUrlTestName)).to.equal(expectedQueueUrlTest);
        done();
      } catch (error) {
        log("getQueueUrl error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should return scale named", (done: Mocha.Done) => {
      try {
        expect(getQueueUrl(SqsQueueType.Scale, expectedQueueUrlScaleName)).to.equal(expectedQueueUrlScale);
        done();
      } catch (error) {
        log("getQueueUrl error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should ignore communications named", (done: Mocha.Done) => {
      try {
        expect(getQueueUrl(SqsQueueType.Communications, "invalid")).to.equal(QUEUE_URL_COMMUNICATION);
        done();
      } catch (error) {
        log("getQueueUrl error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("Should error on test invalid named", (done: Mocha.Done) => {
      try {
        const queueUrl = getQueueUrl(SqsQueueType.Test, "invalid");
        done(new Error("invalid named should throw, got " + JSON.stringify(queueUrl)));
      } catch (error) {
        log("getQueueUrl error", LogLevel.DEBUG, error);
        expect(`${error}`).to.include("No such Queue found");
        done();
      }
    });

    it("Should error on scale invalid named", (done: Mocha.Done) => {
      try {
        const queueUrl = getQueueUrl(SqsQueueType.Scale, "invalid");
        done(new Error("invalid named should throw, got " + JSON.stringify(queueUrl)));
      } catch (error) {
        log("getQueueUrl error", LogLevel.DEBUG, error);
        expect(`${error}`).to.include("No such Queue found");
        done();
      }
    });
  });

  describe("SQS Read/Write", () => {
    beforeEach( () => {
      // Set the access callback back undefined
      healthCheckDate = undefined;
    });

    afterEach ( () => {
      // If this is still undefined the access callback failed and was not updated with the last access date
      log("afterEach healthCheckDate=" + healthCheckDate, healthCheckDate ? LogLevel.DEBUG : LogLevel.ERROR);
      expect(healthCheckDate).to.not.equal(undefined);
    });

    describe("Read From Test Retrieval SQS Queue", () => {
      it("ReceiveMessage should always succeed even if empty", (done: Mocha.Done) => {
        mockReceiveMessages(undefined);
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
        mockReceiveMessages(undefined);
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
        mockReceiveMessages(undefined);
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
        mockSendMessage();
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
        mockReceiveMessageAttributes(messageAttributes);
        receiveMessage(receiveParamsComm).then((result: ReceiveMessageCommandOutput) => {
          log("receiveMessage result", LogLevel.DEBUG, result);
          expect(result, "receiveMessage result " + JSON.stringify(result)).to.not.equal(undefined);
          expect(result.Messages && result.Messages.length, "receiveMessage result length " + JSON.stringify(result)).to.be.greaterThan(0);
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
        log("sendNewCommunicationsMessage request", LogLevel.DEBUG, messageAttributes);
        mockSendMessage();
        await sendNewCommunicationsMessage(messageAttributes);
      });

      after (async () => {
        if (messageHandle) {
          await deleteMessageByHandle({ messageHandle, sqsQueueType: SqsQueueType.Communications });
        }
      });

      it("getCommunicationMessages should receive a message", (done: Mocha.Done) => {
        mockReceiveMessageAttributes(messageAttributes);
        getCommunicationMessage().then((message: SQSMessage | undefined) => {
          log("getCommunicationMessages result", LogLevel.DEBUG, message);
          expect(message, "getCommunicationMessages result " + JSON.stringify(message)).to.not.equal(undefined);
          // But we need to grab the handle for clean-up
          messageHandle = message!.ReceiptHandle;
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
          StringValue: "unittest"
        },
        YamlFile: {
          DataType: "String",
          StringValue: "unittest.yaml"
        },
        TestRunTime: {
          DataType: "String",
          StringValue: "1"
        }
      };

      it("SendMessage should succeed", (done: Mocha.Done) => {
        const realSendParams: SendMessageCommandInput = {
          MessageAttributes: messageAttributes,
          MessageBody: "Integration Test",
          QueueUrl: receiveParamsTest.QueueUrl
        };
        log("Send Test request", LogLevel.DEBUG, realSendParams);
        // Start the receive, and while it's waiting, send the message
        mockReceiveMessageAttributes(messageAttributes);
        receiveMessage(receiveParamsTest).then((result: ReceiveMessageCommandOutput) => {
          log(`receiveMessage result = ${JSON.stringify(result)}`, LogLevel.DEBUG);
          // As long as we don't throw, it passes
          if (result && result.Messages && result.Messages.length > 0) {
            const message = result.Messages[0];
            expect(message.MessageAttributes).to.not.equal(undefined);
            expect(Object.keys(message.MessageAttributes!)).to.include("UnitTestMessage");
            if (message.ReceiptHandle) {
              const changeMessageVisibilityRequest: ChangeMessageVisibilityCommandInput = {
                QueueUrl: receiveParamsTest.QueueUrl,
                VisibilityTimeout: receiveParamsTest.VisibilityTimeout!,
                ReceiptHandle: message.ReceiptHandle
              };
              changeMessageVisibility(changeMessageVisibilityRequest).then(() => {
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
                log("changeMessageVisibility Error", LogLevel.ERROR, error);
                done(error);
              });
            } else {
              done();
            }
          } else {
            done();
          }
        }).catch((error) => {
          log("receiveMessage", LogLevel.ERROR, error);
          done(error);
        });
        // This send is asynchronous from the receive above
        mockSendMessage();
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
        mockReceiveMessageAttributes(messageAttributes);
        getNewTestToRun().then((message: SQSMessage | undefined) => {
          log(`getNewTestToRun result = ${JSON.stringify(message)}`, LogLevel.DEBUG);
          // As long as we don't throw, it passes
          if (message && message.ReceiptHandle) {
            expect(message.MessageAttributes).to.not.equal(undefined);
            expect(Object.keys(message.MessageAttributes!)).to.include("UnitTestMessage");
            const params = {
              messageHandle: message.ReceiptHandle,
              sqsQueueType: SqsQueueType.Test
            };
            changeMessageVisibilityByHandle(params).then(() => {
              deleteMessageByHandle(params).then(() => {
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
        mockSendMessage();
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
      const messageAttributes: Record<string, MessageAttributeValue> = {
        Scale: {
          StringValue: "test",
          DataType: "String"
        }
      };
      it("sendTestScalingMessage should succeed", (done: Mocha.Done) => {
        // Start the receive, and while it's waiting, send the message
        mockReceiveMessageAttributes(messageAttributes);
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
        mockSendMessage();
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
        mockReceiveMessages();
        refreshTestScalingMessage().then((result: string | undefined) => {
          log(`refreshTestScalingMessage result = ${result}`, LogLevel.DEBUG);
          expect(result, "result").to.not.equal(undefined);
          done();
        }).catch((error) => {
          log("refreshTestScalingMessage error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("refreshTestScalingMessage should succeed if has 1", (done: Mocha.Done) => {
        mockReceiveMessageAttributes(messageAttributes);
        refreshTestScalingMessage().then((result: string | undefined) => {
          log(`refreshTestScalingMessage result = ${result}`, LogLevel.DEBUG);
          expect(result, "result").to.not.equal(undefined);
          done();
        }).catch((error) => {
          log("refreshTestScalingMessage error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("deleteTestScalingMessage should succeed if empty", (done: Mocha.Done) => {
        mockReceiveMessages();
        deleteTestScalingMessage().then((dmessageId: string | undefined) => {
          expect(dmessageId, "dmessageId").to.equal(undefined);
          done();
        }).catch((error) => {
          log("deleteTestScalingMessage error", LogLevel.ERROR, error);
          done(error);
        });
      });

      it("deleteTestScalingMessage should succeed if has 1", (done: Mocha.Done) => {
        mockReceiveMessageAttributes(messageAttributes);
        deleteTestScalingMessage().then((dmessageId: string | undefined) => {
          expect(dmessageId, "dmessageId").to.not.equal(undefined);
          done();
        }).catch((error) => {
          log("deleteTestScalingMessage error", LogLevel.ERROR, error);
          done(error);
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
      mockGetQueueAttributes();
      getQueueAttributes(params).then((result: GetQueueAttributesCommandOutput) => {
        log("getQueueAttributes() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.Attributes).to.not.equal(undefined);
        expect(result.Attributes!.QueueArn).to.not.equal(undefined);
        expect(result.Attributes!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result.Attributes!.ApproximateNumberOfMessages!, 10))).to.equal(false);
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
      mockGetQueueAttributes();
      getQueueAttributes(params).then((result: GetQueueAttributesCommandOutput) => {
        log("getQueueAttributes() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.Attributes).to.not.equal(undefined);
        expect(result.Attributes!.QueueArn).to.not.equal(undefined);
        expect(result.Attributes!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result.Attributes!.ApproximateNumberOfMessages!, 10))).to.equal(false);
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
      mockGetQueueAttributes();
      getQueueAttributes(params).then((result: GetQueueAttributesCommandOutput) => {
        log("getQueueAttributes() result", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(result.Attributes).to.not.equal(undefined);
        expect(result.Attributes!.QueueArn).to.not.equal(undefined);
        expect(result.Attributes!.ApproximateNumberOfMessages).to.not.equal(undefined);
        expect(isNaN(parseInt(result.Attributes!.ApproximateNumberOfMessages!, 10))).to.equal(false);
        done();
      }).catch((error) => {
        log("getQueueAttributes() error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should getQueueAttributesMap with test params", (done: Mocha.Done) => {
      mockGetQueueAttributes();
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
      mockGetQueueAttributes();
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
      mockGetQueueAttributes();
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
