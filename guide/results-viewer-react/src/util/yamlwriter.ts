// General Types are used in Content and Header components and in writeyaml file
import { Entry, Page } from "har-format";
import React from "react";

/** Used when an input can be added via multiple methods (the enter key, the click of a button, or the change of a checkbox) */
export type InputEvent = React.ChangeEvent | React.KeyboardEvent<HTMLInputElement> | React.MouseEvent<HTMLButtonElement>;
/** Used as the type of an incoming Har file */
export interface Har {
  log: {
    version: string
    creator: { name: string, version: string },
    entries: Entry[],
    pages: Page[],
  }
}
/** This is the type for all headers added to any endpoints */
export interface HarHeader {
  name: string;
  value: string;
}
export interface PewPewHeader extends HarHeader {
  id: string;
}

/** This is the type for all query params added to any endpoints */
export interface PewPewQueryParam {
  id: string;
  name: string;
  value: string;
}

/** This is what an endpoint looks like from an incoming Har file */
export interface HarEndpoint {
  id: string;
  url: string;
  type: string;
  headers: HarHeader[];
  method: string;
  selected: string;
}
/** Stores all the information for a certain endpoint */
export interface PewPewAPI {
  id: string;
  url: string;
  headers: PewPewHeader[];
  requestBody?: object;
  method: string;
  hitRate: string;
  authorization: null;
}
/** Stores all the information for a certain load pattern */
export interface PewPewLoadPattern {
  id: string;
  from: string;
  to: string;
  over: string;
}
/** Stores all the information for a certain variable */
export interface PewPewVars {
  id: string;
  name: string;
  value: string;
}
/** Stores all the information for a certain provider */
export interface PewPewProvider {
  id: string;
  type: "file" | "response" | "range" | "list",
  name: string;
  file?: string;
  start?: number;
  end?: number | string;
  step?: number | string;
  response?: Record<string, string>;
  list?: ProviderListEntry[];
  repeat?: boolean;
  random?: boolean;
}
/** this is the type for any entry added to a list provider */
export interface ProviderListEntry {
  id: string;
  value: string;
}
/** Stores all the information for a certain logger */
export interface PewPewLogger {
  id: string;
  name: string;
  select: LoggerSelectEntry[];
  where: string;
  to: string;
  limit: number | string;
  pretty: boolean;
  kill: boolean;
}
/** this is the type for any entry added to a logger select list */
export interface LoggerSelectEntry {
  id: string;
  name: string;
  value: string;
}

// Version-specific expression syntax
export type PewPewVersion = "0.5.x" | "0.6.x";

export const getSessionIdDefault = (version: PewPewVersion) =>
  version === "0.6.x" ? "${e:SESSIONID}" : "${SESSIONID}";
export const getRampTimeDefault = (version: PewPewVersion) =>
  version === "0.6.x" ? "${e:RAMP_TIME}" : "${RAMP_TIME}";
export const getLoadTimeDefault = (version: PewPewVersion) =>
  version === "0.6.x" ? "${e:LOAD_TIME}" : "${LOAD_TIME}";
export const getPeakLoadDefault = (version: PewPewVersion) =>
  version === "0.6.x" ? "${e:PEAK_LOAD}" : "${PEAK_LOAD}";

// For backward compatibility (defaults to 0.5.x stable)
export const SESSION_ID_DEFAULT = getSessionIdDefault("0.5.x");
export const RAMP_TIME_DEFAULT = getRampTimeDefault("0.5.x");
export const LOAD_TIME_DEFAULT = getLoadTimeDefault("0.5.x");
export const PEAK_LOAD_DEFAULT = getPeakLoadDefault("0.5.x");

// Helper to construct variable references in YAML (for peak_load, over, etc.)
// 0.5.x uses template syntax: ${varName}
// 0.6.x uses variable reference syntax: ${v:varName}
export const getVariableReference = (varName: string, version: PewPewVersion): string =>
  version === "0.6.x" ? `\${v:${varName}}` : `\${${varName}}`;

// Version-aware regex patterns for validation
// Hit rate validation: matches "10hpm" or variable references
export const HIT_RATE_REGEX_05X = new RegExp("^(\\d+)hp(h|m|s)$|^\\$\\{[a-zA-Z][a-zA-Z0-9]*\\}$");  // 0.5.x: ${varName}
export const HIT_RATE_REGEX_06X = new RegExp("^(\\d+)hp(h|m|s)$|^\\$\\{v:[a-zA-Z][a-zA-Z0-9]*\\}$");  // 0.6.x: ${v:varName}

// Time duration validation: matches "15m" or "1h 30m" or variable references
export const OVER_REGEX_05X = new RegExp("^((((\\d+)\\s?(h|hr|hrs|hour|hours))\\s?)?(((\\d+)\\s?(m|min|mins|minute|minutes))\\s?)?(((\\d+)\\s?(s|sec|secs|second|seconds)))?)$|^\\$\\{[a-zA-Z][a-zA-Z0-9]*\\}$");  // 0.5.x: ${varName}
export const OVER_REGEX_06X = new RegExp("^((((\\d+)\\s?(h|hr|hrs|hour|hours))\\s?)?(((\\d+)\\s?(m|min|mins|minute|minutes))\\s?)?(((\\d+)\\s?(s|sec|secs|second|seconds)))?)$|^\\$\\{v:[a-zA-Z][a-zA-Z0-9]*\\}$");  // 0.6.x: ${v:varName}

// Helper functions to get the correct regex based on version
export const getHitRateRegex = (version: PewPewVersion): RegExp =>
  version === "0.6.x" ? HIT_RATE_REGEX_06X : HIT_RATE_REGEX_05X;

export const getOverRegex = (version: PewPewVersion): RegExp =>
  version === "0.6.x" ? OVER_REGEX_06X : OVER_REGEX_05X;
