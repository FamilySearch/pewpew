import { ParsedFileEntry } from "./model";

export interface MinMaxTime {
  startTime?: string;
  endTime?: string;
  deltaTime?: string;
}

export const dateToString = (dateTime: Date, timeOnly: boolean) => {
  let stringDate = dateTime.toLocaleTimeString("en-us", { hour12: false });
  if (!timeOnly) {
    stringDate += ` ${dateTime.getDate()}-${dateTime.toLocaleString("en-us", {
      month: "short"
    })}-${dateTime.getFullYear()}`;
  }
  return stringDate;
};

export const minMaxTime = (testResults: any) => {
  const testTimes: MinMaxTime = {
    startTime: undefined,
    endTime: undefined,
    deltaTime: undefined
  };

  let startTime2 = Infinity;
  let endTime2 = -Infinity;

  for (const [_, dataPoints] of testResults) {
    for (const point of dataPoints) {
      if (point.startTime) {
        startTime2 = Math.min(startTime2, point.startTime);
        break;
      }
    }

    for (let i = dataPoints.length - 1; i >= 0; i--) {
      const point = dataPoints[i];
      if (point.endTime) {
        endTime2 = Math.max(endTime2, point.endTime);
        break;
      }
    }
  }

  const second: number = 1;
  const minute: number = 60;
  const hour: number = minute * 60;
  const day: number = hour * 24;
  let deltaTimeInSeconds: number = (endTime2 - startTime2) / 1000;

  const startTime3: Date = new Date(startTime2);
  const endTime3: Date = new Date(endTime2);

  const includeDateWithStart = startTime3.toLocaleDateString() === endTime3.toLocaleDateString();
  testTimes.startTime = dateToString(startTime3, includeDateWithStart);
  testTimes.endTime = dateToString(endTime3, false);

  const timeUnits: [number, string][] = [
    [day, "day"],
    [hour, "hour"],
    [minute, "minute"],
    [second, "second"]
  ];
  const prettyDurationBuilder = [];
  for (const [unit, name] of timeUnits) {
    const count = Math.floor(deltaTimeInSeconds / unit);
    if (count > 0) {
      deltaTimeInSeconds -= count * unit;
      prettyDurationBuilder.push(`${count} ${name}${count > 1 ? "s" : ""}`);
    }
  }

  testTimes.deltaTime = prettyDurationBuilder.join(", ");

  return testTimes;
};

// Comprehensive sort function for ParsedFileEntry arrays
export const comprehensiveSort = (entries: ParsedFileEntry[]): ParsedFileEntry[] => {
  return entries.sort(([a], [b]) => {
    const aId = parseInt(a._id, 10);
    const bId = parseInt(b._id, 10);
    if (aId === bId) {
      // Sort alphabetically by stringified tags for consistent ordering
      return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
    }
    return aId - bId;
  });
};

// Cached model import to avoid repeated dynamic imports
let modelCache: any = null;

export const parseResultsData = async (text: string): Promise<ParsedFileEntry[]> => {
  try {
    const results = text.replace(/}{/g, "}\n{")
      .split("\n")
      .map((s) => JSON.parse(s));

    // Import model once and cache it
    if (!modelCache) {
      modelCache = await import("./model");
    }

    const testStartKeys = ["test", "bin", "bucketSize"];
    const isOnlyTestStart: boolean = results.length === 1
      && Object.keys(results[0]).length === testStartKeys.length
      && testStartKeys.every((key) => key in results[0]);

    let parsedData: ParsedFileEntry[];
    if (results.length === 1 && !isOnlyTestStart) {
      parsedData = modelCache.processJson(results[0]);
    } else {
      parsedData = modelCache.processNewJson(results);
    }

    // Sort once during parsing for better performance
    return comprehensiveSort(parsedData);
  } catch (error) {
    throw new Error(`Failed to parse results: ${error}`);
  }
};

export const formatValue = (value: number, unit: string = ""): string => {
  return `${value.toLocaleString()}${unit}`;
};