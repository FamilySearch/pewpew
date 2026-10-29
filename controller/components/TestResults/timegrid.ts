/**
 * Time grid helpers shared by the stats parser and the multi-file merge. This module must stay free
 * of the WASM histogram import: merge.ts is in the controller's server bundle, where the WASM asset
 * is not available, so anything it imports has to be plain TypeScript.
 */

/**
 * Upper bound on the empty data points a fill may add across all endpoints. Each one carries a WASM
 * histogram, and merging two runs recorded days apart would otherwise fill every bucket in between.
 */
export const MAX_FILLED_POINTS = 100_000;

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
