import { MAX_FILLED_POINTS, fillOntoGrid, smallestDuration, timeGrid } from "./timegrid";
import { describe, expect, it } from "vitest";

describe("timeGrid", () => {
  it("steps from the first to the last time by the bucket size and keeps the times present", () => {
    expect(timeGrid([1000, 1180], 60, 1)).toEqual([1000, 1060, 1120, 1180]);
    expect(timeGrid([1000, 1007, 1120], 60, 1)).toEqual([1000, 1007, 1060, 1120]);
  });

  it("returns an empty grid for no times and only the times present when the bucket size is 0", () => {
    expect(timeGrid([], 60, 1)).toEqual([]);
    expect(timeGrid([1120, 1000], 0, 1)).toEqual([1000, 1120]);
  });

  it("counts the times the stepping really adds against the cap, not an estimate from the span", () => {
    // [0, 7] with bucket 2: the step adds 2, 4 and 6 (3 times), so 3 x 40,000 exceeds the cap.
    // The old estimate, steps minus times present, gave (4 - 2) x 40,000 and would have filled.
    expect(timeGrid([0, 7], 2, 40_000)).toEqual([0, 7]);
    expect(timeGrid([0, 7], 2, 30_000)).toEqual([0, 2, 4, 6, 7]);
  });

  it("skips the stepping entirely when it would add more than MAX_FILLED_POINTS", () => {
    const far = 60 * (MAX_FILLED_POINTS + 10);
    expect(timeGrid([0, far], 60, 1)).toEqual([0, far]);
  });
});

describe("fillOntoGrid", () => {
  it("inserts an empty value at each grid time a series lacks and keeps duplicates in order", () => {
    const points = [{ t: 2, v: "a" }, { t: 2, v: "b" }, { t: 0, v: "c" }];
    const filled = fillOntoGrid([0, 1, 2], points, (p) => p.t, (t) => ({ t, v: "empty" }));
    expect(filled.map((p) => `${p.t}${p.v}`)).toEqual(["0c", "1empty", "2a", "2b"]);
  });
});

describe("smallestDuration", () => {
  it("ignores non-positive durations and returns 0 when none is positive", () => {
    expect(smallestDuration([60, 0, 15, -1])).toBe(15);
    expect(smallestDuration([0, 0])).toBe(0);
    expect(smallestDuration([])).toBe(0);
  });
});

describe("timeGrid cap early exit", () => {
  it("stops counting as soon as the cap is passed, so a year-wide span at 1s buckets is instant", () => {
    const start = performance.now();
    expect(timeGrid([0, 31_536_000_000], 1000, 1)).toEqual([0, 31_536_000_000]);
    // 31.5M steps without the break; with it about 100k
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
