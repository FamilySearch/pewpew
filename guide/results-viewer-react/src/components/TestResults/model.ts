import { HDRHistogram } from "@fs/hdr-histogram-wasm";
type CheckType = string | ((x: unknown) => boolean);
type Check = [string, CheckType];

// eslint-disable-next-line  @typescript-eslint/ban-types
function isObject (o: unknown): o is object {
  return typeof o === "object" && !!o;
}

/**
 * Checks the key/value pair against an expected CheckType (typeof or function) or against the optional unknown CheckType
 * @param check {CheckType | undefined} Type of check (string or function) to use on this key and value.
 * @param unknownCheck {CheckType | undefined} Check to run (if any) if this is not a known key
 * @param key {string} key from parent object
 * @param value {any} value from parent object
 * @returns A string if there is a problem with this key/value pair, undefined otherwise
 */
 function valueChecker (check: CheckType | undefined, unknownCheck: CheckType | undefined, key: string, value: any) {
  // first check if we have a check for this key. If we do, it needs to match.
  if (typeof check === "string") {
    const type = typeof value;
    if (type !== check) {
      return `expected property "${key}" to be a "${check}" but it was a "${type}"`;
    }
  } else if (check !== undefined) {
    // function CheckType
    if (!check(value)) {
      return `property "${key}" did not pass check`;
    }
  // It's an uknown property, do we have an unknownCheck?
  } else if (typeof unknownCheck === "string") {
    const type = typeof value;
    if (type !== unknownCheck) {
      return `expected property "${key}" to be a "${unknownCheck}" but it was a "${type}"`;
    }
  } else if (unknownCheck !== undefined) {
    // function CheckType
    if (!unknownCheck(value)) {
      return `property "${key}" did not pass check`;
    }
  }
  // Allow additional properties to not error
  return undefined;
}

/**
 * Checks an object for expected properties. If the properties are missing or not of the type
 * in checks (or unknown), returns the failure.
 * @param o Object to check
 * @param requiredChecks required fields
 * @param unknownCheck verification to run on fields that are not in checks or optionalChecks
 * @param optionalChecks optional fields
 * @returns failed check or undefined
 */
function propertyChecker (
  // eslint-disable-next-line  @typescript-eslint/ban-types
  o: object,
  requiredChecks: Check[],
  unknownCheck?: CheckType,
  optionalChecks?: Check[]
): undefined | string {
  const requiredMap: Map<string, CheckType>  = new Map<string, CheckType>(requiredChecks);
  const optionalMap = new Map(optionalChecks || []);

  // console.log(`propertyChecker checks: ${JSON.stringify(checks)}, o: ${JSON.stringify(o)}`);
  for (const [key, value] of Object.entries(o)) {
    const check = requiredMap.get(key) || optionalMap.get(key);
    requiredMap.delete(key);
    const checkedResult = valueChecker(check, unknownCheck, key, value);
    // console.log(`propertyChecker k: ${k}, v: ${JSON.stringify(v)}, value: ${JSON.stringify(value)}, unknown: ${JSON.stringify(unknown)}, checked: ${JSON.stringify(checked)}`);
    // Extra properties will still be undefined if unknownCheck is undefined
    if (checkedResult) {
      return checkedResult;
    }
  }

  // Check for missing properties that means this isn't the type we expected
  if (requiredMap.size > 0) {
    const missingProperties = [...requiredMap.keys()]
      .map((k) => `"${k}"`)
      .join(", ");
    return "missing properties: " + missingProperties;
  }

  // This did match the checks we expected
  return undefined;
}

export interface BucketId {
  readonly method: string;
  readonly url: string;
  readonly [key: string]: string;
}

function asBucketId (b: unknown): BucketId | Error {
  if (!isObject(b)) {
    return new Error("bucket id is not an object");
  }

  const checks: Check[] = [
    ["method", "string"],
    ["url", "string"]
  ];
  const result = propertyChecker(b, checks, "string");
  if (result) {
    return new Error("failed property check for bucket id. " + result);
  } else {
    return <BucketId>b;
  }
}

export class DataPoint {
  public readonly time: Date;
  public readonly duration: number;
  public readonly endTime?: Date;
  public requestTimeouts: number;
  public readonly rttHistogram: HDRHistogram;
  public readonly startTime?: Date;
  public readonly statusCounts: StatusCounts;
  public readonly testErrors: TestErrors;

  public constructor (preProcessed: DataPointPreProcessed) {
    this.time = new Date(preProcessed.time * 1000);
    this.duration = preProcessed.duration;
    if (preProcessed.endTime !== 0) {
      this.endTime = new Date(preProcessed.endTime * 1000);
    }
    this.requestTimeouts = preProcessed.requestTimeouts || 0;
    this.rttHistogram = new HDRHistogram(preProcessed.rttHistogram);
    if (preProcessed.startTime !== 0) {
      this.startTime = new Date(preProcessed.startTime * 1000);
    }
    this.statusCounts = preProcessed.statusCounts;
    this.testErrors = preProcessed.testErrors;
  }

  mergeInto (other: DataPoint) {
    // merge the requestTimeouts
    this.requestTimeouts += other.requestTimeouts;

    // merge the rttHistogram
    this.rttHistogram.add(other.rttHistogram);

    // merge the statusCounts
    for (const key of Object.keys(other.statusCounts)) {
      this.statusCounts[key] = (this.statusCounts[key] || 0) + (other.statusCounts[key] || 0);
    }

    // merge the testErrors
    for (const key of Object.keys(other.testErrors)) {
      this.testErrors[key] = (this.testErrors[key] || 0) + (other.testErrors[key] || 0);
    }
  }

  clone (): DataPoint {
    const props = {
      rttHistogram: this.rttHistogram.clone(),
      statusCounts: Object.assign({}, this.statusCounts),
      testErrors: Object.assign({}, this.testErrors)
    };
    return Object.assign(Object.create(this), this, props);
  }
}

type StatusCounts = Record<string, number>;
type TestErrors = Record<string, number>;

function isStatusCounts (sc: unknown): sc is StatusCounts {
  if (!isObject(sc)) {
    return false;
  }
  // check that the keys can be parsed as a number and the values are numbers
  return Object.entries(sc).every(
    ([k, v]: [string, unknown]) =>
      Number.parseInt(k, 10) > 0 && typeof v === "number"
  );
}

function isTestErrors (sc: unknown): sc is TestErrors {
  if (!isObject(sc)) {
    return false;
  }
  // check that the values are all numbers
  return Object.values(sc).every((v: unknown) => typeof v === "number");
}

export interface DataPointPreProcessed {
  readonly time: number;
  readonly duration: number;
  readonly endTime: number;
  readonly rttHistogram: string;
  readonly startTime: number;
  readonly statusCounts: StatusCounts;
  readonly testErrors: TestErrors;
  readonly requestTimeouts?: number;
}

function asDataPointPreProcessed (dp: unknown): DataPointPreProcessed | Error {
  if (!isObject(dp)) {
    return new Error("data point is not an object");
  }

  const checks: Check[] = [
    ["duration", "number"],
    ["endTime", "number"],
    ["rttHistogram", "string"],
    ["startTime", "number"],
    ["statusCounts", isStatusCounts],
    ["testErrors", isTestErrors],
    ["time", "number"]
  ];
  const optionalChecks: Check[] = [
    ["requestTimeouts", "number"]
  ];
  const result = propertyChecker(dp, checks, undefined, optionalChecks);
  if (result) {
    return new Error("failed property check for data point. " + result);
  } else {
    return <DataPointPreProcessed>dp;
  }
}

type BucketEntry = [BucketId, DataPointPreProcessed[]];

function asBucketEntry (b: unknown): BucketEntry | Error {
  if (!Array.isArray(b)) {
    return new Error(
      `expected bucket entry to be an array but got: ${JSON.stringify(b)}`
    );
  }
  if (b.length !== 2) {
    return new Error(
      `expected bucket entry to be an array with 2 element but it had ${b.length}`
    );
  }
  {
    const result = asBucketId(b[0]);
    if (result instanceof Error) {
      return result;
    }
  }
  if (!Array.isArray(b[1])) {
    return new Error(
      `expected second value in bucket entry array to be an array bug got: ${JSON.stringify(
        b[1]
      )}`
    );
  }
  for (const dppp of b[1]) {
    const result = asDataPointPreProcessed(dppp);
    if (result instanceof Error) {
      return result;
    }
  }
  return <BucketEntry>b;
}

interface StatsFile {
  buckets: BucketEntry[];
}

function asStatsFile (s: unknown): StatsFile | Error {
  if (!isObject(s)) {
    return new Error("stats is not an object");
  }

  // tslint:disable-next-line: no-unbound-method
  const checks: Check[] = [["buckets", Array.isArray]];
  {
    const result = propertyChecker(s, checks);
    if (result) {
      return new Error("failed property check for stats. " + result);
    }
  }
  const buckets: unknown[] = (<any>s).buckets;
  for (const b of buckets) {
    const result = asBucketEntry(b);
    if (result instanceof Error) {
      return result;
    }
  }
  return <StatsFile>s;
}

export type ParsedFileEntry = [BucketId, DataPoint[]];

export function processJson (json: any): ParsedFileEntry[] {
  const result = asStatsFile(json);

  if (result instanceof Error) {
    throw result;
  } else {
    const ret: ParsedFileEntry[] = [];
    for (const [bucketId, dataPoints] of result.buckets) {
      ret.push([bucketId, dataPoints.map((dp) => new DataPoint(dp))]);
    }
    return ret;
  }
}

interface Header {
  test: string;
  bin: string;
  bucketSize: number;
}

interface RequiredTags {
  id: string;
  method: string;
  url: string;
}

interface Tags {
  index: number;
  tags: Record<string, string> & RequiredTags;
}

interface TimeBucketEntry {
  rttHistogram: string | undefined;
  statusCounts: Record<string, number> | undefined;
  requestTimeouts: number | undefined;
  testErrors: Record<string, number> | undefined;
}

interface Buckets {
  time: number;
  entries: Record<string, TimeBucketEntry>;
}

function isTags (tags: unknown): tags is Tags {
  if (!isObject(tags)) {
    return false;
  }

  const tags2: any = tags;

  return typeof tags2.index === "number"
    && Object.entries(tags2.tags).every(([_k, v]: [string, unknown]) => typeof v === "string")
    && tags2.tags["_id"] !== undefined
    && tags2.tags["method"] !== undefined
    && tags2.tags["url"] !== undefined;
}

function isTimeBucketEntry (tbe: unknown): tbe is TimeBucketEntry {
  if (!isObject(tbe)) {
    return false;
  }

  const tbe2: any = tbe;

  const fails = (tbe2["rttHistogram"] !== undefined && typeof tbe2.rttHistogram !== "string")
    || (tbe2["statusCounts"] !== undefined && !isStatusCounts(tbe2.statusCounts))
    || (tbe2["requestTimeouts"] !== undefined && typeof tbe2.requestTimeouts !== "number")
    || (tbe2["testErrors"] !== undefined && !isTestErrors(tbe2.testErrors));

  return !fails;
}

function isEntries (entries: unknown): entries is Record<string, TimeBucketEntry> {
  if (!isObject(entries)) {
    return false;
  }

  return Object.entries(entries).every(
    ([_k, v]: [string, unknown]) => isTimeBucketEntry(v));
}

function isHeader (header: unknown): header is Header {
  if (!isObject(header)) {
    return false;
  }

  const headerChecks: Check[] = [
    ["test", "string"],
    ["bin", "string"],
    ["bucketSize", "number"]
  ];

  return !propertyChecker(header, headerChecks);
}

function isBuckets (buckets: unknown): buckets is Buckets {
  if (!isObject(buckets)) {
    return false;
  }

  const bucketsChecks: Check[] = [
    ["time", "number"],
    ["entries", isEntries]
  ];

  return !propertyChecker(buckets, bucketsChecks);
}

function checkNewJsonEntry (entry: unknown): entry is Header | Tags | Buckets {
  return isHeader(entry)
    || isTags(entry)
    || isBuckets(entry);
}

export function processNewJson (jsons: unknown[]): ParsedFileEntry[] {
  const tags: BucketId[] = [];
  const data: DataPointPreProcessed[][] = [];
  let bucketSize = 0;
  for (const json of jsons) {
    if (!checkNewJsonEntry(json)) {
      throw new Error("failed property checks for entry");
    }

    if ("test" in json) {
      bucketSize = json.bucketSize;
      continue;
    } else if ("tags" in json) {
      tags[json.index] = json.tags;
    } else {
      const time = json.time;
      for (const [index, values] of Object.entries(json.entries)) {
        const dppp: DataPointPreProcessed = {
          time,
          duration: bucketSize,
          endTime: time + bucketSize,
          rttHistogram: values.rttHistogram || "HISTEwAAAAEAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAAAA", // base64 string of an empty HDRHistogram
          startTime: time,
          statusCounts: values.statusCounts || {},
          testErrors: values.testErrors || {}
        };

        const index2 = parseInt(index, 10);
        data[index2] = data[index2] || [];
        data[index2].push(dppp);
      }
    }
  }

  const buckets: BucketEntry[] = [];

  for (const [index, tag] of tags.entries()) {
    buckets[index] = [tag, data[index]];
  }

  const statsFile: StatsFile = { buckets };

  return processJson(statsFile);
}
