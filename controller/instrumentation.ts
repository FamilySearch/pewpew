import type { LogLevel } from "@fs/ppaas-common";

let logFunction: ((message: string, level?: LogLevel | undefined, ...datas: any[]) => void) | undefined;
let logger: typeof import("@fs/ppaas-common/dist/src/util/log") | undefined;
async function log (message: string, level?: LogLevel | undefined, ...datas: any[]) {
  try {
    if (logFunction === undefined && process.env.NEXT_RUNTIME === "nodejs") {
      try {
        ({ log: logFunction, logger } = await import("@fs/ppaas-common"));
        // logger.config.LogFileName = "ppaas-controller";
        logFunction("Instrumentation register log imported", logger?.LogLevel.DEBUG);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Could not import log from @fs/ppaas-common", error);
      }
    }
    try {
      if (logFunction) {
        logFunction(message, level, ...datas);
      } else {
        // eslint-disable-next-line no-console
        console.log(message, ...datas);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(message, ...datas);
      throw error;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Instrumentation log error", error, message);
  }
}

export async function register () {
  // Await the first log so that logFunction will be populated
  await log("Instrumentation register enter");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      // Load encryption key/openId secret before we start the loops
      const { waitForSecrets } = await import("./src/secrets");
      log("Instrumentation register Secrets imported", logger?.LogLevel.DEBUG);
      await waitForSecrets();
      log("Instrumentation register Secrets finished", logger?.LogLevel.INFO);
    } catch (error) {
      log("Instrumentation register Secrets failed", logger?.LogLevel.ERROR, error);
      throw error;
    }
    try {
      const { start: startCommuncations } = await import("./src/communications");
      log("Instrumentation register startCommuncations imported", logger?.LogLevel.DEBUG);
      const result = startCommuncations();
      if (!result) {
        throw new Error("Communications loops not started");
      }
      log("Instrumentation register startCommuncations finished: " + result, logger?.LogLevel.WARN);
    } catch (error) {
      log("Instrumentation register communications failed", logger?.LogLevel.ERROR, error);
      throw error;
    }
  }
  log("Instrumentation register exit");
}
