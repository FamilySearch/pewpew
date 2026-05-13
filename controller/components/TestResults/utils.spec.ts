vi.mock("./model", () => ({
  processJson: vi.fn(() => []),
  processNewJson: vi.fn(() => [])
}));

import { comprehensiveSort, dateToString, formatValue, minMaxTime, parseResultsData } from "./utils";
import { processJson, processNewJson } from "./model";

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dateToString", () => {
    const date = new Date(2024, 0, 15, 12, 30, 0);

    it("returns time-only string when timeOnly is true", () => {
      expect(dateToString(date, true)).toBe("12:30:00");
    });

    it("includes date suffix when timeOnly is false", () => {
      expect(dateToString(date, false)).toBe("12:30:00 15-Jan-2024");
    });

    it("does not include month name when timeOnly is true", () => {
      expect(dateToString(date, true)).not.toContain("Jan");
    });

    it("includes the year when timeOnly is false", () => {
      expect(dateToString(date, false)).toContain("2024");
    });

    it("includes the day-of-month when timeOnly is false", () => {
      expect(dateToString(date, false)).toContain("15");
    });
  });

  describe("formatValue", () => {
    it("appends the unit to the stringified value", () => {
      expect(formatValue(100, "ms")).toBe("100ms");
    });

    it("uses empty string as default unit", () => {
      expect(formatValue(42)).toBe("42");
    });

    it("works with zero value", () => {
      expect(formatValue(0, "%")).toBe("0%");
    });

    it("works with an explicit empty unit", () => {
      expect(formatValue(5, "")).toBe("5");
    });
  });

  describe("comprehensiveSort", () => {
    it("sorts entries numerically by _id", () => {
      const entries: any[] = [
        [{ _id: "10", method: "GET", url: "/b" }, []],
        [{ _id: "2", method: "GET", url: "/a" }, []],
        [{ _id: "1", method: "GET", url: "/c" }, []]
      ];
      const sorted = comprehensiveSort(entries);
      expect(sorted[0][0]._id).toBe("1");
      expect(sorted[1][0]._id).toBe("2");
      expect(sorted[2][0]._id).toBe("10");
    });

    it("uses JSON.stringify as tiebreak for equal _id values", () => {
      const entries: any[] = [
        [{ _id: "1", method: "POST", url: "/a" }, []],
        [{ _id: "1", method: "GET", url: "/a" }, []]
      ];
      const sorted = comprehensiveSort(entries);
      // {"_id":"1","method":"GET"...} < {"_id":"1","method":"POST"...}
      expect(sorted[0][0].method).toBe("GET");
      expect(sorted[1][0].method).toBe("POST");
    });

    it("returns an empty array unchanged", () => {
      expect(comprehensiveSort([])).toEqual([]);
    });

    it("returns a single-entry array unchanged", () => {
      const entries: any[] = [[{ _id: "1", method: "GET", url: "/test" }, []]];
      const result = comprehensiveSort(entries);
      expect(result).toHaveLength(1);
      expect(result[0][0]._id).toBe("1");
    });
  });

  describe("minMaxTime", () => {
    const makePoint = (startMs?: number, endMs?: number) => ({
      startTime: startMs !== undefined ? new Date(startMs) : undefined,
      endTime: endMs !== undefined ? new Date(endMs) : undefined
    });

    const BASE_MS = new Date(2024, 0, 15, 10, 0, 0).getTime();

    it("calculates a 1-hour delta", () => {
      const map = new Map([["b", [makePoint(BASE_MS, BASE_MS + 3600000)]]]);
      expect(minMaxTime(map).deltaTime).toBe("1 hour");
    });

    it("calculates a 2-hours delta", () => {
      const map = new Map([["b", [makePoint(BASE_MS, BASE_MS + 7200000)]]]);
      expect(minMaxTime(map).deltaTime).toBe("2 hours");
    });

    it("calculates a multi-part 1-minute-30-seconds delta", () => {
      const map = new Map([["b", [makePoint(BASE_MS, BASE_MS + 90000)]]]);
      expect(minMaxTime(map).deltaTime).toBe("1 minute, 30 seconds");
    });

    it("calculates a 1-day-1-hour delta", () => {
      const map = new Map([["b", [makePoint(BASE_MS, BASE_MS + 86400000 + 3600000)]]]);
      expect(minMaxTime(map).deltaTime).toBe("1 day, 1 hour");
    });

    it("uses time-only for startTime when start and end share the same date", () => {
      const map = new Map([["b", [makePoint(BASE_MS, BASE_MS + 3600000)]]]);
      const result = minMaxTime(map);
      expect(result.startTime).not.toContain("Jan");
      expect(result.endTime).toContain("Jan");
    });

    it("includes date in startTime when start and end are on different days", () => {
      const lateNight = new Date(2024, 0, 15, 23, 30, 0).getTime();
      const nextDay = lateNight + 7200000;
      const map = new Map([["b", [makePoint(lateNight, nextDay)]]]);
      const result = minMaxTime(map);
      expect(result.startTime).toContain("Jan");
      expect(result.endTime).toContain("Jan");
    });

    it("picks the minimum startTime across multiple buckets", () => {
      const early = BASE_MS;
      const late = BASE_MS + 30000;
      const map = new Map([
        ["b1", [makePoint(late, BASE_MS + 60000)]],
        ["b2", [makePoint(early, BASE_MS + 60000)]]
      ]);
      const r1 = minMaxTime(new Map([["b", [makePoint(early, BASE_MS + 60000)]]]));
      const r2 = minMaxTime(map);
      expect(r2.startTime).toBe(r1.startTime);
    });

    it("picks the maximum endTime across multiple buckets", () => {
      const map = new Map([
        ["b1", [makePoint(BASE_MS, BASE_MS + 60000)]],
        ["b2", [makePoint(BASE_MS, BASE_MS + 120000)]]
      ]);
      const single = minMaxTime(new Map([["b", [makePoint(BASE_MS, BASE_MS + 120000)]]]));
      const multi = minMaxTime(map);
      expect(multi.endTime).toBe(single.endTime);
    });
  });

  describe("parseResultsData", () => {
    it("calls processJson for a single non-test-start object", async () => {
      await parseResultsData(JSON.stringify({ buckets: [] }));
      expect(vi.mocked(processJson)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(processNewJson)).not.toHaveBeenCalled();
    });

    it("calls processNewJson for multiple JSON objects concatenated", async () => {
      const obj1 = JSON.stringify({ test: "a.yaml", bin: "pewpew", bucketSize: 60 });
      const obj2 = JSON.stringify({ index: 0, tags: { _id: "0", method: "GET", url: "/api" } });
      await parseResultsData(`${obj1}${obj2}`);
      expect(vi.mocked(processNewJson)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(processJson)).not.toHaveBeenCalled();
    });

    it("calls processNewJson when the single object is a test-start header", async () => {
      await parseResultsData(JSON.stringify({ test: "mytest.yaml", bin: "pewpew", bucketSize: 60 }));
      expect(vi.mocked(processNewJson)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(processJson)).not.toHaveBeenCalled();
    });

    it("throws a wrapped Error when the text is not valid JSON", async () => {
      await expect(parseResultsData("not valid json")).rejects.toThrow("Failed to parse results");
    });

    it("returns the sorted processJson result", async () => {
      const fakeEntry: any = [{ _id: "1", method: "GET", url: "/test" }, []];
      vi.mocked(processJson).mockReturnValueOnce([fakeEntry]);
      const result = await parseResultsData(JSON.stringify({ buckets: [] }));
      expect(result).toHaveLength(1);
    });

    it("returns an empty array when processJson returns no entries", async () => {
      const result = await parseResultsData(JSON.stringify({ buckets: [] }));
      expect(result).toEqual([]);
    });
  });
});
