import { BucketId, DataPoint, ParsedFileEntry } from "./model";

export interface ComparisonStats {
  avg: ComparisonValue;
  min: ComparisonValue;
  max: ComparisonValue;
  stdDev: ComparisonValue;
  p90: ComparisonValue;
  p95: ComparisonValue;
  p99: ComparisonValue;
}

export interface ComparisonValue {
  baseline: number;
  comparison: number;
  diff: number;
  percentChange: number;
}

export type ComparisonStatusCounts = Record<string, ComparisonValue>;

export interface ComparisonData {
  bucketId: BucketId;
  baselineDataPoints: DataPoint[];
  comparisonDataPoints: DataPoint[];
  stats: ComparisonStats;
  statusCounts: ComparisonStatusCounts;
  otherErrors: {
    baseline: [string, number][];
    comparison: [string, number][];
  };
}

export interface ComparisonResult {
  matchedEndpoints: ComparisonData[];
  baselineOnly: ParsedFileEntry[];
  comparisonOnly: ParsedFileEntry[];
}

const MICROS_TO_MS = 1000;

function createBucketKey (bucketId: BucketId): string {
  // Create a consistent key using all tag properties
  // Sort the properties to ensure consistent ordering
  const sortedEntries = Object.entries(bucketId).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sortedEntries);
}

function calculateTotal (dataPoints: DataPoint[]): {
  stats: [string, number][];
  statusCounts: Record<string, number>;
  otherErrors: [string, number][];
} | null {
  if (dataPoints.length === 0) {
    return null;
  }

  let totalRTT;
  try {
    const first: DataPoint = dataPoints[0];
    totalRTT = first.rttHistogram.clone();
    const statusCounts: Record<string, number> = Object.assign({}, first.statusCounts);
    const otherErrors = Object.assign({}, first.testErrors);
    let requestTimeouts = first.requestTimeouts;

    for (let i = 1; i < dataPoints.length; i++) {
      const dp = dataPoints[i];
      totalRTT.add(dp.rttHistogram);
      for (const [status, count] of Object.entries(dp.statusCounts)) {
        statusCounts[status] = count + (statusCounts[status] || 0);
      }
      for (const [msg, count] of Object.entries(dp.testErrors)) {
        otherErrors[msg] = count + (otherErrors[msg] || 0);
      }
      requestTimeouts += dp.requestTimeouts;
    }

    const otherErrorsArray = Object.entries(otherErrors);
    if (requestTimeouts > 0) {
      otherErrorsArray.push(["Timeout", requestTimeouts]);
    }

    // Calculate stats exactly like the original total function
    const stats: [string, number][] = [
      ["Avg", Math.round(totalRTT.getMean()) / MICROS_TO_MS],
      [
        "Min",
        Math.min(
          Number(totalRTT.getMaxValue()) / MICROS_TO_MS,
          Number(totalRTT.getMinNonZeroValue()) / MICROS_TO_MS
        )
      ],
      ["Max", Number(totalRTT.getMaxValue()) / MICROS_TO_MS],
      ["Std Dev", totalRTT.getStdDeviation() / MICROS_TO_MS],
      ["90th PCTL", Number(totalRTT.getValueAtPercentile(90)) / MICROS_TO_MS],
      ["95th PCTL", Number(totalRTT.getValueAtPercentile(95)) / MICROS_TO_MS],
      ["99th PCTL", Number(totalRTT.getValueAtPercentile(99)) / MICROS_TO_MS]
    ];

    return {
      stats,
      statusCounts,
      otherErrors: otherErrorsArray
    };
  } finally {
    // Free memory exactly like the original
    if (totalRTT) {
      totalRTT.free();
    }
  }
}

function createComparisonValue (baseline: number, comparison: number): ComparisonValue {
  const diff = comparison - baseline;
  const percentChange = baseline !== 0 ? (diff / baseline) * 100 : (comparison !== 0 ? 100 : 0);

  return {
    baseline,
    comparison,
    diff,
    percentChange
  };
}

function compareDataPoints (
  bucketId: BucketId,
  baselineDataPoints: DataPoint[],
  comparisonDataPoints: DataPoint[]
): ComparisonData {
  const baselineTotal = calculateTotal(baselineDataPoints);
  const comparisonTotal = calculateTotal(comparisonDataPoints);

  if (!baselineTotal || !comparisonTotal) {
    throw new Error(`Cannot compare endpoints: missing data for ${createBucketKey(bucketId)}`);
  }

  // Convert stats arrays to objects for easier access
  const statsMap = (statsArray: [string, number][]): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const [label, value] of statsArray) {
      map[label] = value;
    }
    return map;
  };

  const baselineStatsMap = statsMap(baselineTotal.stats);
  const comparisonStatsMap = statsMap(comparisonTotal.stats);

  const stats: ComparisonStats = {
    avg: createComparisonValue(baselineStatsMap["Avg"], comparisonStatsMap["Avg"]),
    min: createComparisonValue(baselineStatsMap["Min"], comparisonStatsMap["Min"]),
    max: createComparisonValue(baselineStatsMap["Max"], comparisonStatsMap["Max"]),
    stdDev: createComparisonValue(baselineStatsMap["Std Dev"], comparisonStatsMap["Std Dev"]),
    p90: createComparisonValue(baselineStatsMap["90th PCTL"], comparisonStatsMap["90th PCTL"]),
    p95: createComparisonValue(baselineStatsMap["95th PCTL"], comparisonStatsMap["95th PCTL"]),
    p99: createComparisonValue(baselineStatsMap["99th PCTL"], comparisonStatsMap["99th PCTL"])
  };

  // Compare status counts
  const statusCounts: ComparisonStatusCounts = {};
  const allStatuses = new Set([
    ...Object.keys(baselineTotal.statusCounts),
    ...Object.keys(comparisonTotal.statusCounts)
  ]);

  for (const status of allStatuses) {
    const baselineCount = baselineTotal.statusCounts[status] || 0;
    const comparisonCount = comparisonTotal.statusCounts[status] || 0;
    statusCounts[status] = createComparisonValue(baselineCount, comparisonCount);
  }

  return {
    bucketId,
    baselineDataPoints,
    comparisonDataPoints,
    stats,
    statusCounts,
    otherErrors: {
      baseline: baselineTotal.otherErrors,
      comparison: comparisonTotal.otherErrors
    }
  };
}

export function compareResults (
  baselineResults: ParsedFileEntry[],
  comparisonResults: ParsedFileEntry[]
): ComparisonResult {
  const matchedEndpoints: ComparisonData[] = [];
  const baselineOnly: ParsedFileEntry[] = [];
  const comparisonOnly: ParsedFileEntry[] = [];

  // Create a more explicit matching approach
  const comparisonLookup = new Map<string, ParsedFileEntry>();
  for (const entry of comparisonResults) {
    const key = createBucketKey(entry[0]);
    comparisonLookup.set(key, entry);
  }

  // Process each baseline entry
  for (const baselineEntry of baselineResults) {
    const key = createBucketKey(baselineEntry[0]);
    const comparisonEntry = comparisonLookup.get(key);

    if (comparisonEntry) {
      // Found a match - create comparison
      const comparison = compareDataPoints(
        baselineEntry[0],
        baselineEntry[1],
        comparisonEntry[1]
      );
      matchedEndpoints.push(comparison);
      comparisonLookup.delete(key); // Remove from lookup
    } else {
      // No match found
      baselineOnly.push(baselineEntry);
    }
  }

  // Any remaining entries in comparison are comparison-only
  for (const entry of comparisonLookup.values()) {
    comparisonOnly.push(entry);
  }

  return {
    matchedEndpoints,
    baselineOnly,
    comparisonOnly
  };
}