import * as _fs from "fs/promises";
import * as os from "os";
import { LogLevel, log } from "./log";

export const APPLICATION_NAME: string = process.env.APPLICATION_NAME || "pewpewagent";
export const CONTROLLER_APPLICATION_NAME: string = process.env.CONTROLLER_APPLICATION_NAME || "pewpewcontroller";
export const CONTROLLER_APPLICATION_PREFIX: string = CONTROLLER_APPLICATION_NAME.toUpperCase().replace(/-/g, "_") + "_";
export const SYSTEM_NAME: string = process.env.SYSTEM_NAME || "unittests";
export const CONTROLLER_ENV = process.env.CONTROLLER_ENV;
export const AGENT_ENV = process.env.AGENT_ENV;

/** This applications PREFIX. No overrides */
export const PREFIX_DEFAULT: string = `${APPLICATION_NAME}-${SYSTEM_NAME}`.toUpperCase().replace(/-/g, "_");
let PREFIX_CONTROLLER_ENV: string | undefined;
/**
 * Returns the Environment variable Prefix for S3 and SQS. if controllerEnv == true,
 * uses the process.env.CONTROLLER_ENV
 * @param controllerEnv (Optional). If provided uses this for the controller environment variable. process.env.CONTROLLER_ENV
 * @returns {string} Environment Variable Prefix
 */
export const getPrefix = (controllerEnv?: boolean | string): string => {
  if (controllerEnv) {
    if (typeof controllerEnv === "string") {
      return (CONTROLLER_APPLICATION_PREFIX + controllerEnv.toUpperCase().replace(/-/g, "_"));
    }
    if (!PREFIX_CONTROLLER_ENV) {
      PREFIX_CONTROLLER_ENV = CONTROLLER_ENV
        ? (CONTROLLER_APPLICATION_PREFIX + CONTROLLER_ENV.toUpperCase().replace(/-/g, "_"))
        : PREFIX_DEFAULT;
    }
    return PREFIX_CONTROLLER_ENV;
  }
  return PREFIX_DEFAULT;
};

/** @deprecated Use `fs/promises` */
export const fs = {
  /** @deprecated Use `fs/promises` */
  access: _fs.access,
  /** @deprecated Use `fs/promises` */
  chmod: _fs.chmod,
  /** @deprecated Use `fs/promises` */
  mkdir: _fs.mkdir,
  /** @deprecated Use `fs/promises` */
  readdir: _fs.readdir,
  /** @deprecated Use `fs/promises` */
  readFile: _fs.readFile,
  /** @deprecated Use `fs/promises` */
  rename: _fs.rename,
  /** @deprecated Use `fs/promises` */
  unlink: _fs.unlink,
  /** @deprecated Use `rimraf` or `fs/promises` */
  rmdir: _fs.rmdir,
  /** @deprecated Use `fs/promises` */
  stat: _fs.stat
};

export async function sleep (ms: number): Promise<void> {
  try {
    await new Promise((resolve) => setTimeout(resolve, ms));
  } catch (error) {
    log("sleep Error", LogLevel.ERROR, error); // swallow it
  }
}

// Waits waits for up to ms (milliseconds) polling every 100ms for fn() to return truthy
export async function poll <T> (fn: () => Promise<T>, ms: number, timeoutCb?: (errMsg: string) => string): Promise<T> {
  const startTime: number = Date.now();
  const endTime: number = startTime + ms;
  // Default the interval to 100ms
  const interval = 100;
  let counter: number = 0;
  while (Date.now() < endTime) {
    // If the loop would take us past the endTime, use endTime + 1
    const endLoop: number = Math.min(startTime + (interval * (++counter)), endTime + 1);
    const result: T = await fn();
    if (result) {
      return result; // Return as soon  we get a result;
    }
    if (Date.now() < endLoop) {
      await sleep(endLoop - Date.now());
    }
  }
  let errorMsg: string = `Promise timed out after ${ms}ms.`;
  if (timeoutCb) {
    errorMsg = timeoutCb(errorMsg);
  }
  throw new Error(errorMsg);
}

export function getLocalIpAddress (ipv: 4 | 6 = 4) {
  const ipVersion = "IPv" + ipv;
  const networkInterfaces = os.networkInterfaces();
  // We don't care about order and need to break out early
  for (const addresses of Object.values(networkInterfaces)) {
    for (const interfaceAddress of addresses || []) {
      if (!interfaceAddress.internal && interfaceAddress.address && interfaceAddress.family === ipVersion) {
        return interfaceAddress.address;
      }
    }
  }
  // eslint-disable-next-line no-console
  console.error(
    `Computer does not have an external networkInterface: ${ipVersion}\nnetworkInterfaces: ${JSON.stringify(networkInterfaces)}`
  );
  return os.hostname();
}

export function createStatsFileName (testId: string, iteration?: number): string {
  return `stats-${testId}${iteration ? `-${iteration}` : ""}.json`;
}
