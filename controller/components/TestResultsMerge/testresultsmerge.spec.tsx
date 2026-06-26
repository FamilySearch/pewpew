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
vi.mock("../TestResults/utils", () => ({
  parseResultsData: vi.fn(),
  minMaxTime: vi.fn(() => ({
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-01T01:00:00Z",
    deltaTime: "1h 0m"
  })),
  formatError: vi.fn((e: unknown) => String(e instanceof Error ? e.message : e))
}));
vi.mock("../TestResults/merge", () => ({
  detectOverlap: vi.fn(() => true),
  mergeResults: vi.fn(() => [])
}));
vi.mock("../TestResults", () => ({
  OverviewChart: () => <div data-testid="overview-chart" />,
  HostChart: () => <div data-testid="host-chart" />,
  AgentChart: () => <div data-testid="agent-chart" />,
  QuadPanelCharts: () => <div data-testid="quad-panel-charts" />,
  FinalResultsTable: () => <div data-testid="final-results-table" />,
  freeParsedEntries: vi.fn()
}));
vi.mock("../Alert", () => ({
  Danger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="danger-alert">{children}</div>
  ),
  Warning: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="overlap-warning">{children}</div>
  )
}));

import { detectOverlap, mergeResults } from "../TestResults/merge";
import { render, screen, waitFor } from "@testing-library/react";
import { ParsedFileEntry } from "../TestResults/model";
import React from "react";
import { TestResultsMerge } from ".";
import { parseResultsData } from "../TestResults/utils";

const mockParseResultsData = parseResultsData as ReturnType<typeof vi.fn>;
const mockMergeResults = mergeResults as ReturnType<typeof vi.fn>;
const mockDetectOverlap = detectOverlap as ReturnType<typeof vi.fn>;

describe("TestResultsMerge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectOverlap.mockReturnValue(true);
    mockMergeResults.mockReturnValue([]);
  });

  describe("Empty state", () => {
    it("renders nothing when no files are provided", () => {
      const { container } = render(<TestResultsMerge fileTexts={[]} filenames={[]} />);
      expect(container).toBeEmptyDOMElement();
      expect(mockParseResultsData).not.toHaveBeenCalled();
    });

    it("renders nothing when only one file is provided", () => {
      const { container } = render(
        <TestResultsMerge fileTexts={["data"]} filenames={["file.json"]} />
      );
      expect(container).toBeEmptyDOMElement();
      expect(mockParseResultsData).not.toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("shows loading message while parsing files", async () => {
      mockParseResultsData.mockImplementation(() => new Promise(() => { /* never resolves */ }));

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["agent-1.json", "agent-2.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Merging results from 2 files/)).toBeInTheDocument();
      });
    });
  });

  describe("Error state", () => {
    it("shows error when parsing fails", async () => {
      mockParseResultsData.mockRejectedValue(new Error("Invalid JSON format"));

      render(
        <TestResultsMerge
          fileTexts={["bad-data", "also-bad"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("danger-alert")).toBeInTheDocument();
      });
      expect(screen.getByTestId("danger-alert")).toHaveTextContent("Invalid JSON format");
    });
  });

  describe("Successful merge", () => {
    it("shows merged result with filenames after successful parse", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["agent-1.json", "agent-2.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Merged from 2 files/)).toBeInTheDocument();
      });
      expect(screen.getByText(/agent-1\.json/)).toBeInTheDocument();
      expect(screen.getByText(/agent-2\.json/)).toBeInTheDocument();
    });

    it("shows Time Taken section with start and end time", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Time Taken" })).toBeInTheDocument();
      });
      expect(screen.getByText(/2024-01-01T00:00:00Z.*2024-01-01T01:00:00Z/)).toBeInTheDocument();
      expect(screen.getByText(/1h 0m/)).toBeInTheDocument();
    });

    it("renders overview, host, and agent charts", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("overview-chart")).toBeInTheDocument();
      });
      expect(screen.getByTestId("host-chart")).toBeInTheDocument();
      expect(screen.getByTestId("agent-chart")).toBeInTheDocument();
    });

    it("renders performance metrics and final results table", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("quad-panel-charts")).toBeInTheDocument();
      });
      expect(screen.getByTestId("final-results-table")).toBeInTheDocument();
    });

    it("shows Request Count Overview heading", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Request Count Overview" })).toBeInTheDocument();
      });
    });

    it("shows Performance & Error Metrics heading", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Performance & Error Metrics" })).toBeInTheDocument();
      });
    });

    it("calls parseResultsData once per file", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2", "data3"]}
          filenames={["a.json", "b.json", "c.json"]}
        />
      );

      await waitFor(() => {
        expect(mockParseResultsData).toHaveBeenCalledTimes(3);
      });
      expect(mockParseResultsData).toHaveBeenCalledWith("data1");
      expect(mockParseResultsData).toHaveBeenCalledWith("data2");
      expect(mockParseResultsData).toHaveBeenCalledWith("data3");
    });

    it("calls mergeResults with all parsed results", async () => {
      const parsed1: ParsedFileEntry[] = [[{ method: "GET", url: "http://a.com/" }, []]];
      const parsed2: ParsedFileEntry[] = [[{ method: "GET", url: "http://b.com/" }, []]];

      mockParseResultsData
        .mockResolvedValueOnce(parsed1)
        .mockResolvedValueOnce(parsed2);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(mockMergeResults).toHaveBeenCalledWith([parsed1, parsed2]);
      });
    });

    it("re-merges when fileTexts prop changes", async () => {
      mockParseResultsData.mockResolvedValue([]);

      const { rerender } = render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(mockParseResultsData).toHaveBeenCalledTimes(2);
      });

      rerender(
        <TestResultsMerge
          fileTexts={["data1", "data2", "data3"]}
          filenames={["a.json", "b.json", "c.json"]}
        />
      );

      await waitFor(() => {
        expect(mockParseResultsData).toHaveBeenCalledTimes(5);
      });
    });
  });

  describe("Overlap detection", () => {
    it("shows no warning when files have overlapping timestamps", async () => {
      mockParseResultsData.mockResolvedValue([]);
      mockDetectOverlap.mockReturnValue(true);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.queryByTestId("overlap-warning")).not.toBeInTheDocument();
      });
    });

    it("shows warning when files have no overlapping timestamps", async () => {
      mockParseResultsData.mockResolvedValue([]);
      mockDetectOverlap.mockReturnValue(false);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["a.json", "b.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("overlap-warning")).toBeInTheDocument();
      });
      expect(screen.getByTestId("overlap-warning")).toHaveTextContent(
        /No overlapping time buckets/
      );
    });
  });

  describe("Three file merge", () => {
    it("shows three filenames in merged result label", async () => {
      mockParseResultsData.mockResolvedValue([]);

      render(
        <TestResultsMerge
          fileTexts={["d1", "d2", "d3"]}
          filenames={["agent-1.json", "agent-2.json", "agent-3.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Merged from 3 files/)).toBeInTheDocument();
      });
      expect(screen.getByText(/agent-3\.json/)).toBeInTheDocument();
    });
  });
});
