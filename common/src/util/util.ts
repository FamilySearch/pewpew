import * as os from "os";

export const APPLICATION_NAME: string = process.env.APPLICATION_NAME || "pewpewagent";
export const CONTROLLER_APPLICATION_NAME: string = process.env.CONTROLLER_APPLICATION_NAME || "pewpewcontroller";
export const AGENT_APPLICATION_NAME: string = process.env.AGENT_APPLICATION_NAME || "pewpewagent";
export const CONTROLLER_APPLICATION_PREFIX: string = CONTROLLER_APPLICATION_NAME.toUpperCase().replace(/-/g, "_") + "_";
export const SYSTEM_NAME: string = process.env.SYSTEM_NAME || "unittests";
export const CONTROLLER_ENV = process.env.CONTROLLER_ENV;
export const AGENT_ENV = process.env.AGENT_ENV;

export const PEWPEW_BINARY_FOLDER: string = "pewpew";
export const PEWPEW_VERSION_LATEST: string = "latest";
export const PEWPEW_BINARY_EXECUTABLE_LINUX = "pewpew";
export const PEWPEW_BINARY_EXECUTABLE_WINDOWS = "pewpew.exe";
export const PEWPEW_BINARY_EXECUTABLE_MAC = "pewpew.mac";
export const PEWPEW_BINARY_EXECUTABLE = process.env.PEWPEW_BINARY_EXECUTABLE
  || os.platform() === "win32"
  ? PEWPEW_BINARY_EXECUTABLE_WINDOWS
  : os.platform() === "darwin"
    ? PEWPEW_BINARY_EXECUTABLE_MAC
    : PEWPEW_BINARY_EXECUTABLE_LINUX;
export const PEWPEW_BINARY_EXECUTABLE_NAMES = [
  PEWPEW_BINARY_EXECUTABLE_LINUX,
  PEWPEW_BINARY_EXECUTABLE_WINDOWS,
  PEWPEW_BINARY_EXECUTABLE_MAC
];


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

export async function sleep (ms: number): Promise<void> {
  try {
    await new Promise((resolve) => setTimeout(resolve, ms));
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error("sleep Error", error); // swallow it
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
