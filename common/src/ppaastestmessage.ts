import { AgentQueueDescription, EnvironmentVariables, SqsQueueType, TestMessage } from "../types";
import { LogLevel, log } from "./util/log";
import { MessageAttributeValue, Message as SQSMessage } from "@aws-sdk/client-sqs";
import {
  QUEUE_URL_TEST,
  changeMessageVisibilityByHandle,
  deleteMessageByHandle,
  sendNewTestToRun,
  getNewTestToRun as sqsGetNewTestToRun,
  init as sqsInit
} from "./util/sqs";

const DEFAULT_BUCKET_SIZE: number = parseInt(process.env.DEFAULT_BUCKET_SIZE || "0", 10) || 60000;
// If we're in a AWS, the default should be empty, we need the real list. If we're running locally, default it to a single size
const AgentDescriptions: string[] = (process.env.AGENT_DESC || "unknown").split(",");
export class PpaasTestMessage implements TestMessage {
  public testId: string;
  public s3Folder: string;
  public yamlFile: string;
  public additionalFiles: string[] | undefined;
  public testRunTimeMn: number | undefined;
  public bucketSizeMs: number;
  public version: string;
  public envVariables: EnvironmentVariables;
  public userId: string | undefined;
  public restartOnFailure: boolean;
  public bypassParser: boolean | undefined;
  public receiptHandle: string | undefined;
  public messageId: string | undefined;
  // Protected member so only unit tests that extend this class can set it.
  protected unittestMessage: boolean | undefined;
  protected static readonly AgentQueueDescriptionMapping: AgentQueueDescription = {};

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor ({
    testId,
    s3Folder,
    yamlFile,
    additionalFiles,
    testRunTimeMn,
    bucketSizeMs,
    version,
    envVariables,
    userId,
    restartOnFailure,
    bypassParser
  }: TestMessage) {
    this.testId = testId;
    this.s3Folder = s3Folder;
    this.yamlFile = yamlFile;
    this.additionalFiles = additionalFiles;
    this.testRunTimeMn = testRunTimeMn;
    this.bucketSizeMs = bucketSizeMs || DEFAULT_BUCKET_SIZE;
    this.version = version;
    this.envVariables = envVariables;
    this.userId = userId;
    this.restartOnFailure = restartOnFailure;
    this.bypassParser = bypassParser;
    // Remove any invalid file characters from testId, or just allow letters, numbers, and dash/underscore
    this.testId = this.testId.replace(/[^\w\d-_]/g, "");
  }

  /** Gets the TestMessage data as an object */
  public getTestMessage (): TestMessage {
    return {
      testId: this.testId,
      s3Folder: this.s3Folder,
      yamlFile: this.yamlFile,
      additionalFiles: this.additionalFiles,
      testRunTimeMn: this.testRunTimeMn,
      bucketSizeMs: this.bucketSizeMs,
      version: this.version,
      envVariables: this.envVariables,
      userId: this.userId,
      restartOnFailure: this.restartOnFailure,
      bypassParser: this.bypassParser
    };
  }

  /** Create a sanitized copy which doesn't have the environment variable values which may have passwords */
  public sanitizedCopy (): Omit<TestMessage, "envVariables"> & { envVariables: string[] } {
    const returnObject: Omit<TestMessage, "envVariables"> & { envVariables: string[] } = {
      ...this.getTestMessage(),
      envVariables: Object.keys(this.envVariables)
    };
    return JSON.parse(JSON.stringify(returnObject));
  }

  // Override toString so we can not log the environment variables which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  public static getAvailableQueueNames (): string[] {
    sqsInit();
    return Array.from(QUEUE_URL_TEST.keys());
  }

  public static getAvailableQueueMap (): AgentQueueDescription {
    if (Object.keys(PpaasTestMessage.AgentQueueDescriptionMapping).length > 0) { return PpaasTestMessage.AgentQueueDescriptionMapping; }
    const queueNames = PpaasTestMessage.getAvailableQueueNames();
    log("Creating the AgentQueueDescriptionMap", LogLevel.DEBUG, { queueNames, AgentDescriptions });
    if (queueNames.length === AgentDescriptions.length) {
      for (let i = 0; i < queueNames.length; i++) {
        if (queueNames[i] && AgentDescriptions[i]) {
          PpaasTestMessage.AgentQueueDescriptionMapping[queueNames[i]] = AgentDescriptions[i];
        }
      }
      log("AgentQueueDescriptionMap", LogLevel.DEBUG, PpaasTestMessage.AgentQueueDescriptionMapping);
    } else {
      log("Cannot create the AgentQueueDescriptionMap, queueNames and AgentDescriptions don't match in length", LogLevel.ERROR, { queueNames, AgentDescriptions });
      throw new Error("Cannot create the AgentQueueDescriptionMap, queueNames and AgentDescriptions don't match in length");
    }
    return PpaasTestMessage.AgentQueueDescriptionMapping;
  }

  public static async getNewTestToRun (): Promise<PpaasTestMessage | undefined> {
    const sqsMessage: SQSMessage | undefined = await sqsGetNewTestToRun();
    if (!sqsMessage || !sqsMessage.MessageAttributes) {
      return undefined;
    }
    const messageAttributes: Record<string, MessageAttributeValue> = sqsMessage.MessageAttributes;
    let testId: string | undefined;
    const receiptHandle: string = sqsMessage.ReceiptHandle!;
    let unittestMessage: boolean = false;
    let parsedTestMessage: TestMessage | undefined;
    // Go through all the message attributes and parse them
    for (const [key, value] of Object.entries(messageAttributes)) {
      if (value.DataType === "Binary") {
        let temp: any;
        try {
          // It's a JSON object stored as a buffer
          temp = JSON.parse(Buffer.from(value.BinaryValue!).toString());
          log(`messageAttributes[${key}].BinaryValue = ${value.BinaryValue}`, LogLevel.DEBUG, temp);
        } catch (error: unknown) {
          log(`messageAttributes[${key}].BinaryValue = ${value.BinaryValue}`, LogLevel.ERROR, error);
          throw new Error(`New Test Message Attribute could not be parsed: messageAttributes[${key}].BinaryValue = ${value.BinaryValue}`);
        }
        switch (key) {
          case "TestMessage":
            try {
              parsedTestMessage = temp as TestMessage;
            } catch (error: unknown) {
              throw new Error(`messageAttributes[${key}] was not an TestMessage = ${JSON.stringify(temp)}`);
            }
            break;
          default:
            log(`New Test Message Attribute was not a known Binary messageAttribute: messageAttributes[${key}].DataType = ${value.DataType}`, LogLevel.WARN, { key, value });
            break;
        }
        continue;
      } else if (value.DataType === "String") {
        log(`messageAttributes[${key}].StringValue = ${value.StringValue}`, LogLevel.DEBUG);
        switch (key) {
          // If this is set, it isn't a real message and should be swallowed. It was from an integration test
          case "UnitTestMessage":
            unittestMessage = true;
            break;
          case "TestId":
            // TODO: Should we vaildate this is just a file path and not an exploit since it's passed on the command line?
            testId = value.StringValue;
            break;
          default: // Environment variable
            log(`New Test Message Attribute was not a known String messageAttribute: messageAttributes[${key}].DataType = ${value.DataType}`, LogLevel.WARN, { key, value });
            break;
        }
      } else {
        log(`messageAttributes[${key}].DataType = ${value.DataType}`, LogLevel.ERROR);
        throw new Error(`New Test Message Attribute was not type String or Binary: messageAttributes[${key}].DataType = ${value.DataType}`);
      }
    }
    if (!parsedTestMessage) {
      log("PpaasTestMessage was missing the TestMessage", LogLevel.ERROR, { testId });
      throw new Error("New Test Message was missing testId, s3Folder, yamlFile, or testRunTime");
    } else if (!parsedTestMessage.testId || typeof parsedTestMessage.testId !== "string"
      || !parsedTestMessage.s3Folder || typeof parsedTestMessage.s3Folder !== "string"
      || !parsedTestMessage.yamlFile || typeof parsedTestMessage.yamlFile !== "string"
      || !parsedTestMessage.version || typeof parsedTestMessage.version !== "string"
      || !parsedTestMessage.envVariables || typeof parsedTestMessage.envVariables !== "object"
    ) {
      // Don't log the environment variables
      log("PpaasTestMessage was missing data", LogLevel.ERROR, { ...parsedTestMessage, envVariables: Object.keys(parsedTestMessage.envVariables) });
      throw new Error("New Test Message was missing testId, s3Folder, yamlFile, or envVariables");
    }
    const newTest: PpaasTestMessage = new this(parsedTestMessage);
    // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
    newTest.receiptHandle = receiptHandle;
    // Is it an integration message we shouldn't run
    if (unittestMessage) {
      // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
      log(`New Integration TestMessage received at ${Date.now()}: ${testId}`, LogLevel.INFO, newTest.sanitizedCopy());
      log(`Removing Integration TestMessage from queue ${receiptHandle}`, LogLevel.INFO);
      // Only delete it if it's a test message
      await deleteMessageByHandle({ messageHandle: receiptHandle, sqsQueueType: SqsQueueType.Test })
      .catch((error) => log(`Could not remove Integration Test message from from queue: ${receiptHandle}`, LogLevel.ERROR, error));
      return undefined;
    }
    // The sanitizedCopy wipes out the envVariables (which may have passwords) from the logs
    log(`New TestMessage received at ${Date.now()}: ${testId}`, LogLevel.INFO, newTest.sanitizedCopy());
    return newTest;
  }

  public async send (queueName: string): Promise<void> {
    if (this.testRunTimeMn === undefined && !this.bypassParser) {
      // Don't log the environment variables
      log("TestMessage must either have a testRunTimeMn or have set bypassParser", LogLevel.ERROR, this.sanitizedCopy());
      throw new Error("TestMessage must either have a testRunTimeMn or have set bypassParser");
    }
    const testMessage: TestMessage = this.getTestMessage();
    // Send the SQS Message
    const messageAttributes: Record<string, MessageAttributeValue> = {
      TestId: {
        DataType: "String",
        StringValue: this.testId
      },
      TestMessage: {
        DataType: "Binary",
        BinaryValue: Buffer.from(JSON.stringify(testMessage))
      }
    };
    // Protected member so only unit tests that extend this class can set it.
    if (this.unittestMessage) {
      messageAttributes["UnitTestMessage"] = {
        DataType: "String",
        StringValue: "true"
      };
    }
    log("PpaasTestMessage.send messageAttributes", LogLevel.DEBUG, Object.assign({}, messageAttributes, { EnvironmentVariables: undefined }));
    this.messageId = await sendNewTestToRun(messageAttributes, queueName);
    log(`PpaasTestMessage.send messageId: ${this.messageId}`, LogLevel.INFO, this.sanitizedCopy());
  }

  public async extendMessageLockout (): Promise<void> {
    if (this.receiptHandle) {
      await changeMessageVisibilityByHandle({ messageHandle: this.receiptHandle, sqsQueueType: SqsQueueType.Test });
    }
  }

  public async deleteMessageFromQueue (): Promise<void> {
    if (this.receiptHandle) {
      await deleteMessageByHandle({ messageHandle: this.receiptHandle, sqsQueueType: SqsQueueType.Test });
      this.receiptHandle = undefined;
    }
  }
}

export default PpaasTestMessage;
