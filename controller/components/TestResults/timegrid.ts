/**
 * Time grid helpers shared by the stats parser and the multi-file merge. This module must stay free
 * of the WASM histogram import: merge.ts is in the controller's server bundle, where the WASM asset
 * is not available, so anything it imports has to be plain TypeScript.
 */

/**
 * Upper bound on the empty data points a fill may add across all endpoints. Each one carries a WASM
 * histogram of about 16KB, so the cap is sized in memory: 20,000 is about 320MB at worst. A fill
 * that would pass it is skipped and the charts fall back to joining each endpoint's own points.
 */
export const MAX_FILLED_POINTS = 20_000;

/** Smallest positive bucket duration among the data points, or 0 when none has one. */
export function smallestDuration (durations: Iterable<number>): number {
  let smallest = Infinity;
  for (const duration of durations) {
    if (duration > 0) {
      smallest = Math.min(smallest, duration);
    }
  }
  return Number.isFinite(smallest) ? smallest : 0;
}

/**
 * The bucket times every endpoint should cover: from the earliest to the latest time seen, stepping
 * by the bucket size, plus any time that is actually present. Sorted ascending. The stepping is
 * skipped when it would add more than MAX_FILLED_POINTS across the endpoints; the times actually
 * present are always included.
 */
export function timeGrid (times: Iterable<number>, bucketSize: number, endpointCount: number): number[] {
  const allTimes = new Set<number>();
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const time of times) {
    allTimes.add(time);
    minTime = Math.min(minTime, time);
    maxTime = Math.max(maxTime, time);
  }
  // A non-finite time or bucket size (a malformed file) skips the stepping: the loops below would
  // never end, since -Infinity or a value beyond float precision does not change when stepped.
  if (allTimes.size > 0 && bucketSize > 0 && Number.isFinite(bucketSize) && Number.isFinite(minTime) && Number.isFinite(maxTime)) {
    // Step by index so both loops always end, even when adding bucketSize would not change the time
    const steps = Math.floor((maxTime - minTime) / bucketSize);
    // Count the times the stepping would really add: existing times need not lie on the grid.
    // Stop as soon as the cap is passed; the exact count beyond it does not matter.
    let added = 0;
    for (let i = 0; i <= steps && added * endpointCount <= MAX_FILLED_POINTS; i++) {
      if (!allTimes.has(minTime + i * bucketSize)) {
        added++;
      }
    }
    if (added * endpointCount <= MAX_FILLED_POINTS) {
      for (let i = 0; i <= steps; i++) {
        allTimes.add(minTime + i * bucketSize);
      }
    }
  }
  return [...allTimes].sort((a, b) => a - b);
}

/**
 * Lays one endpoint's points onto the grid, inserting an empty point at each time the endpoint has
 * none. Points that share a time are all kept, in their original order. O(points + grid).
 */
export function fillOntoGrid<T> (grid: number[], points: T[], getTime: (point: T) => number, makeEmpty: (time: number) => T): T[] {
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
