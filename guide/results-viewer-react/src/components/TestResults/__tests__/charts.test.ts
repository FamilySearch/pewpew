import "@testing-library/jest-dom";
import { externalTooltipHandler, tooltipLabelShortener } from "../charts";

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
