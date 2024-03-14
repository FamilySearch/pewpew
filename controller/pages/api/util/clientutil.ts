import { LogLevel, log } from "./log";
import { TestData, TestManagerError, TestManagerMessage } from "../../../types";
import { AxiosError } from "axios";
import { IncomingMessage } from "http";
import getConfig from "next/config";
import semver from "semver";

// We can't use process.env because it's set at build time for nextjs
// https://nextjs.org/docs/api-reference/next.config.js/runtime-configuration
// Export for testing.
export const publicRuntimeConfig: NodeJS.Dict<string> = getConfig() && getConfig().publicRuntimeConfig ? getConfig().publicRuntimeConfig : process.env;
export const CNAME_DOMAIN: string = publicRuntimeConfig.CNAME_DOMAIN || ".pewpewlocal.org";
export const ROUTING_DOMAIN: string = publicRuntimeConfig.ROUTING_DOMAIN || ".pewpew.org";
export const TEST_LOCALHOST: boolean = publicRuntimeConfig.TEST_LOCALHOST === "true";
export const LOCALHOST_DOMAIN: string = "localhost";

export function getBasePath (): string {
  return publicRuntimeConfig.BASE_PATH || "";
}

/**
 * Used for image, css, or js assets which might be an absolute url
 * https://stackoverflow.com/questions/60452054/nextjs-deploy-to-a-specific-url-path
 * @param href relative url where the resource/image is
 * @returns formatted url including any asset prefix
 */
export function formatAssetHref (href: string): string {
  return `${publicRuntimeConfig.ASSET_PREFIX || getBasePath()}${href}`;
}

/**
 * Wrapper for Page/API calls or links where we might be running under a base path (sub-path routing)
 * https://stackoverflow.com/questions/60452054/nextjs-deploy-to-a-specific-url-path
 * @param href relative url to the page or API
 * @returns formatted url including any base path prefix
 */
export function formatPageHref (href: string): string {
  const basePath: string = getBasePath();
  // for cname, check for a window object. Check if the window.location already has the basepath. If does we need to add it, if it doesn't, we don't
  // If we have a basePath, and are on the client (window) and the location doesn't have the basePath, then we're on the cname
  // Or if the href already includes the basePath, return it.
  if (!basePath || href.startsWith("http://") || href.startsWith("https://")
    || (typeof window !== "undefined" // For unit tests we also need to exclude window.location.pathname !== "blank"
      && !window.location.pathname.includes(basePath) && window.location.pathname !== "blank")
    || href.startsWith(basePath) || href.startsWith(basePath.substring(1))) {
    return href;
  }
  // If the href doesn't start with a / we need to insert one and strip it from the start
  return href && !href.startsWith("/") ? `${basePath.substring(1)}/${href}` : `${basePath}${href}`;
}

export function getHostUrl (req: IncomingMessage | undefined): string {
  // CNames are always http, main domain is https
  const protocol = req && req.headers.host && req.headers.host.includes(ROUTING_DOMAIN)
    ? "https"
    : "http";
  // If we have a request, we're server-side
  if (req && req.headers.host) {
    return `${protocol}://${req.headers.host}`;
  }
   if (typeof window !== "undefined") {
    return window.location.origin;
  }
  throw new Error("Could not determine host url. No request provided and no windows object");
}

/**
 * Attempts to format an error that can be an `Error`, an `AxiosError`, or a promise reject
 * @param error caught error
 * @returns {string} formatted string from the error
 */
export function formatError (error: unknown): string {
  // Check if it's an AxiosError
  if ((error as AxiosError).isAxiosError) {
    const axiosError: AxiosError = error as AxiosError;
    log("formatError AxiosError", LogLevel.DEBUG, { config: axiosError.config , response: axiosError.response });
    const methodText = `${axiosError.config?.method?.toUpperCase() || ""} ${axiosError.config?.url || "request"} failed`;
    if (axiosError.response) {
      let errorText: string;
      if (typeof axiosError.response.data === "string") {
        // It's a string
        errorText = axiosError.response.data;
      } else if (typeof (axiosError.response.data as TestManagerError)?.message === "string") {
        // It's a TestManagerError
        errorText = formatTestManagerError(axiosError.response.data as TestManagerError);
      } else {
        errorText = JSON.stringify(axiosError.response.data);
      }
      // Split the commas with new lines so the UI can choose appropriate places to line wrap.
      errorText = errorText.replace(/,/g, ",\n");
      log("formatError AxiosError", LogLevel.DEBUG, { methodText, errorText });
      return axiosError.config?.url && errorText.includes(axiosError.config.url)
        ? errorText // The errorText already has the `methodText` in it
        : `${methodText} with ${axiosError.response.status}:\n${errorText}`;
    } else {
      // No Response
      return `${methodText} with no reponse`;
    }
  }
  return (error as any)?.msg
    ? (error as any).msg
    : ((typeof (error as TestManagerError)?.message === "string")
      ? formatTestManagerError(error as TestManagerError)
      : `${error}`);
}

function formatTestManagerError (error: TestManagerError): string {
  // If we have a .error and the message doesn't already include error, add it
  return error.message + (typeof error.error === "string" && !error.message.includes(error.error)
    ? ":\n" + error.error
    : "");
}

export function getHourMinuteFromTimestamp (datetime: number): string {
  const date: Date = new Date(datetime);
  return date.toTimeString().split(" ")[0];
}

export const latestPewPewVersion: string = "latest";

/**
 * Sorts the array by versions returning the latest versions first and invalid versions last.
 * Should be passed to Array.sort().
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
 * @param a {string} curent value
 * @param b {string} next value
 * @returns {number} > 0 sort b before a, < 0 sort a before b, = a equals b
 */
 export const versionSort = (a: string | undefined, b: string | undefined): number => {
  // > 0 sort b before a
  // < 0 sort a before b
  // semver out the versions and compare
  const aValid: string | null = semver.valid(a);
  const bValid: string | null = semver.valid(b);
  // One is not a valid semver
  if (aValid === null || bValid === null) {
    // if latest sort it to the front
    if (a === latestPewPewVersion) {
      return -1; // put A first
    }
    if (b === latestPewPewVersion) {
      return 1; // put B first
    }
    if (aValid === null && bValid === null) {
      // string compare, both are invalid semver
      return String(a) < String(b) ? -1 : 1;
    }
    // One is not a valid semver, sort it to the end
    return aValid === null ? 1 : -1;
  }
  // Greater vesions should go first
  return semver.gt(aValid, bValid) ? -1 : 1;
};

export function getMaxVersion (pewpewVersions: string[]): string {
  const filtered = pewpewVersions
  .filter((version: string) => version && semver.valid(version) && semver.prerelease(version) === null)
  .sort(versionSort);
  // log("getMaxVersion filtered/sorted", LogLevel.DEBUG, { pewpewVersions, filtered });
  if (!filtered || filtered.length === 0) {
    return latestPewPewVersion;
  }
  return filtered.shift()!;
}

export const isYamlFile = (filename: string) => filename.endsWith(".yaml") || filename.endsWith(".yml");

/**
 * Attempts to determined if the current URL is a CName;
 * @param req {IncomingMessage} A Request object. Required if server side, will be undefined clientside
 * @returns A boolean if we have a request host or a window object. undefined otherwise.
 */
export function isCurrentUrlCname (req: IncomingMessage | undefined): boolean | undefined {
  if (req && req.headers.host !== undefined) {
    log("isCurrentUrlCname req.headers.host: " + req.headers.host, LogLevel.DEBUG, { TEST_LOCALHOST });
    return req.headers.host.includes(CNAME_DOMAIN) || (TEST_LOCALHOST && req.headers.host.includes(LOCALHOST_DOMAIN));
  }
  if (typeof window !== "undefined") {
    log("isCurrentUrlCname window.location.hostname: " + window.location.hostname, LogLevel.DEBUG, { TEST_LOCALHOST });
    return  window.location.hostname.includes(CNAME_DOMAIN) || (TEST_LOCALHOST && window.location.hostname.includes(LOCALHOST_DOMAIN));
  }
  return undefined;
}

// Creates unique id for a specific react element
export const uniqueId = () => {
  const id: string =  "" + Date.now() + Math.random();
  return id;
};

/**
 * Checks if the provided object has the basic properties of a `TestData` object
 * @param data object to check
 * @returns true if the object is a `TestData`
 */
export function isTestData (data: unknown): boolean {
  return data as TestData
    && typeof (data as TestData).testId === "string" && typeof (data as TestData).s3Folder === "string"
    && typeof (data as TestData).status === "string" && typeof (data as TestData).startTime === "number";
}

export function isTestManagerError (data: unknown): boolean {
  return data as TestManagerError
    && typeof (data as TestManagerError).message === "string"
    && (typeof (data as TestManagerError).error === "string" || (data as TestManagerError).error === undefined);
}

export function isTestManagerMessage (data: unknown): boolean {
  return data as TestManagerMessage
    && typeof (data as TestManagerMessage).message === "string"
    && (typeof (data as TestManagerMessage).messageId === "string" || (data as TestManagerMessage).messageId === undefined);
}
