// General Types are used in Content and Header components and in writeyaml file
import {Entry, Page} from "har-format";
import React from "react";

/** Used when an input can be added via multiple methods (the enter key, the click of a button, or the change of a checkbox) */
export type InputEvent = React.ChangeEvent | React.KeyboardEvent<HTMLInputElement> | React.MouseEvent<HTMLButtonElement>;
/** Used as the type of an incoming Har file */
export interface Har {
  log: {
    version: string
    creator: { name: string, version: string},
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

export const SESSION_ID_DEFAULT = "${SESSIONID}";
export const RAMP_TIME_DEFAULT = "${RAMP_TIME}";
export const LOAD_TIME_DEFAULT = "${LOAD_TIME}";
export const PEAK_LOAD_DEFAULT = "${PEAK_LOAD}";
