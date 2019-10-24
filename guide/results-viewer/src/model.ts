import { HDRHistogram } from "hdr-histogram-wasm";

type CheckType = string | ((x: unknown) => boolean);
type Check = [string, CheckType];

function isObject (o: unknown): o is object {
  return typeof o == "object" && !!o;
}

function propertyChecker (o: object, checks: Check[], unknown?: CheckType): undefined | string {
  const checkMap = new Map(checks);

  for (const [k, v] of Object.entries(o)) {
    const value = checkMap.get(k);
    checkMap.delete(k);
    if (typeof value == "string") {
      const type = typeof v;
      if (type != value) {
        return `expected property "${k}" to be a "${value}" but it was a "${type}"`;
      }
    } else if (value !== undefined) {
      if (!value(v)) {
        return `property "${k}" did not pass check`;
      }
    } else if (typeof unknown == "string") {
      const type = typeof v;
      if (type != unknown) {
        return `expected property "${k}" to be a "${unknown}" but it was a "${type}"`;
      }
    } else if (unknown !== undefined) {
      if (!unknown(v)) {
        return `property "${k}" did not pass check`;
      }
    }
  }

  if (checkMap.size > 0) {
    const missingProperties = [...checkMap.keys()].map((k) => `"${k}"`).join(", ");
    return "missing properties: " + missingProperties;
  }

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
    return <BucketId> b;
  }
}

export class DataPoint {
  public readonly time: Date;
  public readonly duration: number;
  public readonly endTime?: Date;
  public readonly requestTimeouts: number;
  public readonly rttHistogram: HDRHistogram;
  public readonly startTime?: Date;
  public readonly statusCounts: StatusCounts;
  public readonly testErrors: TestErrors;

  public constructor (preProcessed: DataPointPreProcessed) {
    this.time = new Date(preProcessed.time * 1000);
    this.duration = preProcessed.duration;
    if (preProcessed.endTime != 0) {
      this.endTime = new Date(preProcessed.endTime * 1000);
    }
    this.requestTimeouts = 0;
    this.rttHistogram = new HDRHistogram(preProcessed.rttHistogram);
    if (preProcessed.startTime != 0) {
      this.startTime = new Date(preProcessed.startTime * 1000);
    }
    this.statusCounts = preProcessed.statusCounts;
    this.testErrors = preProcessed.testErrors;
  }
}

type StatusCounts = Record<string, number>;
type TestErrors = Record<string, number>;

function isStatusCounts (sc: unknown): sc is StatusCounts {
  if (!isObject(sc)) {
    return false;
  }
  // check that the keys can be parsed as a number and the values are numbers
  return Object.entries(sc).every(([k, v]: [string, unknown]) =>
    Number.parseInt(k, 10) > 0 && typeof v == "number"
  );
}

function isTestErrors (sc: unknown): sc is TestErrors {
  if (!isObject(sc)) {
    return false;
  }
  // check that the values are all numbers
  return Object.values(sc).every((v: unknown) => typeof v == "number");
}

interface DataPointPreProcessed {
  readonly time: number;
  readonly duration: number;
  readonly endTime: number;
  readonly rttHistogram: string;
  readonly startTime: number;
  readonly statusCounts: StatusCounts;
  readonly testErrors: TestErrors;
}

function asDataPointPreProcessed (dp: unknown): DataPointPreProcessed | Error {
  if (!isObject(dp)) {
    return new Error("data point is not an object");
  }

  const checks: Check[] = [
    ["duration", "number"],
    ["endTime", "number"],
    ["requestTimeouts", "number"],
    ["rttHistogram", "string"],
    ["startTime", "number"],
    ["statusCounts", isStatusCounts],
    ["testErrors", isTestErrors],
    ["time", "number"]
  ];
  const result = propertyChecker(dp, checks);
  if (result) {
    return new Error("failed property check for data point. " + result);
  } else {
    return <DataPointPreProcessed> dp;
  }
}

type BucketEntry = [BucketId, DataPointPreProcessed[]];

function asBucketEntry (b: unknown): BucketEntry | Error {
  if (!Array.isArray(b)) {
    return new Error(`expected bucket entry to be an array but got: ${JSON.stringify(b)}`);
  }
  if (b.length != 2) {
    return new Error(`expected bucket entry to be an array with 2 element but it had ${b.length}`);
  }
  {
    const result = asBucketId(b[0]);
    if (result instanceof Error) {
      return result;
    }
  }
  if (!Array.isArray(b[1])) {
    return new Error(`expected second value in bucket entry array to be an array bug got: ${JSON.stringify(b[1])}`);
  }
  for (const dppp of b[1]) {
    const result = asDataPointPreProcessed(dppp);
    if (result instanceof Error) {
      return result;
    }
  }
  return <BucketEntry> b;
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
  const buckets: unknown[] = (<any> s).buckets;
  for (const b of buckets) {
    const result = asBucketEntry(b);
    if (result instanceof Error) {
      return result;
    }
  }
  return <StatsFile> s;
}

export type ParsedFileEntry = [BucketId, DataPoint[]];

export function parseStatsFile (file: File): Promise<ParsedFileEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = (e) => {
      const contents = <string> reader.result;
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch (e) {
        reject(new Error("Not a valid stats file: invalid JSON"));
      }
      const result = asStatsFile(parsed);
      if (result instanceof Error) {
        reject(result);
      } else {
        const ret: ParsedFileEntry[] = [];
        for (const [bucketId, dataPoints] of result.buckets) {
          ret.push([bucketId, dataPoints.map((dp) => new DataPoint(dp))]);
        }
        resolve(ret);
      }
    };
  });
}
