import "@testing-library/jest-dom";
import { externalTooltipHandler, externalTooltipPlugin, tooltipFooter, tooltipLabelShortener, tooltipRowFilter, tooltipRowSort } from "../charts";

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
