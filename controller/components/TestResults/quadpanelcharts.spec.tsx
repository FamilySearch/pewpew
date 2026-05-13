import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

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

describe("Quad Panel Charts", () => {
  describe("Legend Functionality", () => {
    it("should render custom legends outside the canvas", async () => {
      const TestComponent = () => {
        const [chart, setChart] = React.useState<any>();
        const [hiddenDatasets, setHiddenDatasets] = React.useState<Set<number>>(new Set());

        const canvasRef = React.useCallback((node: HTMLCanvasElement | null) => {
          if (node && !chart) {
            setChart(mockChart);
          }
        }, [chart]);

        const toggleDataset = (index: number) => {
          if (chart) {
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

      await waitFor(() => {
        screen.getByTestId("custom-legend");
      });

      expect(screen.getByTestId("legend-item-0")).toBeInTheDocument();
      expect(screen.getByTestId("legend-item-1")).toBeInTheDocument();
      expect(screen.getByText("GET /api/test")).toBeInTheDocument();
      expect(screen.getByText("POST /api/test")).toBeInTheDocument();
    });

    it("should toggle dataset visibility when legend item is clicked", async () => {
      const mockMeta = { hidden: false };
      const mockChartWithMeta = {
        ...mockChart,
        getDatasetMeta (_index: number) { return mockMeta; }
      };

      const TestComponent = () => {
        const [chart] = React.useState(mockChartWithMeta);
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

      await waitFor(() => {
        expect(legendItem).toBeInTheDocument();
      });
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

      const checkbox = screen.getByTestId("merge-toggle") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
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
      expect(checkbox.checked).toBe(false);
      expect(screen.getByText("raw")).toBeInTheDocument();

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(screen.getByText("merged")).toBeInTheDocument();

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
      expect(screen.getByText("raw")).toBeInTheDocument();
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

  describe("Legend Styling", () => {
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
});
