import { ExcelResultRow, RESULT_COLUMNS, exportResultsToExcel } from "../src/excelexport";
import { expect } from "chai";

const EXPECTED_HEADERS = [
  "Method", "Hostname", "Path", "QueryString", "Tags",
  "StatusCounts", "CallCount", "P50", "P95", "P99",
  "Min", "Max", "StdDev", "Time"
];

const sampleRow: ExcelResultRow = {
  Method: "GET",
  Hostname: "example.com",
  Path: "/api/test",
  QueryString: "?foo=bar",
  Tags: "tag1",
  StatusCounts: "200: 99, 500: 1",
  CallCount: 100,
  P50: "1.23",
  P95: "4.56",
  P99: "7.89",
  Min: "0.50",
  Max: "9.99",
  StdDev: "1.11",
  Time: "6/22/2026, 10:00:00 AM"
};

describe("excelexport", () => {
  describe("RESULT_COLUMNS", () => {
    it("should define 14 columns", () => {
      expect(RESULT_COLUMNS).to.have.length(14);
    });

    it("should define correct column headers in order", () => {
      const headers = RESULT_COLUMNS.map((c) => c.header);
      expect(headers).to.deep.equal(EXPECTED_HEADERS);
    });

    it("should map each cell value from a row", () => {
      const cells = RESULT_COLUMNS.map((c) => c.cell(sampleRow, 0));
      expect(cells).to.deep.equal([
        "GET", "example.com", "/api/test", "?foo=bar", "tag1",
        "200: 99, 500: 1", 100, "1.23", "4.56", "7.89",
        "0.50", "9.99", "1.11", "6/22/2026, 10:00:00 AM"
      ]);
    });
  });

  describe("exportResultsToExcel", () => {
    it("should call writeFn with data and options, then toFile with fileName", async () => {
      let receivedData: ExcelResultRow[] | undefined;
      let receivedSheet: string | undefined;
      let receivedColumns: unknown;
      let receivedFileName: string | undefined;

      const mockToFile = (fileName: string) => { receivedFileName = fileName; return Promise.resolve(); };
      const mockWriteFn = (data: ExcelResultRow[], options: { columns: unknown; sheet: string }) => {
        receivedData = data;
        receivedColumns = options.columns;
        receivedSheet = options.sheet;
        return { toFile: mockToFile };
      };

      const data = [sampleRow];
      await exportResultsToExcel(data, "results.xlsx", "Final Results", mockWriteFn as never);

      expect(receivedData).to.deep.equal(data);
      expect(receivedColumns).to.equal(RESULT_COLUMNS);
      expect(receivedSheet).to.equal("Final Results");
      expect(receivedFileName).to.equal("results.xlsx");
    });

    it("should pass an empty data array without throwing", async () => {
      const mockToFile = (_fileName: string) => Promise.resolve();
      const mockWriteFn = (_data: ExcelResultRow[], _options: unknown) => ({ toFile: mockToFile });

      await exportResultsToExcel([], "empty.xlsx", "Sheet", mockWriteFn as never);
    });

    it("should propagate errors thrown by toFile", async () => {
      const mockToFile = (_fileName: string): Promise<void> => Promise.reject(new Error("download failed"));
      const mockWriteFn = (_data: ExcelResultRow[], _options: unknown) => ({ toFile: mockToFile });

      try {
        await exportResultsToExcel([sampleRow], "fail.xlsx", "Sheet", mockWriteFn as never);
        throw new Error("should have thrown");
      } catch (error: unknown) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("download failed");
      }
    });
  });
});
