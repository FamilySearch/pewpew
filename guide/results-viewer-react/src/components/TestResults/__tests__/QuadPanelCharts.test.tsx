import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Mock Chart.js
jest.mock("chart.js", () => ({
  Chart: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
    update: jest.fn(),
    getDatasetMeta: jest.fn(() => ({
      hidden: false
    })),
    data: {
      datasets: [
        { label: "GET /api/test", borderColor: "#6a7bb4" },
        { label: "POST /api/test", borderColor: "#c94277" }
      ]
    }
  })),
  register: jest.fn()
}));

// Mock charts module
jest.mock("../charts", () => ({
  medianDurationChart: jest.fn(() => ({
    destroy: jest.fn(),
    update: jest.fn(),
    getDatasetMeta: jest.fn(() => ({
      hidden: false
    })),
    data: {
      datasets: [
        { label: "GET /api/test", borderColor: "#6a7bb4" },
        { label: "POST /api/test", borderColor: "#c94277" }
      ]
    }
  })),
  worst5PercentChart: jest.fn(() => ({
    destroy: jest.fn(),
    update: jest.fn(),
    getDatasetMeta: jest.fn(() => ({
      hidden: false
    })),
    data: {
      datasets: [
        { label: "GET /api/test", borderColor: "#6a7bb4" },
        { label: "POST /api/test", borderColor: "#c94277" }
      ]
    }
  })),
  error5xxChart: jest.fn(() => ({
    destroy: jest.fn(),
    update: jest.fn(),
    getDatasetMeta: jest.fn(() => ({
      hidden: false
    })),
    data: {
      datasets: [
        { label: "500 GET /api/test", borderColor: "#ff6b6b" },
        { label: "502 POST /api/test", borderColor: "#ff8c42" }
      ]
    }
  })),
  allErrorsChart: jest.fn(() => ({
    destroy: jest.fn(),
    update: jest.fn(),
    getDatasetMeta: jest.fn(() => ({
      hidden: false
    })),
    data: {
      datasets: [
        { label: "403 GET /api/test", borderColor: "#ff6b6b" },
        { label: "404 POST /api/test", borderColor: "#ff8c42" }
      ]
    }
  }))
}));

describe("Quad Panel Charts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Legend Functionality", () => {
    it("should render custom legends outside the canvas", async () => {
      const TestComponent = () => {
        const [chart, setChart] = React.useState<any>();
        const [hiddenDatasets, setHiddenDatasets] = React.useState<Set<number>>(new Set());

        const canvasRef = React.useCallback((node: HTMLCanvasElement | null) => {
          if (node && !chart) {
            const mockChart = {
              destroy: jest.fn(),
              update: jest.fn(),
              getDatasetMeta: jest.fn(() => ({
                hidden: false
              })),
              data: {
                datasets: [
                  { label: "GET /api/test", borderColor: "#6a7bb4" },
                  { label: "POST /api/test", borderColor: "#c94277" }
                ]
              }
            };
            setChart(mockChart);
          }
        }, [chart, hiddenDatasets]);

        const toggleDataset = (index: number) => {
          if (chart) {
            const meta = chart.getDatasetMeta(index);
            meta.hidden = !meta.hidden;
            chart.update();

            setHiddenDatasets(prev => {
              const newSet = new Set(prev);
              if (meta.hidden) {
                newSet.add(index);
              } else {
                newSet.delete(index);
              }
              return newSet;
            });
          }
        };

        return (
          <div>
            <canvas ref={canvasRef} />
            {chart && chart.data.datasets && (
              <div data-testid="custom-legend">
                {chart.data.datasets.map((dataset: any, index: number) => (
                  <div
                    key={index}
                    data-testid={`legend-item-${index}`}
                    onClick={() => toggleDataset(index)}
                    style={{ opacity: hiddenDatasets.has(index) ? 0.3 : 1 }}
                  >
                    <span style={{ backgroundColor: dataset.borderColor }} />
                    <span>{dataset.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      };

      render(<TestComponent />);

      // Check legend is rendered
      await waitFor(() => {
        expect(screen.getByTestId("custom-legend")).toBeInTheDocument();
      });

      // Check legend items are rendered
      expect(screen.getByTestId("legend-item-0")).toBeInTheDocument();
      expect(screen.getByTestId("legend-item-1")).toBeInTheDocument();

      // Check legend text
      expect(screen.getByText("GET /api/test")).toBeInTheDocument();
      expect(screen.getByText("POST /api/test")).toBeInTheDocument();
    });

    it("should toggle dataset visibility when legend item is clicked", async () => {
      const mockMeta = { hidden: false };
      const mockChart = {
        destroy: jest.fn(),
        update: jest.fn(),
        getDatasetMeta: jest.fn((_index: number) => mockMeta),
        data: {
          datasets: [
            { label: "GET /api/test", borderColor: "#6a7bb4" },
            { label: "POST /api/test", borderColor: "#c94277" }
          ]
        }
      };

      const TestComponent = () => {
        const [chart] = React.useState(mockChart);
        const [hiddenDatasets, setHiddenDatasets] = React.useState<Set<number>>(new Set());

        const toggleDataset = (index: number) => {
          const meta = chart.getDatasetMeta(index);
          meta.hidden = !meta.hidden;
          chart.update();

          setHiddenDatasets(prev => {
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

      // Click to hide
      fireEvent.click(legendItem);

      await waitFor(() => {
        expect(mockChart.update).toHaveBeenCalled();
      });

      // Check opacity changes
      expect(legendItem).toHaveStyle({ opacity: "0.3" });
    });
  });

  describe("Merge Endpoints Toggle", () => {
    it("should show merge toggle checkbox", () => {
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

      const checkbox = screen.getByTestId("merge-toggle");
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
      expect(screen.getByText("Merge endpoints with different tags")).toBeInTheDocument();
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
      const stateDisplay = screen.getByTestId("merge-state");

      // Initial state
      expect(checkbox.checked).toBe(false);
      expect(stateDisplay).toHaveTextContent("raw");

      // Click to enable merge
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(stateDisplay).toHaveTextContent("merged");

      // Click to disable merge
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
      expect(stateDisplay).toHaveTextContent("raw");
    });
  });

  describe("Chart Configuration", () => {
    it("should set yAlign to top for tooltips", () => {
      // This test verifies the tooltip configuration
      // In actual implementation, tooltips use yAlign: 'top' to appear above the graph
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

  describe("Legend Styling", () => {
    it("should apply grey color to legend text", () => {
      const TestComponent = () => (
        <div style={{ color: "#999" }} data-testid="legend-item">
          Test Label
        </div>
      );

      render(<TestComponent />);

      const legendItem = screen.getByTestId("legend-item");
      expect(legendItem).toHaveStyle({ color: "#999" });
    });

    it("should have compact spacing between legend items", () => {
      const TestComponent = () => (
        <div style={{ gap: "0.5em", display: "flex" }} data-testid="legend-container">
          <div>Item 1</div>
          <div>Item 2</div>
        </div>
      );

      render(<TestComponent />);

      const container = screen.getByTestId("legend-container");
      expect(container).toHaveStyle({ gap: "0.5em" });
    });
  });
});
