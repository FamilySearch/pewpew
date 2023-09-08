import { AGENT_ENV, SYSTEM_NAME, getPrefix } from "./util";
import {
  ChangeMessageVisibilityCommand,
  ChangeMessageVisibilityCommandInput,
  ChangeMessageVisibilityCommandOutput,
  DeleteMessageCommand,
  DeleteMessageCommandInput,
  DeleteMessageCommandOutput,
  GetQueueAttributesCommand,
  GetQueueAttributesCommandInput,
  GetQueueAttributesCommandOutput,
  MessageAttributeValue,
  ReceiveMessageCommand,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
  SQSClient,
  Message as SQSMessage,
  SendMessageCommand,
  SendMessageCommandInput,
  SendMessageCommandOutput
} from "@aws-sdk/client-sqs";
import { LogLevel, log } from "./log";
import { SqsQueueType } from "../../types";

export const QUEUE_URL_TEST: Map<string, string> = new Map<string, string>();
export const QUEUE_URL_SCALE_IN: Map<string, string> = new Map<string, string>();
export let QUEUE_URL_COMMUNICATION: string;
// Export for testing so we can reset sqs
export const config: { sqsClient: SQSClient } = {
  sqsClient: undefined as unknown as SQSClient
};

// Put this in an init that runs later so we don't throw on start-up.
export function init () {
  // Where <prefix> is your application name, system name, and service name concatenated with underscores, capitalized, and all dashes replaced with underscores.
  // The prefix for the injected keys would be the same as above since it is based upon the owning application's application and service names.
  // TL;DR - Scale is owned by the pewpewagent(s) and we inject the environment variable AGENT_ENV to the controller as a string delimited array

  if (QUEUE_URL_TEST.size === 0) {
    // Scale is owned by the pewpewagent and we inject the environment variable AGENT_ENV to the controller
    // Except for the build environment. Don't set the AGENT_ENV there to get it to fall back to the APPLICATION_NAME code
    if (AGENT_ENV) {
      // Controller should have this env variable from the deployment
      const systemNames: string[] = AGENT_ENV.split(",");
      for (const systemName of systemNames) {
        const PREFIX: string = "PEWPEWAGENT_" + systemName.toUpperCase().replace("-", "_");
        const queueUrlTest: string | undefined = process.env[`${PREFIX}_SQS_SCALE_OUT_QUEUE_URL`];
        log(`${PREFIX}_SQS_SCALE_OUT_QUEUE_URL = ${queueUrlTest}`, LogLevel.DEBUG);
        if (!queueUrlTest) {
          log(`Could not load the environment variable ${PREFIX}_SQS_SCALE_OUT_QUEUE_URL`, LogLevel.ERROR);
          throw new Error(`Could not load the environment variable ${PREFIX}_SQS_SCALE_OUT_QUEUE_URL`);
        }
        QUEUE_URL_TEST.set(systemName, queueUrlTest);
      }
    } else {
      // We're an Agent, it's ours!
      const PREFIX: string = getPrefix();
      const queueUrlTest: string | undefined = process.env[`${PREFIX}_SQS_SCALE_OUT_QUEUE_URL`];
      log(`${PREFIX}_SQS_SCALE_OUT_QUEUE_URL = ${queueUrlTest}`, LogLevel.DEBUG);
      if (!queueUrlTest) {
        log(`Could not load the environment variable ${PREFIX}_SQS_SCALE_OUT_QUEUE_URL`, LogLevel.ERROR);
        throw new Error(`Could not load the environment variable ${PREFIX}_SQS_SCALE_OUT_QUEUE_URL`);
      }
      QUEUE_URL_TEST.set(SYSTEM_NAME, queueUrlTest);
    }
  }

  if (QUEUE_URL_SCALE_IN.size === 0) {
    // Scale is owned by the pewpewagent and we inject the environment variable AGENT_ENV to the controller
    // Except for the build environment. Don't set the AGENT_ENV there to get it to fall back to the APPLICATION_NAME code
    if (AGENT_ENV) {
      // Controller should have this env variable from the deployment
      const systemNames: string[] = AGENT_ENV.split(",");
      for (const systemName of systemNames) {
        const PREFIX: string = "PEWPEWAGENT_" + systemName.toUpperCase().replace("-", "_");
        const queueUrlTest: string | undefined = process.env[`${PREFIX}_SQS_SCALE_IN_QUEUE_URL`];
        log(`${PREFIX}_SQS_SCALE_IN_QUEUE_URL = ${queueUrlTest}`, LogLevel.DEBUG);
        if (!queueUrlTest) {
          log(`Could not load the environment variable ${PREFIX}_SQS_SCALE_IN_QUEUE_URL`, LogLevel.ERROR);
          throw new Error(`Could not load the environment variable ${PREFIX}_SQS_SCALE_IN_QUEUE_URL`);
        }
        QUEUE_URL_SCALE_IN.set(systemName, queueUrlTest);
      }
    } else {
      // We're an Agent, it's ours!
      const PREFIX: string = getPrefix();
      const queueUrlTest: string | undefined = process.env[`${PREFIX}_SQS_SCALE_IN_QUEUE_URL`];
      log(`${PREFIX}_SQS_SCALE_IN_QUEUE_URL = ${queueUrlTest}`, LogLevel.DEBUG);
      if (!queueUrlTest) {
        log(`Could not load the environment variable ${PREFIX}_SQS_SCALE_IN_QUEUE_URL`, LogLevel.ERROR);
        throw new Error(`Could not load the environment variable ${PREFIX}_SQS_SCALE_IN_QUEUE_URL`);
      }
      QUEUE_URL_SCALE_IN.set(SYSTEM_NAME, queueUrlTest);
    }
  }

  if (!QUEUE_URL_COMMUNICATION) {
    // Communication is owned by the pewpewcontroller and we inject the environment variable CONTROLLER_ENV to the agents and the controller
    // Except for the build environment. Don't set the CONTROLLER_ENV there to get it to fall back to the APPLICATION_NAME code
    const PREFIX_COMM: string = getPrefix(true); // Use the controller if we have one
    const queueUrlCommunication: string | undefined = process.env[`${PREFIX_COMM}_SQS_COMMUNICATION_QUEUE_URL`];
    log(`${PREFIX_COMM}_SQS_COMMUNICATION_QUEUE_URL = ${queueUrlCommunication}`, LogLevel.DEBUG);
    if (!queueUrlCommunication) {
      log(`Could not load the environment variable ${PREFIX_COMM}_SQS_COMMUNICATION_QUEUE_URL`, LogLevel.ERROR);
      throw new Error(`Could not load the environment variable ${PREFIX_COMM}_SQS_COMMUNICATION_QUEUE_URL`);
    }
    QUEUE_URL_COMMUNICATION = queueUrlCommunication;
  }

  // Create an SQS service object
  if (config.sqsClient as unknown === undefined) {
    config.sqsClient = new SQSClient({
      region: "us-east-1"
    });
  }
}

let accessCallback: (date: Date) => void | undefined;

export function setAccessCallback (fn: (date: Date) => void) {
  accessCallback = fn;
}

function callAccessCallback (date: Date) {
  try {
    if (accessCallback) {
      accessCallback(date);
    } else {
      log("sqs setAccessCallback has not be set. Cannot call the accessCallback", LogLevel.WARN);
    }
  } catch(error) {
    log("Calling the Access Callback (set last s3 accessed failed", LogLevel.ERROR, error);
  }
}

/**
 * Retrieves the QueueUrl for the specified queue. Shared function for the other SQS functions.
 * Exported for testing.
 * @param sqsQueueType {SqsQueueType} to get the url for
 * @param sqsQueueName {string} name of the queue if there is more than one (controller)
 */
export function getQueueUrl (sqsQueueType: SqsQueueType, sqsQueueName?: string): string {
  init();
  let queueUrl: string | undefined;
  log(`getQueueUrl(${sqsQueueType}, ${JSON.stringify(sqsQueueName)})`, LogLevel.DEBUG);
  if (sqsQueueType === SqsQueueType.Communications) {
    queueUrl = QUEUE_URL_COMMUNICATION;
  } else if (sqsQueueType === SqsQueueType.Test && sqsQueueName) {
    queueUrl = QUEUE_URL_TEST.get(sqsQueueName);
    if (!queueUrl) {
      throw new Error(`No such Queue found = ${sqsQueueName}`);
    }
  } else if (sqsQueueType === SqsQueueType.Scale && sqsQueueName) {
    queueUrl = QUEUE_URL_SCALE_IN.get(sqsQueueName);
    if (!queueUrl) {
      throw new Error(`No such Queue found = ${sqsQueueName}`);
    }
  } else {
    if (QUEUE_URL_TEST.size !== 1 || QUEUE_URL_SCALE_IN.size !== 1) {
      log(`Only Agents with a single QUEUE_URL_TEST can getQueueUrl() without providing a queue name: QUEUE_URL_TEST.size=${QUEUE_URL_TEST.size}`, LogLevel.ERROR, QUEUE_URL_TEST);
      throw new Error(`Only Agents with a single QUEUE_URL_TEST can getQueueUrl() without providing a queue name: QUEUE_URL_TEST.size=${QUEUE_URL_TEST.size}`);
    }
    queueUrl = (sqsQueueType === SqsQueueType.Scale ? QUEUE_URL_SCALE_IN : QUEUE_URL_TEST).values().next().value;
  }
  if (queueUrl === undefined) {
    throw new Error(`Could not load queueUrl. Unknown Error for SqsQueueType ${SqsQueueType}, sqsQueueName ${sqsQueueName}`);
  }
  log(`getQueueUrl(${sqsQueueType}, ${JSON.stringify(sqsQueueName)}) = ${queueUrl}`, LogLevel.DEBUG);
  return queueUrl;
}

/**
 * Agent: Retrieves a new test to run or returns undefined
 * @returns SQSMessage or undefined
 */
export async function getNewTestToRun (): Promise<SQSMessage | undefined> {
  init();
  // If you try to call this from a controller (that has multiple queues) we should throw.
  if (QUEUE_URL_TEST.size !== 1) {
    log(`Only Agents with a single QUEUE_URL_TEST can getNewTestsToRun(): QUEUE_URL_TEST.size=${QUEUE_URL_TEST.size}`, LogLevel.ERROR, QUEUE_URL_TEST);
    throw new Error(`Only Agents with a single QUEUE_URL_TEST can getNewTestsToRun(): QUEUE_URL_TEST.size=${QUEUE_URL_TEST.size}`);
  }
  const queueUrlTest = QUEUE_URL_TEST.values().next().value;
  const params: ReceiveMessageCommandInput = {
    AttributeNames: [
      "All"
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
        "All"
    ],
    QueueUrl: queueUrlTest,
    VisibilityTimeout: 60,
    WaitTimeSeconds: 20
  };
  const result: ReceiveMessageCommandOutput = await receiveMessage(params);
  return (result && Array.isArray(result.Messages) && result.Messages.length > 0) ? result.Messages[0] : undefined;
}

/**
 * Controller: Retrieves a communcations message or returns undefined
 * @returns SQSMessage or undefined
 */
export async function getCommunicationMessage (): Promise<SQSMessage | undefined> {
  init();
  const params: ReceiveMessageCommandInput = {
    AttributeNames: [
      "All"
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
        "All"
    ],
    QueueUrl: QUEUE_URL_COMMUNICATION,
    VisibilityTimeout: 20,
    WaitTimeSeconds: 20
  };
  const result: ReceiveMessageCommandOutput = await receiveMessage(params);
  return (result && Array.isArray(result.Messages) && result.Messages.length > 0) ? result.Messages[0] : undefined;
}

/**
 * Controller: Sends a new test to the Test Queue (to scale up and start a new test)
 * @param messageAttributes {Record<string, MessageAttributeValue>} message body with test properties
 * @param sqsQueueName {string} name of the sqs queue
 * @returns messageId {string}
 */
export async function sendNewTestToRun (messageAttributes: Record<string, MessageAttributeValue>, sqsQueueName: string): Promise<string | undefined> {
  init();
  const messageKeys = Object.keys(messageAttributes);
  if (messageKeys.length === 0) {
    throw new Error("You must specify at least one Message Attribute");
  }
  if (!sqsQueueName || !QUEUE_URL_TEST.has(sqsQueueName)) {
    throw new Error("You must specify a valid sqsQueueName: " + sqsQueueName);
  }
  const queueUrlTest: string = QUEUE_URL_TEST.get(sqsQueueName)!;
  try {
    const yamlFile: string | undefined = messageKeys.includes("YamlFile") ? messageAttributes["YamlFile"].StringValue : undefined;
    const sqsMessageRequest: SendMessageCommandInput = {
      MessageAttributes: messageAttributes,
      MessageBody: yamlFile ? `Launching the ${yamlFile} test on the ${sqsQueueName} Test Queue` : `Sending Message to the ${sqsQueueName} Test Queue`,
      QueueUrl: queueUrlTest
    };
    log("sendNewTestToRun request", LogLevel.DEBUG, Object.assign({}, sqsMessageRequest, { MessageAttributes: undefined }));
    const result: SendMessageCommandOutput = await sendMessage(sqsMessageRequest);
    log(`sendNewTestToRun result.MessageId: ${result.MessageId}`, LogLevel.DEBUG);
    return result.MessageId;
  } catch(error) {
    log("Could not send new Test to Run Message", LogLevel.ERROR, error);
    throw error;
  }
}

/**
 * Agent: Sends a message to the communications queue for the controller
 * @param messageAttributes {Record<string, MessageAttributeValue>} message body with test status properties
 * @returns messageId {string}
 */
export async function sendNewCommunicationsMessage (messageAttributes: Record<string, MessageAttributeValue>): Promise<string | undefined> {
  init();
  const messageKeys = Object.keys(messageAttributes);
  if (messageKeys.length === 0) {
    throw new Error("You must specify at least one Message Attribute");
  }
  try {
    const message: string | undefined = messageKeys.includes("Message") ? messageAttributes["Message"].StringValue : undefined;
    const sqsMessageRequest: SendMessageCommandInput = {
      MessageAttributes: messageAttributes,
      MessageBody: message || "Sending Message to the Communications Queue",
      QueueUrl: QUEUE_URL_COMMUNICATION
    };
    log("sendNewCommunicationsMessage request", LogLevel.DEBUG, Object.assign({}, sqsMessageRequest, { MessageAttributes: undefined }));
    const result: SendMessageCommandOutput = await sendMessage(sqsMessageRequest);
    log(`sendNewCommunicationsMessage result.MessageId: ${result.MessageId}`, LogLevel.DEBUG);
    return result.MessageId;
  } catch(error) {
    log("Could not send communications Message", LogLevel.ERROR, error);
    throw error;
  }
}

export interface MessageByHandleOptions {
  /** message Handle from a get message call */
  messageHandle: string;
  /** which queue the message is on */
  sqsQueueType: SqsQueueType;
  /** name of the queue. optional for the agent, required for the controller (non-communication) */
  sqsQueueName?: string;
}

/**
 * Controller or Agent: Deletes a message from the SQS queue
 * @param messageHandle {string} message Handle from a get message call
 * @param sqsQueueType {SqsQueueType} which queue the message is on
 * @param sqsQueueName {string} name of the queue. optional for the agent, required for the controller (non-communication)
 */
export function deleteMessageByHandle ({ messageHandle, sqsQueueType, sqsQueueName }: MessageByHandleOptions): Promise<void> {
  if (sqsQueueType === undefined) {
    throw new Error("sqsQueueType must be provided");
  }
  init();
  const queueUrl: string = getQueueUrl(sqsQueueType, sqsQueueName);
  const params: DeleteMessageCommandInput = {
    QueueUrl: queueUrl,
    ReceiptHandle: messageHandle
  };
  return deleteMessage(params);
}

/**
 * Controller or Agent: Extends the visibility lockout of a message from the SQS queue
 * @param messageHandle {string} message Handle from a get message call
 * @param sqsQueueType {SqsQueueType} which queue the message is on
 * @param sqsQueueName {string} name of the queue. optional for the agent, required for the controller (non-communication)
 */
 export function changeMessageVisibilityByHandle ({ messageHandle, sqsQueueType, sqsQueueName }: MessageByHandleOptions): Promise<void> {
  if (sqsQueueType === undefined) {
    throw new Error("sqsQueueType must be provided");
  }
  init();
  const queueUrl: string = getQueueUrl(sqsQueueType, sqsQueueName);
  const params: ChangeMessageVisibilityCommandInput = {
    QueueUrl: queueUrl,
    VisibilityTimeout: 60,
    ReceiptHandle: messageHandle
  };
  return changeMessageVisibility(params);
}

/**
 * Controller: Gets the size and status of the queue
 * @param sqsQueueType {SqsQueueType} which queue the message is on
 * @param sqsQueueName {string} name of the queue. required for the non-communication queues
 */
export async function getQueueAttributesMap (sqsQueueType: SqsQueueType, sqsQueueName?: string): Promise<Record<string, string> | undefined> {
  init();
  const queueUrl: string = getQueueUrl(sqsQueueType, sqsQueueName);
  const params: GetQueueAttributesCommandInput = {
    QueueUrl: queueUrl,
    AttributeNames: ["All"]
  };
  const result: GetQueueAttributesCommandOutput = await getQueueAttributes(params);
  return result.Attributes;
}

/**
 * Agent: Gets a message off the scale in queue or returns undefined
 * @returns SQSMessage or undefined
 */
export async function getTestScalingMessage (): Promise<SQSMessage | undefined> {
  init();
  // If you try to call this from a controller (that has multiple queues) we should throw.
  if (QUEUE_URL_SCALE_IN.size !== 1) {
    log(`Only Agents with a single QUEUE_URL_SCALE_IN can getTestScalingMessage(): QUEUE_URL_SCALE_IN.size=${QUEUE_URL_SCALE_IN.size}`, LogLevel.ERROR, QUEUE_URL_SCALE_IN);
    throw new Error(`Only Agents with a single QUEUE_URL_SCALE_IN can getTestScalingMessage(): QUEUE_URL_SCALE_IN.size=${QUEUE_URL_SCALE_IN.size}`);
  }
  const queueUrlScale = QUEUE_URL_SCALE_IN.values().next().value;
  const params: ReceiveMessageCommandInput = {
    AttributeNames: [
      "All"
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
        "All"
    ],
    QueueUrl: queueUrlScale,
    VisibilityTimeout: 30,
    WaitTimeSeconds: 5
  };
  const result: ReceiveMessageCommandOutput = await receiveMessage(params);
  return (result && Array.isArray(result.Messages) && result.Messages.length > 0) ? result.Messages[0] : undefined;
}

/**
 * Controller or Agent: Sends a message to the Test Scaling Queue (to prevent scale ins)
 * @param sqsQueueName {string} name of the queue. must be provided by the controller, not needed by agents
 * @returns messageId {string}
 */
export async function sendTestScalingMessage (sqsQueueName?: string): Promise<string | undefined> {
  init();
  const messageAttributes: Record<string, MessageAttributeValue> = {
    Scale: {
      DataType: "String",
      StringValue: "test"
    }
  };
  let queueUrlScale: string = QUEUE_URL_SCALE_IN.values().next().value;
  if (QUEUE_URL_SCALE_IN.size !== 1) {
    if (!sqsQueueName || !QUEUE_URL_SCALE_IN.has(sqsQueueName)) {
      throw new Error("You must specify a valid sqsQueueName: " + sqsQueueName);
    }
    queueUrlScale = QUEUE_URL_SCALE_IN.get(sqsQueueName)!;
  } else {
    sqsQueueName = QUEUE_URL_SCALE_IN.keys().next().value;
  }
  try {
    const sqsMessageRequest: SendMessageCommandInput = {
      MessageAttributes: messageAttributes,
      MessageBody: `Sending Message to the ${sqsQueueName} Test Scaling Queue`,
      QueueUrl: queueUrlScale
    };
    log("sendTestScalingMessage request", LogLevel.DEBUG, sqsMessageRequest);
    const result: SendMessageCommandOutput = await sendMessage(sqsMessageRequest);
    log(`sendTestScalingMessage result.MessageId: ${result.MessageId}`, LogLevel.DEBUG);
    return result.MessageId;
  } catch(error) {
    log("Could not send new Test Scaling Message", LogLevel.ERROR, error);
    throw error;
  }
}

/**
 * Agent: Helper function to get/delete and send a new message to the scaling queue (keep alive)
 */
export async function refreshTestScalingMessage (): Promise<string | undefined> {
  init();
  try {
    const scalingMessage: SQSMessage | undefined = await getTestScalingMessage();
    log("refreshTestScalingMessage getTestScalingMessage scalingMessage", LogLevel.DEBUG, scalingMessage);
    // Send a new one regardless of whether we have an old one. We need to keep ourselves "alive"
    const messageId: string | undefined = await sendTestScalingMessage();
    log(`refreshTestScalingMessage sendTestScalingMessage messageId: ${messageId}`, LogLevel.DEBUG);
    // Delete the old one after we send the new one (in case the send fails)
    if (scalingMessage && scalingMessage.ReceiptHandle) {
      await deleteMessageByHandle({ messageHandle: scalingMessage.ReceiptHandle, sqsQueueType: SqsQueueType.Scale });
      log("refreshTestScalingMessage old scalingMessage deleted", LogLevel.DEBUG, scalingMessage);
    } else {
      log("refreshTestScalingMessage did not find an existing scaling message", LogLevel.WARN, scalingMessage);
    }
    return messageId;
  } catch(error) {
    log("Could not refresh Test Scaling Message", LogLevel.ERROR, error);
    throw error;
  }
}

/**
 * Agent: Helper function to delete a message from the scaling queue (test finished)
 */
export async function deleteTestScalingMessage (): Promise<string | undefined> {
  init();
  try {
    const scalingMessage: SQSMessage | undefined = await getTestScalingMessage();
    log("deleteTestScalingMessage getTestScalingMessage scalingMessage", LogLevel.DEBUG, scalingMessage);
    // Delete it but don't error if we can't find one
    if (scalingMessage && scalingMessage.ReceiptHandle) {
      await deleteMessageByHandle({ messageHandle: scalingMessage.ReceiptHandle, sqsQueueType: SqsQueueType.Scale });
      log("deleteTestScalingMessage old scalingMessage deleted", LogLevel.DEBUG, scalingMessage);
    } else {
      log("deleteTestScalingMessage did not find an existing scaling message", LogLevel.WARN, scalingMessage);
    }
    return scalingMessage && scalingMessage.MessageId;
  } catch(error) {
    log("Could not delete a Test Scaling Message", LogLevel.ERROR, error);
    throw error;
  }
}

// Export for testing
export async function receiveMessage (params: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> {
  init();
  try {
    log("receiveMessage request", LogLevel.DEBUG, params);
    const result: ReceiveMessageCommandOutput = await config.sqsClient.send(new ReceiveMessageCommand(params));
    log("receiveMessage succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("receiveMessage failed", LogLevel.ERROR, error);
    throw error;
  }
}

// Export for testing
export async function sendMessage (params: SendMessageCommandInput): Promise<SendMessageCommandOutput> {
  init();
  try {
    log("sendMessage request", LogLevel.DEBUG, params);
    const result: SendMessageCommandOutput = await config.sqsClient.send(new SendMessageCommand(params));
    log("sendMessage succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("sendMessage failed", LogLevel.ERROR, error);
    throw error;
  }
}

// Export for testing
export async function deleteMessage (params: DeleteMessageCommandInput): Promise<void> {
  init();
  try {
    log("deleteMessage request", LogLevel.DEBUG, params);
    const result: DeleteMessageCommandOutput = await config.sqsClient.send(new DeleteMessageCommand(params));
    log("deleteMessage succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return;
  } catch (error) {
    log("deleteMessage failed", LogLevel.ERROR, error);
    throw error;
  }
}

// Export for testing
export async function changeMessageVisibility (params: ChangeMessageVisibilityCommandInput): Promise<void> {
  init();
  try {
    log("changeMessageVisibility request", LogLevel.DEBUG, params);
    const result: ChangeMessageVisibilityCommandOutput = await config.sqsClient.send(new ChangeMessageVisibilityCommand(params));
    log("changeMessageVisibility succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return;
  } catch (error) {
    log("changeMessageVisibility failed", LogLevel.ERROR, error);
    throw error;
  }
}

export async function getQueueAttributes (params: GetQueueAttributesCommandInput): Promise<GetQueueAttributesCommandOutput> {
  init();
  try {
    log("getQueueAttributes request", LogLevel.DEBUG, params);
    const result: GetQueueAttributesCommandOutput = await config.sqsClient.send(new GetQueueAttributesCommand(params));
    log("getQueueAttributes succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("getQueueAttributes failed", LogLevel.ERROR, error);
    throw error;
  }
}

export async function cleanUpQueue (sqsQueueType: SqsQueueType, sqsQueueName?: string | undefined): Promise<number> {
  init();
  const QueueUrl: string = getQueueUrl(sqsQueueType, sqsQueueName);
  const receiveMessageParams: ReceiveMessageCommandInput = {
    AttributeNames: ["All"],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: ["All"],
    QueueUrl,
    VisibilityTimeout: 1,
    WaitTimeSeconds: 1
  };
  let count = 0;
  try {
    let messageReceived: SQSMessage | undefined;
    do {
      const result: ReceiveMessageCommandOutput = await receiveMessage(receiveMessageParams);
      log(QueueUrl + " receiveMessage: " + result, LogLevel.DEBUG, result);
      messageReceived = (result && Array.isArray(result.Messages) && result.Messages.length > 0) ? result.Messages[0] : undefined;
      log(QueueUrl + " getTestScalingMessage messageReceived: " + messageReceived, LogLevel.DEBUG, messageReceived);
      if (messageReceived && messageReceived.ReceiptHandle) {
        await deleteMessageByHandle({ messageHandle: messageReceived.ReceiptHandle, sqsQueueType, sqsQueueName }).then(() => {
          count++;
          log(QueueUrl + " deleteMessageByHandle deleted: " + messageReceived!.ReceiptHandle, LogLevel.DEBUG, { sqsQueueType, sqsQueueName, count });
        }).catch((error) => log(QueueUrl + " deleteMessageByHandle error: " + messageReceived!.ReceiptHandle, LogLevel.WARN, error, { sqsQueueType, sqsQueueName }));
      }
    } while (messageReceived !== undefined);
  } catch (error) {
    log(QueueUrl + ": Error cleaning up the scaling queue", LogLevel.ERROR, error);
  }
  return count;
}

export async function cleanUpQueues (): Promise<number> {
  const results: number[] = await Promise.all(
    Array.from(Object.values(SqsQueueType))
    .map((sqsScalingQueueType: SqsQueueType) => cleanUpQueue(sqsScalingQueueType))
  );
  const total = results.reduce((prev: number, current: number) => prev + current, 0);
  log("cleanUpQueues deleted: " + results, LogLevel.DEBUG, { results, total });
  return total;
}
