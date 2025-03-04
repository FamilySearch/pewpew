import "dotenv-flow/config";
import { IS_RUNNING_IN_AWS, PewPewTest } from "./pewpewtest";
import { LogLevel, log, logger, util } from "@fs/ppaas-common";
import { config as serverConfig, start, stop } from "./server";
import { buildTest } from "./tests";
import { config as healthcheckConfig } from "./healthcheck";

const sleep = util.sleep;

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-agent";

start();
log("PewPewTest.serverStart: " + PewPewTest.serverStart, LogLevel.DEBUG, PewPewTest.serverStart);

const WARN_IF_NO_MESSAGE_DELAY = parseInt(process.env.WARN_IF_NO_MESSAGE_DELAY || "0", 10) || (15 * 60 * 1000);

// Start with "Now" so we don't initially fail out.
let lastMessageTime = new Date();
// Used to shutdown the background process polling for messages
let shutdown: boolean = false;

process.on("exit", (signal) => {
  log("Agent Service process exit", LogLevel.WARN, { signal });
  // eslint-disable-next-line no-console
  console.log("process exit");
  shutdown = true;
});
process.on("SIGUSR1", (signal) => {
  log("Agent Service Received SIGUSR1", LogLevel.ERROR, { signal });
  shutdown = true;
  stop();
});
process.on("SIGUSR2", (signal) => {
  log("Agent Service Received SIGUSR2", LogLevel.ERROR, { signal });
  shutdown = true;
  stop();
});
process.on("SIGINT", (signal) => {
  log("Agent Service Received SIGINT", LogLevel.WARN, { signal });
  shutdown = true;
  stop();
});
process.on("SIGTERM", (signal) => {
  log("Agent Service Received SIGTERM", LogLevel.WARN, { signal });
  shutdown = true;
  stop();
});
process.on("unhandledRejection", (e: unknown) => {
  log(`process unhandledRejection: ${e instanceof Error ? e.message : e}`, LogLevel.ERROR, e);
  if (e instanceof Error && e.stack) {
    // eslint-disable-next-line no-console
    console.error(e.stack);
  }
});
process.on("uncaughtException", (e: unknown) => {
  log(`process uncaughtException: ${e instanceof Error ? e.message : e}`, LogLevel.ERROR, e);
  log(`process uncaughtException: ${e instanceof Error ? e.message : e}`, LogLevel.FATAL, e);
  if (e instanceof Error && e.stack) {
    // eslint-disable-next-line no-console
    console.error(e.stack);
  }
  shutdown = true;
  healthcheckConfig.failHealthCheck = true;
  healthcheckConfig.failHealthCheckMessage = (e as Error)?.message || `${e}`;
  stop();
});

(async () => {
  // We'll never set this to true unless something really bad happens
  healthcheckConfig.failHealthCheck = false;

  // If we're in the build environment, do a basic test to run pewpew and fail the healthcheck if we can't
  // ppaas-agent doesn't have a load balancer so we can't run this as part of acceptance
  if (process.env.FS_SYSTEM_NAME === "build") {
    await buildTest();
  }

  while (!shutdown) {
    try {
      serverConfig.testToRun = await PewPewTest.retrieve();
    } catch (error) {
      log("Error trying to get new test", LogLevel.ERROR, error);
      await sleep(5000);
    }
    if (serverConfig.testToRun) {
      const logObject = {
        ...serverConfig.testToRun.sanitizedCopy(),
        testId: serverConfig.testToRun.getTestId(),
        yamlFile: serverConfig.testToRun.getYamlFile(),
        userId: serverConfig.testToRun.getUserId()
      };
      lastMessageTime = new Date();
      log(`New test received ${serverConfig.testToRun.getTestId()}`, LogLevel.INFO, { ...logObject, lastMessageTime });
      if (!IS_RUNNING_IN_AWS) {
        // eslint-disable-next-line no-console
        console.log(`${serverConfig.testToRun.getTestId()}: New test received at ${lastMessageTime} for ${serverConfig.testToRun.getYamlFile()}}`);
      }
      // Process message and start a test
      const startTest = Date.now();
      try {
        await serverConfig.testToRun.launch();
        log(`Test Complete ${serverConfig.testToRun.getTestId()}`, LogLevel.INFO, logObject);
        if (!IS_RUNNING_IN_AWS) {
          // eslint-disable-next-line no-console
          console.log(`${serverConfig.testToRun.getTestId()}: Test Complete after ${(Date.now() - startTest) / 1000}s`);
        }
      } catch (error) {
        log(`Error running test ${serverConfig.testToRun.getTestId()}`, LogLevel.ERROR, error, logObject);
        // Report to Controller
        await sleep(5000); // Final results still may be uploading
        serverConfig.testToRun = undefined;
      }
    } else {
      log(`No test received at ${lastMessageTime}`, LogLevel.DEBUG);
      if (Date.now() - lastMessageTime.getTime() > WARN_IF_NO_MESSAGE_DELAY) {
        log(`No new test to run since ${lastMessageTime}`, LogLevel.WARN);
      }
    }
  }
  log(`shutdown=${shutdown}. Shutting Down.`, LogLevel.INFO);
  healthcheckConfig.failHealthCheckMessage = `shutdown=${shutdown}. Shutting Down.`;
  healthcheckConfig.failHealthCheck = true;
})().catch((err) => {
  log("Error during Run", LogLevel.FATAL, err);
  healthcheckConfig.failHealthCheck = true;
  healthcheckConfig.failHealthCheckMessage = err?.message || `${err}`;
  stop();
});
