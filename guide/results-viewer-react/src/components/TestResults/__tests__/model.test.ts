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

import { EMPTY_HISTOGRAM_BASE64, fillMissingBuckets, processJson, processNewJson } from "../model";

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
    expect(bPoints[1].startTime).toEqual(new Date(1060000));
    expect(bPoints[1].endTime).toEqual(new Date(1120000));
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
