// Type-only on purpose: a value import would pull the model and its WASM histogram into the
// controller's server bundle, where the WASM asset is not available at build time
import type { BucketId, DataPoint, ParsedFileEntry } from "./model";
import { fillOntoGrid, smallestDuration, timeGrid } from "./timegrid";

/**
 * Returns true if any file in the array shares at least one bucket timestamp
 * with the first file. A false result means no two files share any time bucket
 * — they are almost certainly from different test runs rather than concurrent agents.
 */
export function detectOverlap (resultsArray: ParsedFileEntry[][]): boolean {
  if (resultsArray.length < 2) { return true; }

  const firstFileTimes = new Set<number>();
  for (const [, dataPoints] of resultsArray[0]) {
    for (const dp of dataPoints) {
      firstFileTimes.add(dp.time.getTime());
    }
  }

  for (let i = 1; i < resultsArray.length; i++) {
    for (const [, dataPoints] of resultsArray[i]) {
      for (const dp of dataPoints) {
        if (firstFileTimes.has(dp.time.getTime())) { return true; }
      }
    }
  }

  return false;
}

function createBucketKey (bucketId: BucketId): string {
  const sortedEntries = Object.entries(bucketId).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sortedEntries);
}

/**
 * Merges N sets of parsed results into a single unified result set.
 * Used when a test is spread across multiple agents — each agent produces its own
 * results file, and merging combines them as if they ran as one.
 *
 * For each endpoint bucket: DataPoints at the same timestamp are merged (histograms
 * combined, status counts summed). Endpoints present in only some files are included.
 */
export function mergeResults (resultsArray: ParsedFileEntry[][]): ParsedFileEntry[] {
  // Map from bucketKey → [BucketId, Map<timeMs, DataPoint>]
  const bucketMap = new Map<string, [BucketId, Map<number, DataPoint>]>();

  for (const results of resultsArray) {
    for (const [bucketId, dataPoints] of results) {
      const key = createBucketKey(bucketId);

      if (!bucketMap.has(key)) {
        bucketMap.set(key, [bucketId, new Map()]);
      }

      const [, timeMap] = bucketMap.get(key)!;

      for (const dp of dataPoints) {
        const timeMs = dp.time.getTime();
        const existing = timeMap.get(timeMs);
        if (existing) {
          existing.mergeInto(dp);
        } else {
          timeMap.set(timeMs, dp.clone());
        }
      }
    }
  }

  const merged = Array.from(bucketMap.values()).map(([bucketId, timeMap]) => {
    const dataPoints = Array.from(timeMap.values())
      .sort((a, b) => a.time.getTime() - b.time.getTime());
    return [bucketId, dataPoints] as ParsedFileEntry;
  });
  // Each file was filled onto its own grid when parsed; an endpoint that only some files contain
  // still needs the union grid so its series does not stop where those files stop.
  return fillMissingDataPoints(merged);
}

/**
 * Fills every endpoint onto the union time grid of all entries, inserting an empty point where an
 * endpoint has none, so an endpoint that only some merged files contain does not stop where those
 * files stop. DataPoint times are in milliseconds and durations in seconds. Empty points come from
 * DataPoint.emptyAt on an existing point, so this module never imports the WASM histogram and stays
 * out of the controller's server bundle. Returns new arrays; the input points are reused, not cloned.
 */
export function fillMissingDataPoints (entries: ParsedFileEntry[]): ParsedFileEntry[] {
  const all = entries.flatMap(([, dataPoints]) => dataPoints);
  if (all.length === 0) {
    return entries;
  }
  const sample = all[0];
  const duration = smallestDuration(all.map((dp) => dp.duration));
  const grid = timeGrid(all.map((dp) => dp.time.getTime()), duration * 1000, entries.length);
  return entries.map(([bucketId, dataPoints]) => [
    bucketId,
    fillOntoGrid(grid, dataPoints, (dp) => dp.time.getTime(), (timeMs) => sample.emptyAt(timeMs / 1000, duration))
  ]);
}
