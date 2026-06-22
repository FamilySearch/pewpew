import type { Column } from "write-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";

export interface ExcelResultRow {
  Method: string;
  Hostname: string;
  Path: string;
  QueryString: string;
  Tags: string;
  StatusCounts: string;
  CallCount: number;
  P50: string;
  P95: string;
  P99: string;
  Min: string;
  Max: string;
  StdDev: string;
  Time: string;
}

const RESULT_COLUMNS: Column<ExcelResultRow>[] = [
  { header: "Method",       cell: (row) => row.Method },
  { header: "Hostname",     cell: (row) => row.Hostname },
  { header: "Path",         cell: (row) => row.Path },
  { header: "QueryString",  cell: (row) => row.QueryString },
  { header: "Tags",         cell: (row) => row.Tags },
  { header: "StatusCounts", cell: (row) => row.StatusCounts },
  { header: "CallCount",    cell: (row) => row.CallCount },
  { header: "P50",          cell: (row) => row.P50 },
  { header: "P95",          cell: (row) => row.P95 },
  { header: "P99",          cell: (row) => row.P99 },
  { header: "Min",          cell: (row) => row.Min },
  { header: "Max",          cell: (row) => row.Max },
  { header: "StdDev",       cell: (row) => row.StdDev },
  { header: "Time",         cell: (row) => row.Time }
];

export async function exportResultsToExcel (data: ExcelResultRow[], fileName: string, sheetName: string): Promise<void> {
  const result = writeXlsxFile<ExcelResultRow>(data, { columns: RESULT_COLUMNS, sheet: sheetName });
  await result.toFile(fileName);
}
