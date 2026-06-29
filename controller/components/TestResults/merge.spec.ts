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

import { DataPoint, ParsedFileEntry } from "./model";
import { detectOverlap, mergeResults } from "./merge";

function makeDataPoint (timeSec: number, statusCounts: Record<string, number> = { "200": 1 }): DataPoint {
  return new DataPoint({
    time: timeSec,
    duration: 60,
    endTime: timeSec + 60,
    rttHistogram: "base64",
    startTime: timeSec,
    statusCounts,
    testErrors: {}
  });
}

const GET_ENDPOINT = { method: "GET", url: "http://a.com/" };
const POST_ENDPOINT = { method: "POST", url: "http://a.com/api" };

describe("detectOverlap", () => {
  it("returns true for fewer than 2 files", () => {
    expect(detectOverlap([])).toBe(true);
    expect(detectOverlap([[]])).toBe(true);
  });

  it("returns true when two files share a timestamp", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    expect(detectOverlap([file1, file2])).toBe(true);
  });

  it("returns false when two files share no timestamps", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(2000)]]];
    expect(detectOverlap([file1, file2])).toBe(false);
  });

  it("returns true when at least one later file shares a timestamp with the first", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(2000)]]];
    const file3: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    expect(detectOverlap([file1, file2, file3])).toBe(true);
  });

  it("returns false when later files only share timestamps with each other but not the first", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(2000)]]];
    const file3: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(2000)]]];
    expect(detectOverlap([file1, file2, file3])).toBe(false);
  });
});

describe("mergeResults", () => {
  it("returns empty array for empty input", () => {
    expect(mergeResults([])).toEqual([]);
  });

  it("returns single-file entries with the same bucket identity", () => {
    const dp = makeDataPoint(1000);
    const file: ParsedFileEntry[] = [[GET_ENDPOINT, [dp]]];
    const result = mergeResults([file]);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe(GET_ENDPOINT);
  });

  it("merges DataPoints at the same timestamp from two files, summing statusCounts", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000, { "200": 3 })]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000, { "200": 5 })]]];
    const result = mergeResults([file1, file2]);
    expect(result).toHaveLength(1);
    expect(result[0][1]).toHaveLength(1);
    expect(result[0][1][0].statusCounts).toEqual({ "200": 8 });
  });

  it("keeps DataPoints at different timestamps as separate entries", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(2000)]]];
    const result = mergeResults([file1, file2]);
    expect(result).toHaveLength(1);
    expect(result[0][1]).toHaveLength(2);
  });

  it("keeps distinct endpoint buckets as separate entries", () => {
    const file: ParsedFileEntry[] = [
      [GET_ENDPOINT, [makeDataPoint(1000)]],
      [POST_ENDPOINT, [makeDataPoint(1000)]]
    ];
    const result = mergeResults([file]);
    expect(result).toHaveLength(2);
  });

  it("merges same-endpoint buckets across files even when tag key order differs", () => {
    const ep1 = { method: "GET", type: "tile", url: "http://a.com/" };
    const ep2 = { type: "tile", url: "http://a.com/", method: "GET" };
    const file1: ParsedFileEntry[] = [[ep1, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [[ep2, [makeDataPoint(1000)]]];
    const result = mergeResults([file1, file2]);
    expect(result).toHaveLength(1);
    expect(result[0][1]).toHaveLength(1);
  });

  it("sorts DataPoints by ascending time within each bucket", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(3000)]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const result = mergeResults([file1, file2]);
    const times = result[0][1].map((dp) => dp.time.getTime());
    expect(times[0]).toBeLessThan(times[1]);
  });

  it("includes endpoint buckets that only appear in some files", () => {
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(1000)]]];
    const file2: ParsedFileEntry[] = [
      [GET_ENDPOINT, [makeDataPoint(1000)]],
      [POST_ENDPOINT, [makeDataPoint(1000)]]
    ];
    const result = mergeResults([file1, file2]);
    expect(result).toHaveLength(2);
  });

  it("merges statusCounts correctly across three files at the same timestamp", () => {
    const t = 1000;
    const file1: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(t, { "200": 2 })]]];
    const file2: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(t, { "200": 3 })]]];
    const file3: ParsedFileEntry[] = [[GET_ENDPOINT, [makeDataPoint(t, { "404": 1 })]]];
    const result = mergeResults([file1, file2, file3]);
    expect(result[0][1][0].statusCounts).toEqual({ "200": 5, "404": 1 });
  });
});
