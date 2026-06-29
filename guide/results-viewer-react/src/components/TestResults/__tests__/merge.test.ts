import "@testing-library/jest-dom";
import { BucketId, DataPoint, ParsedFileEntry } from "../model";
import { mergeResults } from "../merge";

// ============================================================================
// Helpers
// ============================================================================

/** Creates a lightweight DataPoint-shaped object suitable for merge tests. */
function createDataPoint (
  timeMs: number,
  statusCounts: Record<string, number> = {},
  requestTimeouts: number = 0
): DataPoint {
  const histogram = {
    _count: 0,
    add (other: any) { this._count += other._count; },
    clone () { return { ...this }; },
    free () { /* noop: mock frees no WASM memory */ }
  };

  const dp: any = {
    time: new Date(timeMs),
    duration: 60000,
    requestTimeouts,
    rttHistogram: histogram,
    statusCounts: { ...statusCounts },
    testErrors: {},
    mergeInto (other: DataPoint) {
      this.requestTimeouts += other.requestTimeouts;
      this.rttHistogram.add((other as any).rttHistogram);
      for (const key of Object.keys((other as any).statusCounts)) {
        this.statusCounts[key] = (this.statusCounts[key] || 0) + ((other as any).statusCounts[key] || 0);
      }
    },
    clone () {
      return createDataPoint(timeMs, { ...statusCounts }, requestTimeouts);
    }
  };

  return dp as DataPoint;
}

function makeBucket (id: string, method: string, url: string): BucketId {
  return { _id: id, method, url };
}

function makeEntry (bucketId: BucketId, dataPoints: DataPoint[]): ParsedFileEntry {
  return [bucketId, dataPoints];
}

// ============================================================================
// Tests
// ============================================================================

describe("mergeResults", () => {
  describe("edge cases", () => {
    it("returns empty array when given no files", () => {
      expect(mergeResults([])).toEqual([]);
    });

    it("returns empty array when given one empty file", () => {
      expect(mergeResults([[]])).toEqual([]);
    });

    it("returns endpoints unchanged when given a single file", () => {
      const bucket = makeBucket("0", "GET", "http://example.com/");
      const dp = createDataPoint(1000000);
      const result = mergeResults([[makeEntry(bucket, [dp])]]);

      expect(result).toHaveLength(1);
      expect(result[0][0]).toEqual(bucket);
      expect(result[0][1]).toHaveLength(1);
      expect(result[0][1][0].time.getTime()).toBe(1000000);
    });
  });

  describe("same endpoints, same timestamps", () => {
    it("merges status counts from two files at the same timestamp", () => {
      const bucket = makeBucket("0", "GET", "http://example.com/");
      const dp1 = createDataPoint(1000000, { "200": 10 });
      const dp2 = createDataPoint(1000000, { "200": 5, "500": 2 });

      const result = mergeResults([
        [makeEntry(bucket, [dp1])],
        [makeEntry(bucket, [dp2])]
      ]);

      expect(result).toHaveLength(1);
      const mergedDp = result[0][1][0];
      expect(mergedDp.statusCounts["200"]).toBe(15);
      expect(mergedDp.statusCounts["500"]).toBe(2);
    });

    it("merges requestTimeouts from two files at the same timestamp", () => {
      const bucket = makeBucket("0", "POST", "http://example.com/api");
      const dp1 = createDataPoint(2000000, {}, 3);
      const dp2 = createDataPoint(2000000, {}, 7);

      const result = mergeResults([
        [makeEntry(bucket, [dp1])],
        [makeEntry(bucket, [dp2])]
      ]);

      expect(result[0][1][0].requestTimeouts).toBe(10);
    });
  });

  describe("same endpoints, different timestamps", () => {
    it("includes all distinct timestamps from both files", () => {
      const bucket = makeBucket("0", "GET", "http://example.com/");
      const dp1 = createDataPoint(1000000, { "200": 5 });
      const dp2 = createDataPoint(2000000, { "200": 3 });

      const result = mergeResults([
        [makeEntry(bucket, [dp1])],
        [makeEntry(bucket, [dp2])]
      ]);

      expect(result).toHaveLength(1);
      expect(result[0][1]).toHaveLength(2);
    });

    it("sorts DataPoints by time within each bucket", () => {
      const bucket = makeBucket("0", "GET", "http://example.com/");
      const dp1 = createDataPoint(3000000);
      const dp2 = createDataPoint(1000000);
      const dp3 = createDataPoint(2000000);

      const result = mergeResults([[makeEntry(bucket, [dp1, dp2, dp3])]]);
      const times = result[0][1].map((dp) => dp.time.getTime());
      expect(times).toEqual([1000000, 2000000, 3000000]);
    });
  });

  describe("different endpoints", () => {
    it("includes endpoints present only in one file (union)", () => {
      const bucketA = makeBucket("0", "GET", "http://example.com/a");
      const bucketB = makeBucket("1", "POST", "http://example.com/b");
      const dp = createDataPoint(1000000, { "200": 1 });

      const result = mergeResults([
        [makeEntry(bucketA, [dp])],
        [makeEntry(bucketB, [dp])]
      ]);

      expect(result).toHaveLength(2);
    });

    it("matches endpoints by all BucketId properties including tags", () => {
      const bucketWithTag = { _id: "0", method: "GET", url: "http://example.com/", type: "fast" } as BucketId;
      const bucketWithoutTag = makeBucket("0", "GET", "http://example.com/");
      const dp = createDataPoint(1000000);

      const result = mergeResults([
        [makeEntry(bucketWithTag, [dp])],
        [makeEntry(bucketWithoutTag, [dp])]
      ]);

      // Different BucketIds — they must not be merged together
      expect(result).toHaveLength(2);
    });

    it("matches endpoints regardless of BucketId property insertion order", () => {
      const bucket1 = { _id: "0", method: "GET", url: "http://example.com/" } as BucketId;
      const bucket2 = { url: "http://example.com/", _id: "0", method: "GET" } as BucketId;
      const dp1 = createDataPoint(1000000, { "200": 3 });
      const dp2 = createDataPoint(1000000, { "200": 7 });

      const result = mergeResults([
        [makeEntry(bucket1, [dp1])],
        [makeEntry(bucket2, [dp2])]
      ]);

      // Same logical bucket despite different key order — should merge
      expect(result).toHaveLength(1);
      expect(result[0][1][0].statusCounts["200"]).toBe(10);
    });
  });

  describe("multiple files", () => {
    it("merges three files correctly", () => {
      const bucket = makeBucket("0", "GET", "http://example.com/");
      const dp1 = createDataPoint(1000000, { "200": 10 });
      const dp2 = createDataPoint(1000000, { "200": 20 });
      const dp3 = createDataPoint(1000000, { "200": 30 });

      const result = mergeResults([
        [makeEntry(bucket, [dp1])],
        [makeEntry(bucket, [dp2])],
        [makeEntry(bucket, [dp3])]
      ]);

      expect(result).toHaveLength(1);
      expect(result[0][1][0].statusCounts["200"]).toBe(60);
    });

    it("handles mix of shared and unique endpoints across three files", () => {
      const shared = makeBucket("0", "GET", "http://example.com/shared");
      const uniqueToA = makeBucket("1", "POST", "http://example.com/a");
      const uniqueToC = makeBucket("2", "DELETE", "http://example.com/c");
      const dp = createDataPoint(1000000);

      const result = mergeResults([
        [makeEntry(shared, [dp]), makeEntry(uniqueToA, [dp])],
        [makeEntry(shared, [dp])],
        [makeEntry(shared, [dp]), makeEntry(uniqueToC, [dp])]
      ]);

      expect(result).toHaveLength(3);
    });
  });
});
