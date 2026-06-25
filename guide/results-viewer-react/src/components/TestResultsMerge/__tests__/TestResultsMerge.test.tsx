import "@testing-library/jest-dom";
import { detectOverlap, mergeResults } from "../../TestResults/merge";
import { render, screen, waitFor } from "@testing-library/react";
import { ParsedFileEntry } from "../../TestResults/model";
import React from "react";
import { TestResultsMerge } from "../index";
import { parseResultsData } from "../../TestResults/utils";

// ============================================================================
// Mocks — babel-jest hoists jest.mock() above imports at runtime
// ============================================================================

jest.mock("../../TestResults/utils", () => ({
  parseResultsData: jest.fn()
}));

jest.mock("../../TestResults/merge", () => ({
  detectOverlap: jest.fn().mockReturnValue(true),
  mergeResults: jest.fn()
}));

jest.mock("../../TestResults", () => ({
  TestResults: ({ resultsData }: { resultsData?: ParsedFileEntry[] }) => (
    <div data-testid="test-results-component">
      {resultsData ? `data loaded: ${resultsData.length} endpoints` : "no data"}
    </div>
  )
}));

jest.mock("../../Alert", () => ({
  Danger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="danger-alert">{children}</div>
  ),
  Warning: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="overlap-warning">{children}</div>
  )
}));

const mockParseResultsData = parseResultsData as jest.MockedFunction<typeof parseResultsData>;
const mockMergeResults = mergeResults as jest.MockedFunction<typeof mergeResults>;
const mockDetectOverlap = detectOverlap as jest.MockedFunction<typeof detectOverlap>;

// ============================================================================
// Tests
// ============================================================================

describe("TestResultsMerge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetectOverlap.mockReturnValue(true);
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
      // parseResultsData never resolves in this test — keeps us in loading state
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
      const mockData: ParsedFileEntry[] = [
        [{ _id: "0", method: "GET", url: "http://example.com/" }, []]
      ];

      mockParseResultsData.mockResolvedValue([]);
      mockMergeResults.mockReturnValue(mockData);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["agent-1.json", "agent-2.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("test-results-component")).toBeInTheDocument();
      });

      expect(screen.getByText(/Merged from 2 files/)).toBeInTheDocument();
      expect(screen.getByText(/agent-1\.json/)).toBeInTheDocument();
      expect(screen.getByText(/agent-2\.json/)).toBeInTheDocument();
    });

    it("shows correct endpoint count from merged result", async () => {
      const mockData: ParsedFileEntry[] = [
        [{ _id: "0", method: "GET", url: "http://example.com/a" }, []],
        [{ _id: "1", method: "POST", url: "http://example.com/b" }, []]
      ];

      mockParseResultsData.mockResolvedValue([]);
      mockMergeResults.mockReturnValue(mockData);

      render(
        <TestResultsMerge
          fileTexts={["data1", "data2"]}
          filenames={["run-1.json", "run-2.json"]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("data loaded: 2 endpoints")).toBeInTheDocument();
      });
    });

    it("calls parseResultsData once per file", async () => {
      mockParseResultsData.mockResolvedValue([]);
      mockMergeResults.mockReturnValue([]);

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
      const parsed1: ParsedFileEntry[] = [[{ _id: "0", method: "GET", url: "http://a.com/" }, []]];
      const parsed2: ParsedFileEntry[] = [[{ _id: "0", method: "GET", url: "http://b.com/" }, []]];

      mockParseResultsData
        .mockResolvedValueOnce(parsed1)
        .mockResolvedValueOnce(parsed2);
      mockMergeResults.mockReturnValue([...parsed1, ...parsed2]);

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
      mockMergeResults.mockReturnValue([]);

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
      mockMergeResults.mockReturnValue([]);
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
      mockMergeResults.mockReturnValue([]);
      mockDetectOverlap.mockReturnValue(false);

      render(
        <TestResultsMerge
          fileTexts={["run1.json", "run2.json"]}
          filenames={["run1.json", "run2.json"]}
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
      mockMergeResults.mockReturnValue([]);

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
