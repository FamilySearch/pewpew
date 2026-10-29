vi.mock("@fs/hdr-histogram-wasm", () => {
  function makeHist () {
    return {
      clone: vi.fn(makeHist),
      add: vi.fn(),
      free: vi.fn(),
      getTotalCount: vi.fn(() => BigInt(0))
    };
  }
  return { HDRHistogram: vi.fn(makeHist) };
});

import { DataPoint, EMPTY_HISTOGRAM_BASE64, fillMissingBuckets, processJson, processNewJson } from "./model";
import { MAX_FILLED_POINTS } from "./timegrid";
import { fillMissingDataPoints } from "./merge";

const VALID_DP = {
  time: 1000,
  duration: 60,
  endTime: 1060,
  rttHistogram: "base64string",
  startTime: 1000,
  statusCounts: { "200": 5 },
  testErrors: {}
};

const VALID_JSON = {
  buckets: [
    [{ method: "GET", url: "/api/test" }, [VALID_DP]]
  ]
};

describe("DataPoint", () => {
  describe("constructor", () => {
    it("sets time from preProcessed.time multiplied by 1000", () => {
      const dp = new DataPoint(VALID_DP);
      expect(dp.time).toEqual(new Date(1000 * 1000));
    });

    it("sets duration from preProcessed.duration", () => {
      const dp = new DataPoint(VALID_DP);
      expect(dp.duration).toBe(60);
    });

    it("sets endTime as Date when endTime is non-zero", () => {
      const dp = new DataPoint(VALID_DP);
      expect(dp.endTime).toEqual(new Date(1060 * 1000));
    });

    it("sets endTime as undefined when endTime is 0", () => {
      const dp = new DataPoint({ ...VALID_DP, endTime: 0 });
      expect(dp.endTime).toBeUndefined();
    });

    it("sets startTime as Date when startTime is non-zero", () => {
      const dp = new DataPoint(VALID_DP);
      expect(dp.startTime).toEqual(new Date(1000 * 1000));
    });

    it("sets startTime as undefined when startTime is 0", () => {
      const dp = new DataPoint({ ...VALID_DP, startTime: 0 });
      expect(dp.startTime).toBeUndefined();
    });

    it("sets requestTimeouts to 0 when not provided", () => {
      const dp = new DataPoint(VALID_DP);
      expect(dp.requestTimeouts).toBe(0);
    });

    it("sets requestTimeouts from preProcessed when provided", () => {
      const dp = new DataPoint({ ...VALID_DP, requestTimeouts: 3 });
      expect(dp.requestTimeouts).toBe(3);
    });

    it("sets statusCounts from preProcessed", () => {
      const dp = new DataPoint(VALID_DP);
      expect(dp.statusCounts).toEqual({ "200": 5 });
    });

    it("sets testErrors from preProcessed", () => {
      const dp = new DataPoint({ ...VALID_DP, testErrors: { "timeout": 2 } });
      expect(dp.testErrors).toEqual({ "timeout": 2 });
    });
  });

  describe("mergeInto", () => {
    it("sums requestTimeouts from the other DataPoint", () => {
      const dp1 = new DataPoint({ ...VALID_DP, requestTimeouts: 2 });
      const dp2 = new DataPoint({ ...VALID_DP, requestTimeouts: 3 });
      dp1.mergeInto(dp2);
      expect(dp1.requestTimeouts).toBe(5);
    });

    it("merges statusCounts by summing matching keys", () => {
      const dp1 = new DataPoint({ ...VALID_DP, statusCounts: { "200": 10 } });
      const dp2 = new DataPoint({ ...VALID_DP, statusCounts: { "200": 5, "500": 2 } });
      dp1.mergeInto(dp2);
      expect(dp1.statusCounts["200"]).toBe(15);
      expect(dp1.statusCounts["500"]).toBe(2);
    });

    it("merges testErrors by summing matching keys", () => {
      const dp1 = new DataPoint({ ...VALID_DP, testErrors: { "err": 1 } });
      const dp2 = new DataPoint({ ...VALID_DP, testErrors: { "err": 4 } });
      dp1.mergeInto(dp2);
      expect(dp1.testErrors["err"]).toBe(5);
    });
  });
});

describe("processJson", () => {
  it("returns a ParsedFileEntry array for valid input", () => {
    const result = processJson(VALID_JSON);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toEqual({ method: "GET", url: "/api/test" });
    expect(result[0][1]).toHaveLength(1);
    expect(result[0][1][0]).toBeInstanceOf(DataPoint);
  });

  it("returns an empty array for empty buckets", () => {
    expect(processJson({ buckets: [] })).toEqual([]);
  });

  it("processes multiple buckets", () => {
    const json = {
      buckets: [
        [{ method: "GET", url: "/a" }, [VALID_DP]],
        [{ method: "POST", url: "/b" }, [VALID_DP]]
      ]
    };
    expect(processJson(json)).toHaveLength(2);
  });

  it("throws when the input is not an object", () => {
    expect(() => processJson(null)).toThrow();
    expect(() => processJson("string")).toThrow();
  });

  it("throws when buckets property is missing", () => {
    expect(() => processJson({})).toThrow();
  });

  it("throws when a data point has an invalid type for a required field", () => {
    const badJson = {
      buckets: [
        [{ method: "GET", url: "/api" }, [{ ...VALID_DP, time: "not-a-number" }]]
      ]
    };
    expect(() => processJson(badJson)).toThrow();
  });

  it("throws when a bucket id is missing method", () => {
    const badJson = {
      buckets: [
        [{ url: "/api" }, [VALID_DP]]
      ]
    };
    expect(() => processJson(badJson)).toThrow();
  });
});

describe("processNewJson", () => {
  const VALID_NEW_JSON = [
    { test: "mytest.yaml", bin: "pewpew", bucketSize: 60 },
    { index: 0, tags: { _id: "0", method: "GET", url: "/api/test" } },
    { time: 1000, entries: { "0": { statusCounts: { "200": 5 }, testErrors: {} } } }
  ];

  it("returns a ParsedFileEntry array for valid new-format input", () => {
    const result = processNewJson(VALID_NEW_JSON);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toMatchObject({ method: "GET", url: "/api/test" });
  });

  it("returns DataPoint instances in the result", () => {
    const result = processNewJson(VALID_NEW_JSON);
    expect(result[0][1][0]).toBeInstanceOf(DataPoint);
  });

  it("collects data across multiple time buckets for the same endpoint", () => {
    const jsons = [
      { test: "t.yaml", bin: "pewpew", bucketSize: 60 },
      { index: 0, tags: { _id: "0", method: "GET", url: "/api" } },
      { time: 1000, entries: { "0": { statusCounts: { "200": 3 }, testErrors: {} } } },
      { time: 1060, entries: { "0": { statusCounts: { "200": 2 }, testErrors: {} } } }
    ];
    const result = processNewJson(jsons);
    expect(result[0][1]).toHaveLength(2);
  });

  it("throws when an entry fails property checks", () => {
    expect(() => processNewJson([{ invalid: "entry" }])).toThrow();
  });
});

describe("fillMissingBuckets", () => {
  const HEADER = { test: "t.yaml", bin: "pewpew", bucketSize: 60 };
  const TAG_A = { index: 0, tags: { _id: "0", method: "GET", url: "/a" } };
  const TAG_B = { index: 1, tags: { _id: "1", method: "GET", url: "/b", status: "500" } };

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
    const dp = (time: number) => ({ ...VALID_DP, time, startTime: time, endTime: time + 60 });
    const [[, points]] = fillMissingBuckets([[{ method: "GET", url: "/a" }, [dp(1120), dp(1000)]]]);
    expect(points.map((p) => p.time)).toEqual([1000, 1060, 1120]);
    expect(points[1].rttHistogram).toBe(EMPTY_HISTOGRAM_BASE64);
  });

  it("also fills the single-object (old) stats format through processJson", () => {
    const dp = (time: number) => ({ ...VALID_DP, time, startTime: time, endTime: time + 60 });
    const result = processJson({
      buckets: [
        [{ method: "GET", url: "/a" }, [dp(1000), dp(1060), dp(1120)]],
        [{ method: "GET", url: "/b" }, [dp(1060)]]
      ]
    });
    expect(result[1][1].map((p) => p.hasActivity())).toEqual([false, true, false]);
  });
});

describe("fillMissingBuckets duplicates and timeouts", () => {
  const HEADER = { test: "t.yaml", bin: "pewpew", bucketSize: 60 };
  const TAG_A = { index: 0, tags: { _id: "0", method: "GET", url: "/a" } };

  it("keeps every data point that shares a bucket time instead of collapsing them", () => {
    const dp = (time: number, count: number) => ({ ...VALID_DP, time, startTime: time, endTime: time + 60, statusCounts: { "200": count } });
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
  const dp = (timeSec: number, count: number) => new DataPoint({ ...VALID_DP, time: timeSec, startTime: timeSec, endTime: timeSec + 60, statusCounts: { "200": count } });

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
    const dp = (time: number) => new DataPoint({ ...VALID_DP, time, startTime: time, endTime: time + 60 });
    const [[, points]] = fillMissingDataPoints([[{ method: "GET", url: "/a" }, [dp(1000), dp(far)]]]);
    expect(points.map((p) => p.time.getTime())).toEqual([1000000, far * 1000]);
  });

  it("counts the cap across all endpoints", () => {
    // 60 steps of empty buckets for each of 2 endpoints is fine, far below the cap
    const dp = (time: number) => new DataPoint({ ...VALID_DP, time, startTime: time, endTime: time + 60 });
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
