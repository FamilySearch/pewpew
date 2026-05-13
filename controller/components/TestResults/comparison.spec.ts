vi.mock("@fs/hdr-histogram-wasm", () => {
  function makeHist () {
    return {
      getMean: vi.fn(() => 1000),
      getMaxValue: vi.fn(() => 2000),
      getMinNonZeroValue: vi.fn(() => 500),
      getStdDeviation: vi.fn(() => 100),
      getValueAtPercentile: vi.fn(() => 1500),
      add: vi.fn(),
      free: vi.fn(),
      clone: vi.fn(makeHist)
    };
  }
  return { HDRHistogram: vi.fn(makeHist) };
});

import { DataPoint } from "./model";
import { compareResults } from "./comparison";

const BASE_PREPROCESSED = {
  time: 1000,
  duration: 60,
  endTime: 1060,
  rttHistogram: "base64histogram",
  startTime: 1000,
  statusCounts: { "200": 5 },
  testErrors: {}
};

const BUCKET_A = { method: "GET", url: "/api/test" };
const BUCKET_B = { method: "POST", url: "/api/other" };

function makeEntry (bucketId: any, statusCounts = { "200": 5 }) {
  const dp = new DataPoint({ ...BASE_PREPROCESSED, statusCounts });
  return [bucketId, [dp]] as [any, DataPoint[]];
}

describe("compareResults", () => {
  describe("empty inputs", () => {
    it("returns empty arrays when both inputs are empty", () => {
      const result = compareResults([], []);
      expect(result.matchedEndpoints).toHaveLength(0);
      expect(result.baselineOnly).toHaveLength(0);
      expect(result.comparisonOnly).toHaveLength(0);
    });

    it("puts all baseline entries in baselineOnly when comparison is empty", () => {
      const result = compareResults([makeEntry(BUCKET_A)], []);
      expect(result.baselineOnly).toHaveLength(1);
      expect(result.matchedEndpoints).toHaveLength(0);
      expect(result.comparisonOnly).toHaveLength(0);
    });

    it("puts all comparison entries in comparisonOnly when baseline is empty", () => {
      const result = compareResults([], [makeEntry(BUCKET_A)]);
      expect(result.comparisonOnly).toHaveLength(1);
      expect(result.matchedEndpoints).toHaveLength(0);
      expect(result.baselineOnly).toHaveLength(0);
    });
  });

  describe("matched endpoints", () => {
    it("matches entries with the same bucketId", () => {
      const baseline = makeEntry(BUCKET_A);
      const comparison = makeEntry(BUCKET_A);
      const result = compareResults([baseline], [comparison]);
      expect(result.matchedEndpoints).toHaveLength(1);
      expect(result.baselineOnly).toHaveLength(0);
      expect(result.comparisonOnly).toHaveLength(0);
    });

    it("includes the bucketId in the matched endpoint", () => {
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_A)]);
      expect(result.matchedEndpoints[0].bucketId).toEqual(BUCKET_A);
    });

    it("calculates avg stat from mocked histogram getMean", () => {
      // getMean returns 1000, MICROS_TO_MS=1000 → avg = Math.round(1000)/1000 = 1
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_A)]);
      expect(result.matchedEndpoints[0].stats.avg.baseline).toBe(1);
      expect(result.matchedEndpoints[0].stats.avg.comparison).toBe(1);
    });

    it("calculates max stat from mocked histogram getMaxValue", () => {
      // getMaxValue returns 2000 → max = 2000/1000 = 2
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_A)]);
      expect(result.matchedEndpoints[0].stats.max.baseline).toBe(2);
    });

    it("calculates min stat as min(max, minNonZero)", () => {
      // getMaxValue=2000→2, getMinNonZeroValue=500→0.5, min=Math.min(2,0.5)=0.5
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_A)]);
      expect(result.matchedEndpoints[0].stats.min.baseline).toBe(0.5);
    });

    it("calculates percentile stats from mocked getValueAtPercentile", () => {
      // getValueAtPercentile returns 1500 → 1500/1000 = 1.5
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_A)]);
      expect(result.matchedEndpoints[0].stats.p90.baseline).toBe(1.5);
      expect(result.matchedEndpoints[0].stats.p95.baseline).toBe(1.5);
      expect(result.matchedEndpoints[0].stats.p99.baseline).toBe(1.5);
    });

    it("computes diff and percentChange in ComparisonValue", () => {
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_A)]);
      const avg = result.matchedEndpoints[0].stats.avg;
      expect(avg.diff).toBe(0);
      expect(avg.percentChange).toBe(0);
    });

    it("merges status counts from both endpoints", () => {
      const baseline = makeEntry(BUCKET_A, { "200": 10 });
      const comparison = makeEntry(BUCKET_A, { "200": 20, "500": 3 });
      const result = compareResults([baseline], [comparison]);
      const sc = result.matchedEndpoints[0].statusCounts;
      expect(sc["200"].baseline).toBe(10);
      expect(sc["200"].comparison).toBe(20);
      expect(sc["500"].baseline).toBe(0);
      expect(sc["500"].comparison).toBe(3);
    });

    it("handles multiple matched endpoints", () => {
      const result = compareResults(
        [makeEntry(BUCKET_A), makeEntry(BUCKET_B)],
        [makeEntry(BUCKET_A), makeEntry(BUCKET_B)]
      );
      expect(result.matchedEndpoints).toHaveLength(2);
    });
  });

  describe("unmatched endpoints", () => {
    it("puts baseline-only entries in baselineOnly", () => {
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_B)]);
      expect(result.baselineOnly).toHaveLength(1);
      expect(result.baselineOnly[0][0]).toEqual(BUCKET_A);
    });

    it("puts comparison-only entries in comparisonOnly", () => {
      const result = compareResults([makeEntry(BUCKET_A)], [makeEntry(BUCKET_B)]);
      expect(result.comparisonOnly).toHaveLength(1);
      expect(result.comparisonOnly[0][0]).toEqual(BUCKET_B);
    });

    it("correctly separates matched and unmatched when some match", () => {
      const result = compareResults(
        [makeEntry(BUCKET_A), makeEntry(BUCKET_B)],
        [makeEntry(BUCKET_A)]
      );
      expect(result.matchedEndpoints).toHaveLength(1);
      expect(result.baselineOnly).toHaveLength(1);
      expect(result.comparisonOnly).toHaveLength(0);
    });
  });
});
