import { CommunicationsMessage, MessageType, SqsQueueType } from "../types";
import { LogLevel, log } from "./util/log";
import { MessageAttributeValue, Message as SQSMessage } from "@aws-sdk/client-sqs";
import { deleteMessageByHandle, getCommunicationMessage, sendNewCommunicationsMessage } from "./util/sqs";

/** Messages from the agent to the controller */
export class PpaasCommunicationsMessage implements CommunicationsMessage {
  public testId: string;
  public messageType: MessageType;
  public messageData: any;
  public receiptHandle: string | undefined;
  // Protected member so only unit tests that extend this class can set it.
  protected unittestMessage: boolean | undefined;

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor ({ testId,
      messageType,
      messageData
    }: Partial<CommunicationsMessage>) {
    if (!testId || !messageType) {
      // Don't log the messageData
      log("PpaasCommunicationsMessage was missing data", LogLevel.ERROR, { testId, messageType });
      throw new Error("PpaasCommunicationsMessage was missing testId, sender, recipient, or message");
    }
    this.testId = testId;
    this.messageType = messageType;
    this.messageData = messageData;
  }

  public getCommunicationsMessage (): CommunicationsMessage {
    return {
      testId: this.testId,
      messageType: this.messageType,
      messageData: this.messageData
    };
  }

  // Create a sanitized copy which doesn't have the messageData which may have passwords
  public sanitizedCopy (): CommunicationsMessage & { receiptHandle: string | undefined } {
    const returnObject: CommunicationsMessage & { receiptHandle: string | undefined } = {
      ...this.getCommunicationsMessage(),
      messageData: undefined,
      receiptHandle: this.receiptHandle
    };
    return JSON.parse(JSON.stringify(returnObject));
  }

  // Override toString so we can not log the environment variables which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  protected static async parseSqsMessage (sqsMessage: SQSMessage): Promise<PpaasCommunicationsMessage | undefined> {
    if (!sqsMessage.MessageAttributes) {
      log("SQSMessage.MessageAttributes cannot be null.", LogLevel.ERROR, sqsMessage);
      throw new Error("SQSMessage.MessageAttributes cannot be null.");
    }
    const messageAttributes: Record<string, MessageAttributeValue> = sqsMessage.MessageAttributes;
    let testId: string | undefined;
    let messageType: MessageType | undefined;
    let messageData: any;
    const receiptHandle: string = sqsMessage.ReceiptHandle!;
    let unittestMessage : boolean = false;
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
          throw new Error(`New Communications Message Attribute could not be parsed: messageAttributes[${key}].BinaryValue = ${value.BinaryValue}`);
        }
        switch (key) {
          case "MessageData":
            // It can only be in there once either as Binary or String so we can overwrite and don't need to append
            messageData = temp;
            break;
          default:
            log(`New Communications Message Attribute was not a known Binary messageAttribute: messageAttributes[${key}].DataType = ${value.DataType}`, LogLevel.ERROR, { key, value });
            break;
        }
        continue;
      } else if (value.DataType === "String") { // "Number" also is stored as StringValue
        log(`messageAttributes[${key}].StringValue = ${value.StringValue}`, LogLevel.DEBUG);
        switch (key) {
          // If this is set, it isn't a real message and should be swallowed. It was from an integration test
          case "UnitTestMessage":
            unittestMessage = true;
            break;
          case "TestId":
            testId = value.StringValue;
            break;
          case "MessageType":
            try {
              messageType = MessageType[(value.StringValue || "") as keyof typeof MessageType];
            } catch (error: unknown) {
              log(`New Communications Message Attribute 'MessageType' not be parsed: messageAttributes[${key}].StringValue = ${value.StringValue}`, LogLevel.ERROR, error);
              throw new Error(`New Communications Message Attribute 'MessageType' not be parsed: messageAttributes[${key}].StringValue = ${value.StringValue}, error: ${error}`);
            }
            break;
          case "MessageData":
            // It can only be in there once either as Binary or String so we can overwrite and don't need to append
            messageData = value.StringValue;
            break;
          default:
            log(`New Communications Message Attribute was not a known String messageAttribute: messageAttributes[${key}].DataType = ${value.DataType}`, LogLevel.ERROR, { key, value });
            break;
        }
      } else {
        log(`messageAttributes[${key}].DataType = ${value.DataType}`, LogLevel.ERROR);
        throw new Error(`New Communications Message Attribute was not type String or Binary: messageAttributes[${key}].DataType = ${value.DataType}`);
      }
    }
    // Is it an integration message we shouldn't swallow
    if (unittestMessage) {
      const unitTestMessage: PpaasCommunicationsMessage = new PpaasCommunicationsMessage({ testId, messageType, messageData });
      // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
      unitTestMessage.receiptHandle = receiptHandle;
      log(`New Integration communications message received at ${Date.now()}: ${testId}`, LogLevel.INFO, unitTestMessage.sanitizedCopy());
      log(`Removing Integration Test Communications Message from queue ${receiptHandle}`, LogLevel.INFO);
      // Only delete it if it's a test message
      await deleteMessageByHandle({ messageHandle: receiptHandle, sqsQueueType: SqsQueueType.Communications })
      .catch((error) => log(`Could not remove Integration Test message from from queue: ${receiptHandle}`, LogLevel.ERROR, error));
      return undefined;
    }
    const newMessage: PpaasCommunicationsMessage = new PpaasCommunicationsMessage({ testId, messageType, messageData });
    // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
    newMessage.receiptHandle = receiptHandle;
    return newMessage;
  }

  // Only used by the controller
  public static async getMessage (): Promise<PpaasCommunicationsMessage | undefined> {
    const message: SQSMessage | undefined = await getCommunicationMessage();
    if (message) {
      log("We found a message for the controller", LogLevel.DEBUG, message);
      const newMessage: PpaasCommunicationsMessage | undefined = await this.parseSqsMessage(message);
      // If it was a unit test message, we'll get undefined and should keep going. Otherwise return it
      if (newMessage) { return newMessage; }
    }
    return undefined;
  }

  public async send (): Promise<string | undefined> {
    // Send the SQS Message
    const messageAttributes: Record<string, MessageAttributeValue> = {
      TestId: {
        DataType: "String",
        StringValue: this.testId
      },
      MessageType: {
        DataType: "String",
        StringValue: MessageType[this.messageType]
      }
    };
    if (this.messageData) {
      if (typeof this.messageData === "string") {
        messageAttributes["MessageData"] = {
          DataType: "String",
          StringValue: this.messageData
        };
      } else if (this.messageData instanceof Map || this.messageData instanceof Set) {
        messageAttributes["MessageData"] = {
          DataType: "Binary",
          BinaryValue: Buffer.from(JSON.stringify([...this.messageData])) // Need to cast it to an array
        };
      } else {
        messageAttributes["MessageData"] = {
          DataType: "Binary",
          BinaryValue: Buffer.from(JSON.stringify(this.messageData))
        };
      }
    }
    // Protected member so only unit tests that extend this class can set it.
    if (this.unittestMessage) {
      messageAttributes["UnitTestMessage"] = {
        DataType: "String",
        StringValue: "true"
      };
    }
    log("PpaasCommunicationsMessage.send messageAttributes", LogLevel.DEBUG, Object.assign({}, messageAttributes, { MessageData: undefined }));
    const messageId: string | undefined = await sendNewCommunicationsMessage(messageAttributes);
    log(`PpaasCommunicationsMessage.send messageId: ${messageId}`, LogLevel.INFO, this.sanitizedCopy());
    return messageId;
  }

  public async deleteMessageFromQueue (): Promise<void> {
    if (this.receiptHandle) {
      await deleteMessageByHandle({ messageHandle: this.receiptHandle, sqsQueueType: SqsQueueType.Communications });
      this.receiptHandle = undefined;
    }
  }
}

export default PpaasCommunicationsMessage;
