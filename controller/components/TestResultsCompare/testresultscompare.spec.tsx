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

import { BucketId, DataPoint, ParsedFileEntry } from "../TestResults/model";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { TestResultsCompare } from ".";

const makeBucketId = (method: string, url: string): BucketId => ({ method, url });

const makeDataPoint = (): DataPoint => new DataPoint({
  time: 1000,
  duration: 60,
  endTime: 1060,
  rttHistogram: "encoded",
  startTime: 1000,
  statusCounts: { "200": 5 },
  testErrors: {}
});

const makeTestData = (): ParsedFileEntry[] => [
  [makeBucketId("GET", "http://example.com/api"), [makeDataPoint()]]
];

describe("TestResultsCompare", () => {
  describe("Empty State", () => {
    it("should show placeholder message when no data is provided", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.getByText("Select two results files to compare")).toBeInTheDocument();
    });

    it("should not render charts when no data is provided", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.queryByText("Performance & Error Metrics Comparison")).not.toBeInTheDocument();
    });

    it("should not show merge toggle when no data is loaded", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.queryByLabelText("Merge endpoints with different tags")).not.toBeInTheDocument();
    });

    it("should accept default label props with empty data", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.getByText("Select two results files to compare")).toBeInTheDocument();
    });

    it("should accept custom labels with empty data", () => {
      render(
        <TestResultsCompare
          baselineData={[]}
          comparisonData={[]}
          baselineLabel="Production"
          comparisonLabel="Staging"
        />
      );
      expect(screen.getByText("Select two results files to compare")).toBeInTheDocument();
    });
  });

  describe("With data", () => {
    let baselineData: ParsedFileEntry[];
    let comparisonData: ParsedFileEntry[];

    beforeEach(() => {
      baselineData = makeTestData();
      comparisonData = makeTestData();
    });

    it("shows Performance Comparison heading", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByRole("heading", { name: "Performance Comparison" })).toBeInTheDocument();
    });

    it("shows Performance and Error Metrics Comparison sub-heading", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByText("Performance & Error Metrics Comparison")).toBeInTheDocument();
    });

    it("shows method filter dropdown with all methods option", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByLabelText("Filter by Method:")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "All Methods" })).toBeInTheDocument();
    });

    it("shows available methods in filter dropdown", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByRole("option", { name: "GET" })).toBeInTheDocument();
    });

    it("shows merge endpoints toggle", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByLabelText("Merge endpoints with different tags")).toBeInTheDocument();
    });

    it("merge endpoints toggle starts unchecked", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      const checkbox = screen.getByLabelText("Merge endpoints with different tags") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it("toggles merge endpoints when checkbox is clicked", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      const checkbox = screen.getByLabelText("Merge endpoints with different tags") as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
    });

    it("shows tab navigation buttons", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByText("Endpoint Comparison")).toBeInTheDocument();
      expect(screen.getByText("Final Results Comparison")).toBeInTheDocument();
    });

    it("shows endpoint comparison content by default", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByText(/Per-endpoint metrics comparison/)).toBeInTheDocument();
    });

    it("filters by method when method filter changes", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      const select = screen.getByLabelText("Filter by Method:") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "GET" } });
      expect(select.value).toBe("GET");
      expect(screen.getByText("Performance Comparison")).toBeInTheDocument();
    });

    it("switches to final results tab on click", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      fireEvent.click(screen.getByText("Final Results Comparison"));
      expect(screen.getByRole("heading", { name: "Baseline" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Comparison" })).toBeInTheDocument();
    });

    it("shows FinalResultsTable column headers when on final tab", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      fireEvent.click(screen.getByText("Final Results Comparison"));
      expect(screen.getAllByText("method").length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("p50").length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("p95").length).toBeGreaterThanOrEqual(2);
    });

    it("shows FinalResultsTable row data when on final tab", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      fireEvent.click(screen.getByText("Final Results Comparison"));
      expect(screen.getAllByText("GET").length).toBeGreaterThanOrEqual(1);
    });

    it("shows endpoint comparison table headers", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getAllByText("Metric").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Change").length).toBeGreaterThanOrEqual(1);
    });

    it("shows custom labels in final results tab", () => {
      render(
        <TestResultsCompare
          baselineData={baselineData}
          comparisonData={comparisonData}
          baselineLabel="Production v1"
          comparisonLabel="Staging v2"
        />
      );
      fireEvent.click(screen.getByText("Final Results Comparison"));
      expect(screen.getByRole("heading", { name: "Production v1" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Staging v2" })).toBeInTheDocument();
    });

    it("shows multiple methods from both datasets in filter", () => {
      const multiMethodData: ParsedFileEntry[] = [
        [makeBucketId("GET", "http://example.com/api"), [makeDataPoint()]],
        [makeBucketId("POST", "http://example.com/data"), [makeDataPoint()]]
      ];
      render(<TestResultsCompare baselineData={multiMethodData} comparisonData={multiMethodData} />);
      expect(screen.getByRole("option", { name: "GET" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "POST" })).toBeInTheDocument();
    });

    it("FinalResultsTable shows 7 of 14 columns selected by default", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      fireEvent.click(screen.getByText("Final Results Comparison"));
      expect(screen.getAllByText("7 of 14 columns selected").length).toBeGreaterThanOrEqual(2);
    });

    it("toggling a column in one FinalResultsTable syncs the count in both", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      fireEvent.click(screen.getByText("Final Results Comparison"));
      // Open the first table's column dropdown so its checkboxes become accessible
      const [firstColumnBtn] = screen.getAllByRole("button", { name: /of 14 columns selected/ });
      fireEvent.click(firstColumnBtn);
      // Scope to the open dropdown container and click the first (Method) checkbox
      const columnContainer = firstColumnBtn.closest(".column-select-container");
      const [methodCheckbox] = within(columnContainer!).getAllByRole("checkbox");
      fireEvent.click(methodCheckbox);
      // Both tables share the same column visibility state
      expect(screen.getAllByText("6 of 14 columns selected").length).toBeGreaterThanOrEqual(2);
    });

    it("metrics dropdown shows 5 of 9 metrics selected by default", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      expect(screen.getByText("5 of 9 metrics selected")).toBeInTheDocument();
    });

    it("toggling a metric off decrements the visible metrics count", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      // Open the metrics dropdown so its checkboxes become accessible
      const metricsBtn = screen.getByText("5 of 9 metrics selected").closest("button")!;
      fireEvent.click(metricsBtn);
      const metricsContainer = metricsBtn.closest(".metric-select-container");
      // "Calls" is the first checkbox in the metrics dropdown (initially checked)
      const [callsCheckbox] = within(metricsContainer!).getAllByRole("checkbox");
      fireEvent.click(callsCheckbox);
      expect(screen.getByText("4 of 9 metrics selected")).toBeInTheDocument();
    });

    it("toggling a metric on increments the visible metrics count", () => {
      render(<TestResultsCompare baselineData={baselineData} comparisonData={comparisonData} />);
      // Open the metrics dropdown so its checkboxes become accessible
      const metricsBtn = screen.getByText("5 of 9 metrics selected").closest("button")!;
      fireEvent.click(metricsBtn);
      const metricsContainer = metricsBtn.closest(".metric-select-container");
      // Checkboxes in order: calls(0), avg(1), min(2), max(3), stdDev(4), p50(5), p90(6), p95(7), p99(8)
      // "min" is at index 2 and is initially unchecked
      const metricCheckboxes = within(metricsContainer!).getAllByRole("checkbox");
      fireEvent.click(metricCheckboxes[2]);
      expect(screen.getByText("6 of 9 metrics selected")).toBeInTheDocument();
    });
  });
});
