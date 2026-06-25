import { BucketId, DataPoint, ParsedFileEntry } from "./model";

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

  return Array.from(bucketMap.values()).map(([bucketId, timeMap]) => {
    const dataPoints = Array.from(timeMap.values())
      .sort((a, b) => a.time.getTime() - b.time.getTime());
    return [bucketId, dataPoints] as ParsedFileEntry;
  });
}
