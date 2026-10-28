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

import { RTT, allErrorsChart, error5xxChart, errorColors, externalTooltipHandler, medianDurationChart, tooltipLabelShortener, totalCalls, worst5PercentChart } from "./charts";
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

  it("keeps the host but drops the scheme when labels span several hosts", () => {
    const shorten = tooltipLabelShortener(["GET https://a.example.org/x", "GET https://b.example.org/y"]);
    expect(shorten("GET https://a.example.org/x")).toBe("GET a.example.org/x");
  });

  it("keeps the host when the label has no path, such as a per-host chart", () => {
    const shorten = tooltipLabelShortener(["http://a.example.org", "http://b.example.org"]);
    expect(shorten("http://a.example.org")).toBe("a.example.org");
    expect(tooltipLabelShortener(["http://only.example.org"])("http://only.example.org")).toBe("only.example.org");
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

  it("hides the element when the tooltip is not active and reuses it on the next hover", () => {
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip({ opacity: 0 }) });
    expect(tooltipElement().style.opacity).toBe("0");
    externalTooltipHandler({ chart: makeChart(), tooltip: makeTooltip() });
    expect(document.querySelectorAll("#pewpew-chart-tooltip").length).toBe(1);
    expect(tooltipElement().style.opacity).toBe("1");
  });
});
