import {
  LogLevel,
  MessageType,
  PpaasCommunicationsMessage,
  PpaasTestMessage,
  SqsQueueType,
  TestStatusMessage,
  log,
  sqs,
  util
} from "@fs/ppaas-common";
import { TestManager } from "./testmanager";
import { TestScheduler } from "./testscheduler";
import { getGlobalHealthcheckConfig } from "./healthcheck";

const { sleep } = util;
const { getQueueAttributesMap } = sqs;

// How long should we sleep before we try to get another message if we get none and it comes back too fast
const COMMUCATION_NO_MESSAGE_DELAY = parseInt(process.env.COMMUCATION_NO_MESSAGE_DELAY || "0", 10) || (5 * 1000);
const AGENT_QUEUE_POLL_INTERVAL_MN = parseInt(process.env.AGENT_QUEUE_POLL_INTERVAL_MN || "0", 10) || 1;
const AGENT_QUEUE_STUCK_MESSAGE_WARN_MS = parseInt(process.env.AGENT_QUEUE_STUCK_MESSAGE_WARN_MS || "0", 10) || (20 * 60 * 1000);

// https://stackoverflow.com/questions/70260701/how-to-share-data-between-api-route-and-getserversideprops
declare global {
  // https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
  // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#type-checking-for-globalthis
  // Note that global variables declared with let and const don’t show up on globalThis.
  // eslint-disable-next-line no-var
  var communicationsRunning: boolean | undefined;
  // eslint-disable-next-line no-var
  var testLoopRunning: boolean | undefined;
}

// Used to only start the loop if it's not running yet.
export function startCommuncationsLoop (): boolean {
  if (global.communicationsRunning) {
    return global.communicationsRunning;
  }
  global.communicationsRunning = true;
  log("Starting Communications Loop", LogLevel.DEBUG);
  (async () => {
    // We'll never set this to true unless something really bad happens
    getGlobalHealthcheckConfig().failHealthCheck = false;
    let messageToHandle: PpaasCommunicationsMessage | undefined;
    while (global.communicationsRunning) {
      // Normally the getAnyMessageForController should take 20 seconds if there is no message in the queue.
      try {
        messageToHandle = await PpaasCommunicationsMessage.getMessage();
      } catch (error) {
        log("Error trying to get new communications message", LogLevel.ERROR, error);
        await sleep(COMMUCATION_NO_MESSAGE_DELAY);
      }
      if (messageToHandle) {
        log(
          `Controller - New Communications message received at ${new Date()}: ${messageToHandle.messageType}`,
          messageToHandle.messageType !== MessageType.TestStatus ? LogLevel.INFO : LogLevel.DEBUG,
          messageToHandle.sanitizedCopy()
        );
        try {
          // Process message and handle it
          switch (messageToHandle.messageType) {
            case MessageType.TestStatus:
            case MessageType.TestError:
            case MessageType.TestFinished:
            case MessageType.TestFailed:
              // eslint-disable-next-line no-case-declarations
              const testStatus: TestStatusMessage = messageToHandle.messageData as TestStatusMessage;
              log(`startCommuncationsLoop messageType ${messageToHandle.messageType} for ${messageToHandle.testId}}`, LogLevel.DEBUG, { testStatus });
              TestManager.updateRunningTest(messageToHandle.testId, testStatus, messageToHandle.messageType)
              .catch(() => { /* no-op */ });
              break;
            default:
              log(`The controller cannot handle messages of type ${messageToHandle.messageType} at this time. Removing from queue`, LogLevel.WARN, messageToHandle.sanitizedCopy());
              break;
          }

          await messageToHandle.deleteMessageFromQueue();
        } catch (error) {
          log("Error handling message", LogLevel.ERROR, error);
          // Report to Controller
          messageToHandle = undefined;
        }
      } else {
        log(`No message received at ${new Date()}`, LogLevel.DEBUG);
        // We don't want to sleep like the agents. We'll either wait 20 seconds, or we'll have a message and want to check again
      }
    }
    // We'll only reach here if we got some kind of sigterm message or an unhandled exception. Shut down this loop so we can be restarted or replaced
    log("Shutting Down Communications Loop.", LogLevel.INFO);
    getGlobalHealthcheckConfig().failHealthCheck = true;
    getGlobalHealthcheckConfig().failHealthCheckMessage = "Shutting Down Communications Loop.";
  })().catch((err) => {
    log("Error during Communications Loop", LogLevel.FATAL, err);
    getGlobalHealthcheckConfig().failHealthCheck = true;
    getGlobalHealthcheckConfig().failHealthCheckMessage = err?.message ? err.message : `Communications Loop: ${err}`;
  });
  return global.communicationsRunning;
}

const testQueueNames: string[] = [];

function getAvailableQueueNames () {
  if (testQueueNames.length === 0) {
    try {
      testQueueNames.push(...PpaasTestMessage.getAvailableQueueNames());
    } catch (error) {
      log("Communications Error calling PpaasTestMessage.getAvailableQueueNames()", LogLevel.ERROR, error);
      // swallow
    }
  }
}

async function logQueueSize (sqsQueueType: SqsQueueType, queueName?: string): Promise<void> {
  const queueType: string = SqsQueueType[sqsQueueType];
  const queueNameFormatted: string = queueName ? (queueName + " ") : "";
  const result: Record<string, string> | undefined = await getQueueAttributesMap(sqsQueueType, queueName);
  log(`${queueNameFormatted}${queueType} SQS queue QueueAttributeMap`, LogLevel.DEBUG, { ...result, queueName, queueType });
  // If we have a result, and the ApproximateNumberOfMessages is greater than 0/truthy. undefined will be NaN

  if (queueName && sqsQueueType === SqsQueueType.Test && result && parseInt(result.ApproximateNumberOfMessages, 10)) {
    const lastNewTestDate: Date | undefined = TestManager.getLastNewTestDate(queueName);
    log(`${queueNameFormatted}${queueType} SQS queue lastNewTestDate`, LogLevel.DEBUG, { lastNewTestDate, queueName, queueType });
    // Check if we either don't have a lastNewTestDate or it's more than 10 minutes ago
    if (!lastNewTestDate || (lastNewTestDate.getTime() < (Date.now() - AGENT_QUEUE_STUCK_MESSAGE_WARN_MS))) {
      const minutesSinceTest: number | string = lastNewTestDate
        ? ((Date.now() - lastNewTestDate.getTime()) / 60000).toFixed(2)
        : "undefined";
      log(`${queueNameFormatted}${queueType} SQS queue has ${result.ApproximateNumberOfMessages} messages after ${minutesSinceTest} minutes`,
        LogLevel.WARN,
        {
          queueName,
          queueType,
          lastNewTestDate,
          ApproximateNumberOfMessages: result.ApproximateNumberOfMessages,
          QueueArn: result.QueueArn
        }
      );
    }
  }
}

function startTestQueueLoop (): boolean {
  if (global.testLoopRunning) {
    return global.testLoopRunning;
  }
  global.testLoopRunning = true;
  log("Starting Test Queue Monitor Loop", LogLevel.DEBUG);
  (async () => {
    // We'll never set this to true unless something really bad happens
    const agentPollIntervalMs = AGENT_QUEUE_POLL_INTERVAL_MN * 60 * 1000;
    // Round to a AGENT_QUEUE_POLL_INTERVAL_MN minute interval
    let nextLoopStart = Math.ceil(Date.now() / agentPollIntervalMs) * agentPollIntervalMs;
    while (global.testLoopRunning) {
      log("Test Queue Monitor Loop", LogLevel.DEBUG, { now: Date.now(), nextLoopStart });
      // Initialize the list of queuenames once we've started
      getAvailableQueueNames();
      try {
        // Load each queue status
        const promises: Promise<void>[] = [
          ...(testQueueNames.map((queueName: string) => logQueueSize(SqsQueueType.Test, queueName))),
          ...(testQueueNames.map((queueName: string) => logQueueSize(SqsQueueType.Scale, queueName))),
          logQueueSize(SqsQueueType.Communications)
        ];
        await Promise.all(promises);
      } catch (error) {
        log("Error trying to get Test SQS queue status", LogLevel.WARN, error);
      }
      if (Date.now() < nextLoopStart) {
        // Sleep until the next loop
        await sleep(nextLoopStart - Date.now());
      }
      // Keep on that rounded 10 minute interval even if a loop takes longer than 10
      nextLoopStart += agentPollIntervalMs;
    }
    // We'll only reach here if we got some kind of sigterm message or an unhandled exception. Shut down this loop so we can be restarted or replaced
    log("Shutting Down Test Queue Monitor Loop.", LogLevel.INFO);
    global.testLoopRunning = false;
  })().catch((err) => {
    log("Error during Test Queue Monitor Loop", LogLevel.FATAL, err);
    global.testLoopRunning = false;
  });
  return global.testLoopRunning;
}

export function start (): boolean {
  log("Communcations Start enter", LogLevel.DEBUG, { testCommuncations: global.communicationsRunning , testQueue: global.testLoopRunning, testScheduler: global.testSchedulerLoopRunning });
  const testCommuncations = startCommuncationsLoop();
  const testQueue = startTestQueueLoop();
  const testScheduler = TestScheduler.startTestSchedulerLoop();
  const result = testCommuncations && testQueue && testScheduler;
  log("Communcations Start", result ? LogLevel.DEBUG : LogLevel.ERROR, { testCommuncations, testQueue, testScheduler });
  return result;
}
