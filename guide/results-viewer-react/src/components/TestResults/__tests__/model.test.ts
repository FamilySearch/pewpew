import "@testing-library/jest-dom";

// The WASM histogram is not loadable under jest; only the total count matters for these tests.
jest.mock("@fs/hdr-histogram-wasm", () => {
  class HDRHistogram {
    getTotalCount () { return BigInt(0); }
    add () { /* noop */ }
    clone () { return new HDRHistogram(); }
    free () { /* noop */ }
  }
  return { HDRHistogram };
});

import { DataPoint, EMPTY_HISTOGRAM_BASE64, ParsedFileEntry, fillMissingBuckets, processJson, processNewJson } from "../model";
import { MAX_FILLED_POINTS } from "../timegrid";
import { fillMissingDataPoints } from "../merge";

const HEADER = { test: "t.yaml", bin: "pewpew", bucketSize: 60 };
const TAG_A = { index: 0, tags: { _id: "0", method: "GET", url: "/a" } };
const TAG_B = { index: 1, tags: { _id: "1", method: "GET", url: "/b", status: "500" } };

const preProcessed = (time: number, statusCounts: Record<string, number> = { "200": 1 }) => ({
  time,
  duration: 60,
  endTime: time + 60,
  rttHistogram: "base64string",
  startTime: time,
  statusCounts,
  testErrors: {}
});

describe("fillMissingBuckets", () => {
  it("returns the input untouched when there are no data points", () => {
    expect(fillMissingBuckets([])).toEqual([]);
    const empty = [[{ method: "GET", url: "/a" }, []]] as any;
    expect(fillMissingBuckets(empty)).toEqual(empty);
  });

  it("adds an empty data point for a bucket an endpoint is missing in the middle of the test", () => {
    const result = processNewJson([
      HEADER, TAG_A, TAG_B,
      { time: 1000, entries: { "0": { statusCounts: { "200": 3 } }, "1": { statusCounts: { "500": 1 } } } },
      { time: 1060, entries: { "0": { statusCounts: { "200": 3 } } } },
      { time: 1120, entries: { "0": { statusCounts: { "200": 3 } }, "1": { statusCounts: { "500": 4 } } } }
    ]);
    const [, bPoints] = result[1];
    expect(bPoints.map((dp) => dp.time.getTime())).toEqual([1000000, 1060000, 1120000]);
    expect(bPoints.map((dp) => dp.statusCounts)).toEqual([{ "500": 1 }, {}, { "500": 4 }]);
    expect(bPoints[1].duration).toBe(60);
    // No request was observed in a filled bucket, so it carries no start or end for minMaxTime
    expect(bPoints[1].startTime).toBeUndefined();
    expect(bPoints[1].endTime).toBeUndefined();
    expect(bPoints[1].hasActivity()).toBe(false);
    expect(bPoints[2].hasActivity()).toBe(true);
  });

  it("pads an endpoint that only appears late in the test back to the first bucket", () => {
    const result = processNewJson([
      HEADER, TAG_A, TAG_B,
      { time: 1000, entries: { "0": { statusCounts: { "200": 3 } } } },
      { time: 1060, entries: { "0": { statusCounts: { "200": 3 } } } },
      { time: 1120, entries: { "0": { statusCounts: { "200": 3 } }, "1": { statusCounts: { "500": 4 } } } }
    ]);
    const [, bPoints] = result[1];
    expect(bPoints).toHaveLength(3);
    expect(bPoints.map((dp) => dp.hasActivity())).toEqual([false, false, true]);
  });

  it("fills a bucket no endpoint has when the whole test went quiet for a bucket", () => {
    const result = processNewJson([
      HEADER, TAG_A,
      { time: 1000, entries: { "0": { statusCounts: { "200": 3 } } } },
      { time: 1120, entries: { "0": { statusCounts: { "200": 3 } } } }
    ]);
    const [, aPoints] = result[0];
    expect(aPoints.map((dp) => dp.time.getTime())).toEqual([1000000, 1060000, 1120000]);
    expect(aPoints[1].hasActivity()).toBe(false);
  });

  it("sorts each endpoint's data points by time", () => {
    const [[, points]] = fillMissingBuckets([[{ method: "GET", url: "/a" }, [preProcessed(1120), preProcessed(1000)]]]);
    expect(points.map((p) => p.time)).toEqual([1000, 1060, 1120]);
    expect(points[1].rttHistogram).toBe(EMPTY_HISTOGRAM_BASE64);
  });

  it("also fills the single-object (old) stats format through processJson", () => {
    const result = processJson({
      buckets: [
        [{ method: "GET", url: "/a" }, [preProcessed(1000), preProcessed(1060), preProcessed(1120)]],
        [{ method: "GET", url: "/b" }, [preProcessed(1060)]]
      ]
    });
    expect(result[1][1].map((p) => p.hasActivity())).toEqual([false, true, false]);
  });
});

const BASE_DP = preProcessed(0);

describe("fillMissingBuckets duplicates and timeouts", () => {
  it("keeps every data point that shares a bucket time instead of collapsing them", () => {
    const dp = (time: number, count: number) => ({ ...BASE_DP, time, startTime: time, endTime: time + 60, statusCounts: { "200": count } });
    const [[, points]] = fillMissingBuckets([[{ method: "GET", url: "/a" }, [dp(1000, 1), dp(1000, 2), dp(1120, 3)]]]);
    expect(points.map((p) => [p.time, p.statusCounts["200"] || 0])).toEqual([[1000, 1], [1000, 2], [1060, 0], [1120, 3]]);
  });

  it("copies requestTimeouts from the new format so a bucket with only timeouts counts as activity", () => {
    const result = processNewJson([
      HEADER, TAG_A,
      { time: 1000, entries: { "0": { statusCounts: { "200": 3 } } } },
      { time: 1060, entries: { "0": { requestTimeouts: 5 } } }
    ]);
    const [, points] = result[0];
    expect(points[1].requestTimeouts).toBe(5);
    expect(points[1].hasActivity()).toBe(true);
  });
});

describe("fillMissingDataPoints", () => {
  const dp = (timeSec: number, count: number) => new DataPoint({ ...BASE_DP, time: timeSec, startTime: timeSec, endTime: timeSec + 60, statusCounts: { "200": count } });

  it("returns the input untouched when there are no data points", () => {
    expect(fillMissingDataPoints([])).toEqual([]);
    const empty = [[{ method: "GET", url: "/a" }, []]] as any;
    expect(fillMissingDataPoints(empty)).toEqual(empty);
  });

  it("pads an endpoint onto the union grid of all endpoints", () => {
    // /a spans 1000-1120, /b only has 1060: /b gets empty points at 1000 and 1120
    const [, aPoints] = fillMissingDataPoints([
      [{ method: "GET", url: "/a" }, [dp(1000, 1), dp(1060, 1), dp(1120, 1)]],
      [{ method: "GET", url: "/b" }, [dp(1060, 2)]]
    ])[0];
    const [, bPoints] = fillMissingDataPoints([
      [{ method: "GET", url: "/a" }, [dp(1000, 1), dp(1060, 1), dp(1120, 1)]],
      [{ method: "GET", url: "/b" }, [dp(1060, 2)]]
    ])[1];
    expect(aPoints).toHaveLength(3);
    expect(bPoints.map((p) => p.time.getTime())).toEqual([1000000, 1060000, 1120000]);
    expect(bPoints.map((p) => p.hasActivity())).toEqual([false, true, false]);
    expect(bPoints[0]).toBeInstanceOf(DataPoint);
    expect(bPoints[0].duration).toBe(60);
    expect(bPoints[0].startTime).toBeUndefined();
  });

  it("steps by the bucket duration across a gap no endpoint has", () => {
    const [[, points]] = fillMissingDataPoints([[{ method: "GET", url: "/a" }, [dp(1000, 1), dp(1180, 1)]]]);
    expect(points.map((p) => p.time.getTime())).toEqual([1000000, 1060000, 1120000, 1180000]);
  });

  it("reuses the existing data points rather than cloning them", () => {
    const original = dp(1000, 1);
    const [[, points]] = fillMissingDataPoints([[{ method: "GET", url: "/a" }, [original]]]);
    expect(points[0]).toBe(original);
  });
});

describe("fill cap", () => {
  it("keeps the actual times but skips the stepping when it would add more than MAX_FILLED_POINTS", () => {
    const far = 1000 + 60 * (MAX_FILLED_POINTS + 10);
    const dp = (time: number) => new DataPoint({ ...BASE_DP, time, startTime: time, endTime: time + 60 });
    const [[, points]] = fillMissingDataPoints([[{ method: "GET", url: "/a" }, [dp(1000), dp(far)]]]);
    expect(points.map((p) => p.time.getTime())).toEqual([1000000, far * 1000]);
  });

  it("counts the cap across all endpoints", () => {
    // 60 steps of empty buckets for each of 2 endpoints is fine, far below the cap
    const dp = (time: number) => new DataPoint({ ...BASE_DP, time, startTime: time, endTime: time + 60 });
    const result = fillMissingDataPoints([
      [{ method: "GET", url: "/a" }, [dp(1000)]],
      [{ method: "GET", url: "/b" }, [dp(1000 + 60 * 60)]]
    ]);
    expect(result[0][1]).toHaveLength(61);
    expect(result[1][1]).toHaveLength(61);
  });
});

describe("quiet buckets written with no entries", () => {
  it("keeps a trailing run of empty bucket records in the grid", () => {
    const result = processNewJson([
      { test: "t.yaml", bin: "pewpew", bucketSize: 60 },
      { index: 0, tags: { _id: "0", method: "GET", url: "/a" } },
      { time: 1000, entries: { "0": { statusCounts: { "200": 1 } } } },
      { time: 1060, entries: {} },
      { time: 1120, entries: {} }
    ]);
    const [, points] = result[0];
    expect(points.map((p) => p.time.getTime())).toEqual([1000000, 1060000, 1120000]);
    expect(points.map((p) => p.hasActivity())).toEqual([true, false, false]);
  });

  it("keeps a leading empty bucket record so the first chart point is zero", () => {
    const result = processNewJson([
      { test: "t.yaml", bin: "pewpew", bucketSize: 60 },
      { index: 0, tags: { _id: "0", method: "GET", url: "/a" } },
      { time: 1000, entries: {} },
      { time: 1060, entries: { "0": { statusCounts: { "200": 1 } } } }
    ]);
    expect(result[0][1].map((p) => p.hasActivity())).toEqual([false, true]);
  });
});

describe("fillMissingDataPoints cap on the union grid", () => {
  // The fill only reads time, duration and emptyAt, and building 110k real DataPoints (each with a
  // mocked histogram) takes longer than the test timeout on CI, so use plain stand-ins here.
  const dp = (timeSec: number): DataPoint => ({
    time: new Date(timeSec * 1000),
    duration: 60,
    emptyAt: () => { throw new Error("the cap should have prevented any fill"); }
  }) as unknown as DataPoint;

  it("leaves the entries unfilled when laying them onto each other's real times would exceed the cap", () => {
    // Endpoint A has contiguous buckets, so stepping adds nothing, but B would need a copy of every one
    const count = MAX_FILLED_POINTS + 10_000;
    const aPoints = Array.from({ length: count }, (_, i) => dp(1000 + i * 60));
    const entries: ParsedFileEntry[] = [
      [{ method: "GET", url: "/a" }, aPoints],
      [{ method: "GET", url: "/b" }, [dp(1000)]]
    ];
    const result = fillMissingDataPoints(entries);
    expect(result).toBe(entries);
    expect(result[1][1]).toHaveLength(1);
  });
});
