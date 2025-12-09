import {
  CNAME_DOMAIN,
  LOCALHOST_DOMAIN,
  ROUTING_DOMAIN,
  getBasePath,
  getHostUrl,
  isCurrentUrlCname
} from "./clientutil";
import { LogLevel, log } from "./log";
import { IncomingMessage } from "http";
import jsCookie from "js-cookie";

// AUTH_MODE overrides FS_SITE
export const AUTH_MODE: string | undefined = (process.env.AUTH_MODE || process.env.FS_SITE) ? (process.env.AUTH_MODE || process.env.FS_SITE!).trim() : undefined;
const AUTH_MODE_OFF: string = "false";

export const isAuthEnabled = (): boolean => AUTH_MODE !== undefined && AUTH_MODE !== AUTH_MODE_OFF;
export const isAuthDevelopment = (): boolean => isAuthEnabled()
  && (AUTH_MODE?.startsWith("dev") || AUTH_MODE === "test" || AUTH_MODE?.endsWith("-np")) === true;
log("publicRuntimeConfig AUTH_MODE=" + AUTH_MODE, LogLevel.DEBUG, { AUTH_MODE: process.env.AUTH_MODE, FS_SITE: process.env.FS_SITE });
log("AUTH_MODE=" + AUTH_MODE, LogLevel.DEBUG);

export const SESSION_EXPIRED_MESSAGE: string = "Session Expired. Please login again.";
export const NOT_AUTHORIZED_MESSAGE: string = "User is not authorized for this page.";
export const ACCESS_DENIED_AUTHENTICATION: string = "access_denied"; // error_description="User is not assigned to the client application"

export const IS_RUNNING_IN_AWS: boolean = process.env.APPLICATION_NAME !== undefined && process.env.SYSTEM_NAME !== undefined;
const AUTH_COOKIE_PATH: string = process.env.AUTH_COOKIE_PATH
  ? process.env.AUTH_COOKIE_PATH.toLowerCase()
  : "/pewpew/";
export const AUTH_COOKIE_NAME: string = process.env.AUTH_COOKIE_NAME
  ? process.env.AUTH_COOKIE_NAME.toLowerCase()
  : "perftesttoken";
export const REFRESH_COOKIE_NAME: string = process.env.REFRESH_COOKIE_NAME
  ? process.env.REFRESH_COOKIE_NAME.toLowerCase()
  : "perftesttokenrefresh";
export const HINT_COOKIE_NAME: string = process.env.HINT_COOKIE_NAME
  ? process.env.HINT_COOKIE_NAME.toLowerCase()
  : "perftesttokenhint";
// Headers are always lowercase. So even if you capitalize here, when we parse for it it'll be lowercase.
export const AUTH_HEADER_NAME: string = process.env.AUTH_HEADER_NAME
  ? process.env.AUTH_HEADER_NAME.toLowerCase()
  : AUTH_COOKIE_NAME;
export const AUTH_HEADER_HOST: string = "authhost";
export const COOKIE_DURATION_DAYS: number = parseInt(process.env.COOKIE_DURATION_DAYS || "0", 10) || 1;
export const REFRESH_COOKIE_DURATION_DAYS: number = parseInt(process.env.REFRESH_COOKIE_DURATION_DAYS || "0", 10) || 1;

// Allow internal and external. During development allow localhost
export const VALID_DOMAINS: string[] = [CNAME_DOMAIN, ROUTING_DOMAIN];
if (isAuthDevelopment()) { VALID_DOMAINS.push(LOCALHOST_DOMAIN); }
log("VALID_DOMAINS=" + VALID_DOMAINS, LogLevel.DEBUG, { VALID_DOMAINS, isAuthEnabled: isAuthEnabled(), AUTH_MODE });

export function getDomain (req?: IncomingMessage): string {
  const hostUrl = new URL(getHostUrl(req));
  // Return a domain if matched, or the full host
  return VALID_DOMAINS.find((domain: string) => hostUrl.hostname.endsWith(domain))
    || hostUrl.hostname;
}

/**
 * Checks if we have a basepath and are not on the CNAME. If we do have a basepath and are not on the
 * CNAME, return the AUTH_COOKIE_PATH ("/pewpew/");
 * @param req {IncomingMessage} optional request object if we're server side
 * @returns {string} a path if we have one, or undefined if we shouldn't use one.
 */
export function getCookiePath (req?: IncomingMessage): string | undefined {
  if (getBasePath() && !isCurrentUrlCname(req)) {
    return AUTH_COOKIE_PATH;
  }
  return undefined;
}

export function logout (hintCookie?: boolean) {
  const domain: string = getDomain();
  const path: string | undefined = getCookiePath();
  log(`Removing cookie ${AUTH_COOKIE_NAME} on ${domain} at ${path}`, LogLevel.DEBUG);
  jsCookie.remove(AUTH_COOKIE_NAME, { domain });
  jsCookie.remove(AUTH_COOKIE_NAME, { domain, path });
  log(`Removing cookie ${REFRESH_COOKIE_NAME} on ${domain} at ${path}`, LogLevel.DEBUG);
  jsCookie.remove(REFRESH_COOKIE_NAME, { domain });
  jsCookie.remove(REFRESH_COOKIE_NAME, { domain, path });
  if (hintCookie) {
    log(`Removing cookie ${HINT_COOKIE_NAME} on ${domain} at ${path}`, LogLevel.DEBUG);
    jsCookie.remove(HINT_COOKIE_NAME, { domain });
    jsCookie.remove(HINT_COOKIE_NAME, { domain, path });
    log(`Removing cookie fs_experiments on ${window.location.hostname}`, LogLevel.DEBUG);
    jsCookie.remove("fs_experiments", { domain: window.location.hostname });
  }
}
