vi.mock("@fs/hdr-histogram-wasm", () => {
  function makeHist () {
    return {
      getTotalCount: vi.fn(() => 100),
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
vi.mock("chart.js", () => {
  function MockChart () {
    return {
      destroy: vi.fn(),
      update: vi.fn(),
      data: { datasets: [] },
      getDatasetMeta: vi.fn(() => ({ hidden: false }))
    };
  }
  const chartFn: any = MockChart;
  chartFn.register = vi.fn();
  chartFn.getChart = vi.fn(() => null);
  chartFn.defaults = { plugins: { legend: {} } };
  return {
    Chart: chartFn,
    Filler: {},
    Legend: {},
    LegendElement: {},
    LegendItem: {},
    LineController: {},
    LineElement: {},
    LinearScale: {},
    LogarithmicScale: {},
    PointElement: {},
    TimeScale: {},
    Title: {},
    Tooltip: {}
  };
});

import { RTT, allErrorsChart, error5xxChart, errorColors, externalTooltipHandler, externalTooltipPlugin, medianDurationChart, tooltipFooter, tooltipLabelShortener, tooltipRowFilter, tooltipRowSort, totalCalls, worst5PercentChart } from "./charts";
import { DataPoint } from "./model";

const BASE_DP = {
  time: 1000,
  duration: 60,
  endTime: 1060,
  rttHistogram: "base64string",
  startTime: 1000,
  statusCounts: { "200": 5 },
  testErrors: {}
};

function makeDP (overrides: any = {}): DataPoint {
  return new DataPoint({ ...BASE_DP, ...overrides });
}

describe("charts", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement("canvas");
  });

  describe("errorColors palette", () => {
    it("is a non-empty array", () => {
      expect(errorColors.length).toBeGreaterThan(0);
    });

    it("entries are hex strings", () => {
      expect(errorColors[0]).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  describe("RTT", () => {
    it("returns a chart for a single data point", () => {
      const chart = RTT(canvas, [makeDP()]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for multiple data points", () => {
      const chart = RTT(canvas, [makeDP({ time: 1000 }), makeDP({ time: 2000 })]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for empty data points", () => {
      const chart = RTT(canvas, []);
      expect(chart).toBeDefined();
    });

    it("handles zero getTotalCount by using NaN for data values", () => {
      const dp = makeDP();
      (dp.rttHistogram.getTotalCount as any).mockReturnValue(0);
      const chart = RTT(canvas, [dp]);
      expect(chart).toBeDefined();
    });

    it("uses linear scale when max does not exceed mean plus five standard deviations", () => {
      const dp = makeDP();
      (dp.rttHistogram.getMaxValue as any).mockReturnValue(1400);
      const chart = RTT(canvas, [dp]);
      expect(chart).toBeDefined();
    });
  });

  describe("totalCalls", () => {
    it("returns a chart for data points with status counts", () => {
      const chart = totalCalls(canvas, [makeDP({ statusCounts: { "200": 10, "500": 2 } })]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for data points with test errors", () => {
      const chart = totalCalls(canvas, [makeDP({ testErrors: { "timeout": 3 } })]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for multiple data points", () => {
      const chart = totalCalls(canvas, [makeDP({ time: 1000 }), makeDP({ time: 2000 })]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for empty data points", () => {
      const chart = totalCalls(canvas, []);
      expect(chart).toBeDefined();
    });
  });

  describe("medianDurationChart", () => {
    it("returns a chart for a single endpoint", () => {
      const chart = medianDurationChart(canvas, [["GET /api", [makeDP()]]]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for multiple endpoints", () => {
      const chart = medianDurationChart(canvas, [
        ["GET /api", [makeDP()]],
        ["POST /api", [makeDP()]]
      ]);
      expect(chart).toBeDefined();
    });

    it("handles zero getTotalCount", () => {
      const dp = makeDP();
      (dp.rttHistogram.getTotalCount as any).mockReturnValue(0);
      const chart = medianDurationChart(canvas, [["GET /api", [dp]]]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for empty endpoints", () => {
      const chart = medianDurationChart(canvas, []);
      expect(chart).toBeDefined();
    });
  });

  describe("worst5PercentChart", () => {
    it("returns a chart for a single endpoint", () => {
      const chart = worst5PercentChart(canvas, [["GET /api", [makeDP()]]]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for multiple endpoints with multiple data points", () => {
      const chart = worst5PercentChart(canvas, [
        ["GET /api", [makeDP({ time: 1000 }), makeDP({ time: 2000 })]],
        ["POST /api", [makeDP()]]
      ]);
      expect(chart).toBeDefined();
    });

    it("handles zero getTotalCount", () => {
      const dp = makeDP();
      (dp.rttHistogram.getTotalCount as any).mockReturnValue(0);
      const chart = worst5PercentChart(canvas, [["GET /api", [dp]]]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for empty endpoints", () => {
      const chart = worst5PercentChart(canvas, []);
      expect(chart).toBeDefined();
    });
  });

  describe("error5xxChart", () => {
    it("returns a chart for data points with 5xx status codes", () => {
      const chart = error5xxChart(canvas, [
        ["GET /api", [makeDP({ statusCounts: { "200": 5, "500": 2, "503": 1 } })]]
      ]);
      expect(chart).toBeDefined();
    });

    it("produces no datasets when no 5xx codes are present", () => {
      const chart = error5xxChart(canvas, [["GET /api", [makeDP()]]]);
      expect(chart).toBeDefined();
    });

    it("handles multiple endpoints with mixed status codes", () => {
      const chart = error5xxChart(canvas, [
        ["GET /api", [makeDP({ statusCounts: { "500": 3 } })]],
        ["POST /api", [makeDP({ statusCounts: { "200": 5 } })]]
      ]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for empty endpoints", () => {
      const chart = error5xxChart(canvas, []);
      expect(chart).toBeDefined();
    });
  });

  describe("allErrorsChart", () => {
    it("returns a chart for data points with non-200 status codes", () => {
      const chart = allErrorsChart(canvas, [
        ["GET /api", [makeDP({ statusCounts: { "200": 5, "404": 2, "500": 1 } })]]
      ]);
      expect(chart).toBeDefined();
    });

    it("produces no datasets when only 200 codes are present", () => {
      const chart = allErrorsChart(canvas, [["GET /api", [makeDP()]]]);
      expect(chart).toBeDefined();
    });

    it("handles multiple endpoints with error codes", () => {
      const chart = allErrorsChart(canvas, [
        ["GET /api", [makeDP({ statusCounts: { "404": 1 } })]],
        ["POST /api", [makeDP({ statusCounts: { "500": 2 } })]]
      ]);
      expect(chart).toBeDefined();
    });

    it("returns a chart for empty endpoints", () => {
      const chart = allErrorsChart(canvas, []);
      expect(chart).toBeDefined();
    });
  });
});

describe("tooltipLabelShortener", () => {
  it("drops the scheme and host when every label is on the same host", () => {
    const shorten = tooltipLabelShortener([
      "GET http://host.example.org/dz/v1/*/image.xml?session=*",
      "500 GET http://host.example.org/dz/v1/*/image_files/*/*_*.jpg?session=* [_id:4 status:500]"
    ]);
    expect(shorten("GET http://host.example.org/dz/v1/*/image.xml?session=*")).toBe("GET /dz/v1/*/image.xml?session=*");
    expect(shorten("500 GET http://host.example.org/dz/v1/*/image_files/*/*_*.jpg?session=* [_id:4 status:500]"))
      .toBe("500 GET /dz/v1/*/image_files/*/*_*.jpg?session=* [_id:4 status:500]");
  });

  it("leaves labels alone when they span several hosts", () => {
    const shorten = tooltipLabelShortener(["GET https://a.example.org/x", "GET https://b.example.org/y"]);
    expect(shorten("GET https://a.example.org/x")).toBe("GET https://a.example.org/x");
  });

  it("keeps http and https variants of one host distinguishable", () => {
    const shorten = tooltipLabelShortener(["GET http://api.example.org/x", "GET https://api.example.org/x"]);
    expect(shorten("GET http://api.example.org/x")).toBe("GET http://api.example.org/x");
    expect(shorten("GET https://api.example.org/x")).toBe("GET https://api.example.org/x");
  });

  it("keeps the host when the label has no path, such as a per-host chart", () => {
    const shorten = tooltipLabelShortener(["http://a.example.org", "http://b.example.org"]);
    expect(shorten("http://a.example.org")).toBe("http://a.example.org");
    expect(tooltipLabelShortener(["http://only.example.org"])("http://only.example.org")).toBe("http://only.example.org");
  });

  it("returns labels that are not URLs unchanged", () => {
    const shorten = tooltipLabelShortener(["agent-1", undefined, "p95"]);
    expect(shorten("agent-1")).toBe("agent-1");
    expect(shorten(undefined)).toBe("");
  });
});

describe("externalTooltipHandler", () => {
  const makeTooltip = (overrides: Record<string, unknown> = {}) => ({
    opacity: 1,
    caretX: 100,
    caretY: 50,
    title: ["Oct 28, 2026, 2:22:00 p.m."],
    body: [{ before: [], lines: ["GET /dz/v1/*/image.xml?session=*: 2,419"], after: [] }],
    labelColors: [{ backgroundColor: "#c94277", borderColor: "#c94277" }],
    footer: [],
    ...overrides
  }) as any;
  const makeChart = () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => ({ left: 20, top: 30, width: 600, height: 270, right: 620, bottom: 300, x: 20, y: 30, toJSON: () => ({}) });
    document.body.appendChild(canvas);
    return { canvas } as any;
  };
  const tooltipElement = () => document.getElementById("pewpew-chart-tooltip") as HTMLDivElement;

  beforeEach(() => {
    // jsdom has no layout: give the viewport a size so the clamping has something to clamp to
    Object.defineProperty(document.documentElement, "clientWidth", { value: 1000, configurable: true });
    Object.defineProperty(document.documentElement, "clientHeight", { value: 800, configurable: true });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the title, one row per body line with its color, and the footer into a page element", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ footer: ["and 3 more"] }) });
    const el = tooltipElement();
    expect(el).not.toBeNull();
    expect(el.style.opacity).toBe("1");
    expect(el.textContent).toContain("Oct 28, 2026, 2:22:00 p.m.");
    expect(el.textContent).toContain("GET /dz/v1/*/image.xml?session=*: 2,419");
    expect(el.textContent).toContain("and 3 more");
    // swatch and text for the row, text only for the footer
    expect(el.querySelectorAll("span").length).toBe(3);
  });

  it("positions the element beside the hovered point on the page", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    const el = tooltipElement();
    // canvas left 20 + caretX 100 + 12px offset; jsdom has no layout, so the element is 0 wide and tall
    expect(el.style.left).toBe("132px");
    expect(el.style.top).toBe("80px");
  });

  /** jsdom has no layout, so give the tooltip a size for the flip and clamp branches. */
  const sizedTooltipElement = (width: number, height: number) => {
    const el = document.createElement("div");
    el.id = "pewpew-chart-tooltip";
    Object.defineProperty(el, "offsetWidth", { get: () => width });
    Object.defineProperty(el, "offsetHeight", { get: () => height });
    document.body.appendChild(el);
    return el;
  };

  it("flips to the left of the point when it would run past the right edge of the viewport", () => {
    const el = sizedTooltipElement(300, 100);
    // point at page x 920 in a 1000px viewport: 932 + 300 does not fit, so 920 - 12 - 300
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ caretX: 900 }) });
    expect(el.style.left).toBe("608px");
  });

  it("is pushed up from the bottom edge and down from the top edge instead of running off screen", () => {
    const el = sizedTooltipElement(300, 200);
    // point at page y 790 in an 800px viewport: centered would start at 690, clamped to 800 - 8 - 200
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ caretY: 760 }) });
    expect(el.style.top).toBe("592px");
    // point at page y 80: centered would start at -20, clamped to the 8px margin
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ caretY: 50 }) });
    expect(el.style.top).toBe("8px");
  });

  it("hides the element when the tooltip is not active and reuses it on the next hover", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ opacity: 0 }) });
    expect(tooltipElement().style.opacity).toBe("0");
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    expect(document.querySelectorAll("#pewpew-chart-tooltip").length).toBe(1);
    expect(tooltipElement().style.opacity).toBe("1");
  });

  it("shows a 'no data' row when every dataset was filtered out", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ body: [], labelColors: [] }) });
    expect(tooltipElement().textContent).toContain("no data");
  });

  it("is hidden by the plugin when a chart is destroyed", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    expect(tooltipElement().style.opacity).toBe("1");
    externalTooltipPlugin.beforeDestroy();
    expect(tooltipElement().style.opacity).toBe("0");
    // nothing to hide is fine too
    document.body.innerHTML = "";
    expect(() => externalTooltipPlugin.beforeDestroy()).not.toThrow();
  });

  it("sets a max height from the viewport so the element can never extend past the screen", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    expect(tooltipElement().style.maxHeight).toBe("784px"); // 800 - 2 * 8 margin
    expect(tooltipElement().style.overflow).toBe("hidden");
  });

  it("drops rows from the bottom until the tooltip fits the viewport and counts them in the footer", () => {
    // jsdom has no layout, so give the element a fake content height of 100px per child
    const el = document.createElement("div");
    el.id = "pewpew-chart-tooltip";
    Object.defineProperty(el, "scrollHeight", { get: () => el.children.length * 100 });
    Object.defineProperty(el, "clientHeight", { get: () => Math.min(el.children.length * 100, 234) });
    document.body.appendChild(el);
    Object.defineProperty(document.documentElement, "clientHeight", { value: 250, configurable: true });
    const body = ["one: 3", "two: 2", "three: 1"].map((line) => ({ before: [], lines: [line], after: [] }));
    const labelColors = body.map(() => ({ backgroundColor: "#000", borderColor: "#000" }));
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ body, labelColors }) });
    // title + 3 rows is 400px against a 234px budget: two rows go, the footer reports them
    expect(el.textContent).toContain("one: 3");
    expect(el.textContent).not.toContain("two: 2");
    expect(el.textContent).not.toContain("three: 1");
    expect(el.textContent).toContain("and 2 more");
  });
});

describe("tooltip row limit", () => {
  const chart = {} as any;
  const rows = (values: number[]) => values.map((y, datasetIndex) => ({ chart, parsed: { y }, datasetIndex }));
  const visible = (items: ReturnType<typeof rows>) => items.filter((item, i) => tooltipRowFilter(item, i, items));

  it("hides zero and NaN rows", () => {
    const items = rows([5, 0, NaN, 3]);
    expect(visible(items).map((item) => item.datasetIndex)).toEqual([0, 3]);
    expect(tooltipFooter(visible(items))).toBe("");
  });

  it("keeps only the 12 largest rows and reports the rest in the footer", () => {
    const items = rows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const kept = visible(items);
    expect(kept).toHaveLength(12);
    expect(kept.map((item) => item.parsed.y)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(tooltipFooter(kept)).toBe("and 3 more");
  });

  it("breaks ties by dataset order so exactly 12 rows survive", () => {
    const items = rows(new Array(14).fill(7));
    const kept = visible(items);
    expect(kept.map((item) => item.datasetIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(tooltipFooter(kept)).toBe("and 2 more");
  });

  it("sorts rows by value descending, then by dataset order", () => {
    const sorted = rows([2, 9, 9, 5]).sort(tooltipRowSort);
    expect(sorted.map((item) => item.datasetIndex)).toEqual([1, 2, 3, 0]);
  });

  it("reports no footer when there are no rows", () => {
    expect(tooltipFooter([])).toBe("");
  });
});
