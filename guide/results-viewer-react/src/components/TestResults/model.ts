import { HDRHistogram } from "@fs/hdr-histogram-wasm";
type CheckType = string | ((x: unknown) => boolean);
type Check = [string, CheckType];

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
    return b as BucketId;
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

  /**
   * True when any request was recorded in this bucket.
   * Buckets added by fillMissingBuckets have none.
   */
  hasActivity (): boolean {
    return Number(this.rttHistogram.getTotalCount()) > 0
      || this.requestTimeouts > 0
      || Object.keys(this.statusCounts).length > 0
      || Object.keys(this.testErrors).length > 0;
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
    return dp as DataPointPreProcessed;
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
      `expected second value in bucket entry array to be an array but got: ${JSON.stringify(
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
  return b as BucketEntry;
}

interface StatsFile {
  buckets: BucketEntry[];
}

function asStatsFile (s: unknown): StatsFile | Error {
  if (!isObject(s)) {
    return new Error("stats is not an object");
  }

   const checks: Check[] = [["buckets", Array.isArray]];
  {
    const result = propertyChecker(s, checks);
    if (result) {
      return new Error("failed property check for stats. " + result);
    }
  }
  const buckets: unknown[] = (s as any).buckets;
  for (const b of buckets) {
    const result = asBucketEntry(b);
    if (result instanceof Error) {
      return result;
    }
  }
  return s as StatsFile;
}

export type ParsedFileEntry = [BucketId, DataPoint[]];

/** base64 string of an empty HDRHistogram */
export const EMPTY_HISTOGRAM_BASE64 = "HISTEwAAAAEAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAAAA";

function emptyDataPoint (time: number, duration: number): DataPointPreProcessed {
  return {
    time,
    duration,
    endTime: time + duration,
    rttHistogram: EMPTY_HISTOGRAM_BASE64,
    startTime: time,
    statusCounts: {},
    testErrors: {}
  };
}

/** Smallest positive bucket duration among the data points, or 0 when none has one. */
function smallestDuration (durations: Iterable<number>): number {
  let smallest = Infinity;
  for (const duration of durations) {
    if (duration > 0) {
      smallest = Math.min(smallest, duration);
    }
  }
  return Number.isFinite(smallest) ? smallest : 0;
}

/**
 * Upper bound on the empty data points a fill may add across all endpoints. Each one carries a WASM
 * histogram, and merging two runs recorded days apart would otherwise fill every bucket in between.
 */
export const MAX_FILLED_POINTS = 100_000;

/**
 * The bucket times every endpoint should cover: from the earliest to the latest time seen, stepping
 * by the bucket size, plus any time that is actually present. Sorted ascending. The stepping is
 * skipped when it would add more than MAX_FILLED_POINTS across the endpoints; the times actually
 * present are always included.
 */
function timeGrid (times: Iterable<number>, bucketSize: number, endpointCount: number): number[] {
  const allTimes = new Set<number>();
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const time of times) {
    allTimes.add(time);
    minTime = Math.min(minTime, time);
    maxTime = Math.max(maxTime, time);
  }
  if (allTimes.size > 0 && bucketSize > 0) {
    const steps = Math.floor((maxTime - minTime) / bucketSize) + 1;
    if ((steps - allTimes.size) * endpointCount <= MAX_FILLED_POINTS) {
      for (let time = minTime; time <= maxTime; time += bucketSize) {
        allTimes.add(time);
      }
    }
  }
  return [...allTimes].sort((a, b) => a - b);
}

/**
 * Lays one endpoint's points onto the grid, inserting an empty point at each time the endpoint has
 * none. Points that share a time are all kept, in their original order. O(points + grid).
 */
function fillOntoGrid<T> (grid: number[], points: T[], getTime: (point: T) => number, makeEmpty: (time: number) => T): T[] {
  const byTime = new Map<number, T[]>();
  for (const point of points) {
    const time = getTime(point);
    const existing = byTime.get(time);
    if (existing) {
      existing.push(point);
    } else {
      byTime.set(time, [point]);
    }
  }
  const filled: T[] = [];
  for (const time of grid) {
    const existing = byTime.get(time);
    if (existing) {
      filled.push(...existing);
    } else {
      filled.push(makeEmpty(time));
    }
  }
  return filled;
}

/**
 * Fills in the time buckets each endpoint is missing with empty data points so every endpoint
 * covers the same time grid as the whole test, sorted by time.
 *
 * The stats file only writes an endpoint into a time bucket when that endpoint had activity in it.
 * An endpoint with intermittent errors (or one whose requests stop part way through the test) would
 * otherwise have holes in its series, and a line chart draws straight across a hole instead of
 * dropping to zero.
 */
export function fillMissingBuckets (buckets: BucketEntry[]): BucketEntry[] {
  const all = buckets.flatMap(([, dataPoints]) => dataPoints);
  if (all.length === 0) {
    return buckets;
  }
  const duration = smallestDuration(all.map((dp) => dp.duration));
  const grid = timeGrid(all.map((dp) => dp.time), duration, buckets.length);
  return buckets.map(([bucketId, dataPoints]) =>
    [bucketId, fillOntoGrid(grid, dataPoints, (dp) => dp.time, (time) => emptyDataPoint(time, duration))]);
}

/**
 * The same fill for parsed data points, used after several files are merged: an endpoint that only
 * some of the files contain would otherwise stop where those files stop. DataPoint times are in
 * milliseconds and durations in seconds. Returns new arrays; the input points are reused, not cloned.
 */
export function fillMissingDataPoints (entries: ParsedFileEntry[]): ParsedFileEntry[] {
  const all = entries.flatMap(([, dataPoints]) => dataPoints);
  if (all.length === 0) {
    return entries;
  }
  const duration = smallestDuration(all.map((dp) => dp.duration));
  const grid = timeGrid(all.map((dp) => dp.time.getTime()), duration * 1000, entries.length);
  return entries.map(([bucketId, dataPoints]) => [
    bucketId,
    fillOntoGrid(grid, dataPoints, (dp) => dp.time.getTime(), (timeMs) => new DataPoint(emptyDataPoint(timeMs / 1000, duration)))
  ]);
}

export function processJson (json: any): ParsedFileEntry[] {
  const result = asStatsFile(json);

  if (result instanceof Error) {
    throw result;
  } else {
    const ret: ParsedFileEntry[] = [];
    for (const [bucketId, dataPoints] of fillMissingBuckets(result.buckets)) {
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
          rttHistogram: values.rttHistogram || EMPTY_HISTOGRAM_BASE64,
          startTime: time,
          statusCounts: values.statusCounts || {},
          testErrors: values.testErrors || {},
          // Only set when present: the property checks reject an explicit undefined
          ...(values.requestTimeouts !== undefined ? { requestTimeouts: values.requestTimeouts } : {})
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
