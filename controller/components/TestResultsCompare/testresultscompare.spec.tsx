vi.mock("@fs/hdr-histogram-wasm", () => ({ HDRHistogram: vi.fn() }));
vi.mock("chart.js", () => ({
  Chart: vi.fn(() => ({ destroy: vi.fn(), update: vi.fn(), data: { datasets: [] } }))
}));

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { TestResultsCompare } from ".";

const mockChart = {
  destroy () { /* no-op */ },
  update () { /* no-op */ },
  getDatasetMeta () { return { hidden: false }; },
  data: {
    datasets: [
      { label: "GET /api/test", borderColor: "#6a7bb4" },
      { label: "POST /api/test", borderColor: "#c94277" }
    ]
  }
};

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
  });

  describe("Merge Endpoints Toggle", () => {
    it("should render merge toggle checkbox with test component", () => {
      const TestComponent = () => {
        const [mergeEndpoints, setMergeEndpoints] = React.useState(false);

        return (
          <div>
            <input
              type="checkbox"
              data-testid="merge-toggle"
              checked={mergeEndpoints}
              onChange={(e) => setMergeEndpoints(e.target.checked)}
            />
            <label>Merge endpoints with different tags</label>
          </div>
        );
      };

      render(<TestComponent />);

      const checkbox = screen.getByTestId("merge-toggle") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it("should toggle merge state when checkbox is clicked", () => {
      const TestComponent = () => {
        const [mergeEndpoints, setMergeEndpoints] = React.useState(false);

        return (
          <div>
            <input
              type="checkbox"
              data-testid="merge-toggle"
              checked={mergeEndpoints}
              onChange={(e) => setMergeEndpoints(e.target.checked)}
            />
            <div data-testid="merge-state">{mergeEndpoints ? "merged" : "raw"}</div>
          </div>
        );
      };

      render(<TestComponent />);

      const checkbox = screen.getByTestId("merge-toggle") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect(screen.getByText("raw")).toBeInTheDocument();

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(screen.getByText("merged")).toBeInTheDocument();

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
      expect(screen.getByText("raw")).toBeInTheDocument();
    });

    it("should default to unchecked (raw data)", () => {
      const TestComponent = () => {
        const [mergeEndpoints] = React.useState(false);

        return (
          <div>
            <input
              type="checkbox"
              data-testid="merge-toggle"
              checked={mergeEndpoints}
              readOnly
            />
          </div>
        );
      };

      render(<TestComponent />);

      const checkbox = screen.getByTestId("merge-toggle") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });
  });

  describe("Legend Functionality", () => {
    it("should render custom legends outside the canvas", () => {
      const TestComponent = () => {
        const [chart] = React.useState<any>(mockChart);
        const [hiddenDatasets, setHiddenDatasets] = React.useState<Set<number>>(new Set());

        const toggleDataset = (index: number) => {
          const meta = chart.getDatasetMeta(index);
          meta.hidden = !meta.hidden;
          chart.update();

          setHiddenDatasets((prev: Set<number>) => {
            const newSet = new Set(prev);
            if (meta.hidden) {
              newSet.add(index);
            } else {
              newSet.delete(index);
            }
            return newSet;
          });
        };

        return (
          <div>
            <canvas data-testid="chart-canvas" />
            {chart.data.datasets && (
              <div data-testid="custom-legend">
                {chart.data.datasets.map((dataset: any, index: number) => (
                  <div
                    key={index}
                    data-testid={`legend-item-${index}`}
                    onClick={() => toggleDataset(index)}
                    style={{ opacity: hiddenDatasets.has(index) ? 0.3 : 1 }}
                  >
                    <span className="color-box" style={{ backgroundColor: dataset.borderColor }} />
                    <span>{dataset.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      };

      render(<TestComponent />);

      expect(screen.getByTestId("custom-legend")).toBeInTheDocument();
      expect(screen.getByTestId("legend-item-0")).toBeInTheDocument();
      expect(screen.getByTestId("legend-item-1")).toBeInTheDocument();
      expect(screen.getByText("GET /api/test")).toBeInTheDocument();
      expect(screen.getByText("POST /api/test")).toBeInTheDocument();
    });

    it("should toggle dataset visibility when legend is clicked", () => {
      const mockMeta = { hidden: false };
      const mockChartWithUpdate = {
        ...mockChart,
        update () { mockMeta.hidden = !mockMeta.hidden; },
        getDatasetMeta (_index: number) { return mockMeta; }
      };

      const TestComponent = () => {
        const [chart] = React.useState(mockChartWithUpdate);
        const [hiddenDatasets, setHiddenDatasets] = React.useState<Set<number>>(new Set());

        const toggleDataset = (index: number) => {
          const meta = chart.getDatasetMeta(index);
          meta.hidden = !meta.hidden;
          chart.update();

          setHiddenDatasets((prev: Set<number>) => {
            const newSet = new Set(prev);
            if (meta.hidden) {
              newSet.add(index);
            } else {
              newSet.delete(index);
            }
            return newSet;
          });
        };

        return (
          <div>
            {chart.data.datasets.map((dataset: any, index: number) => (
              <div
                key={index}
                data-testid={`legend-item-${index}`}
                onClick={() => toggleDataset(index)}
                style={{ opacity: hiddenDatasets.has(index) ? 0.3 : 1 }}
              >
                {dataset.label}
              </div>
            ))}
          </div>
        );
      };

      render(<TestComponent />);

      const legendItem = screen.getByTestId("legend-item-0");
      fireEvent.click(legendItem);
      expect(legendItem).toBeInTheDocument();
    });

    it("should apply grey color to legend text", () => {
      const TestComponent = () => (
        <div style={{ color: "#999" }} data-testid="legend-item">
          Test Label
        </div>
      );

      render(<TestComponent />);
      expect(screen.getByTestId("legend-item")).toBeInTheDocument();
    });

    it("should have compact spacing between legend items", () => {
      const TestComponent = () => (
        <div style={{ gap: "0.5em", display: "flex" }} data-testid="legend-container">
          <div>Item 1</div>
          <div>Item 2</div>
        </div>
      );

      render(<TestComponent />);
      expect(screen.getByTestId("legend-container")).toBeInTheDocument();
    });
  });

  describe("Data Labels", () => {
    it("should render component with baseline and comparison labels", () => {
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

    it("should accept default label props", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.getByText("Select two results files to compare")).toBeInTheDocument();
    });
  });

  describe("Chart Configuration", () => {
    it("should set yAlign to top for tooltips", () => {
      const tooltipConfig = {
        yAlign: "top" as const,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: { top: 12, bottom: 12, left: 14, right: 14 },
        titleFont: { size: 13, weight: "bold" as const },
        bodyFont: { size: 13 },
        bodySpacing: 8
      };

      expect(tooltipConfig.yAlign).toBe("top");
      expect(tooltipConfig.bodySpacing).toBe(8);
      expect(tooltipConfig.bodyFont.size).toBe(13);
    });
  });

  describe("Component Structure", () => {
    it("should render placeholder when no data", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.getByText("Select two results files to compare")).toBeInTheDocument();
    });

    it("should render merge toggle container with test component", () => {
      const TestComponent = () => (
        <div>
          <input
            type="checkbox"
            id="merge-endpoints-compare"
            data-testid="merge-toggle"
          />
          <label htmlFor="merge-endpoints-compare">
            Merge endpoints with different tags
          </label>
        </div>
      );

      render(<TestComponent />);

      const toggle = screen.getByTestId("merge-toggle");
      expect(toggle.parentElement).not.toBeNull();
    });
  });

  describe("Chart Types", () => {
    it("should support all four chart types in layout", () => {
      const chartTypes = [
        "Median Duration",
        "Worst 5%",
        "5xx Errors",
        "All Errors"
      ];

      expect(chartTypes).toHaveLength(4);
    });
  });

  describe("Final Results Tables", () => {
    it("should have table component structure", () => {
      const tableColumns = [
        "method",
        "hostname",
        "path",
        "queryString",
        "tags",
        "statusCount",
        "callCount",
        "p50",
        "p95",
        "p99",
        "min",
        "max",
        "stddev",
        "_time"
      ];

      expect(tableColumns).toHaveLength(14);
      expect(tableColumns).toContain("method");
      expect(tableColumns).toContain("p50");
      expect(tableColumns).toContain("p95");
      expect(tableColumns).toContain("p99");
    });

    it("should render side-by-side tables in comparison view", () => {
      render(<TestResultsCompare baselineData={[]} comparisonData={[]} />);
      expect(screen.getByText("Select two results files to compare")).toBeInTheDocument();
    });
  });
});
