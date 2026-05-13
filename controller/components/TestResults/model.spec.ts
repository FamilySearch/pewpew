vi.mock("@fs/hdr-histogram-wasm", () => {
  function makeHist () {
    return {
      clone: vi.fn(makeHist),
      add: vi.fn(),
      free: vi.fn()
    };
  }
  return { HDRHistogram: vi.fn(makeHist) };
});

import { DataPoint, processJson, processNewJson } from "./model";

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
