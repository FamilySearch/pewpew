import { BucketId, DataPoint, ParsedFileEntry } from "../TestResults/model";
import { Danger, Warning } from "../Alert";
import { LogLevel, formatError, log } from "../../util/log";
import React, { useCallback, useEffect, useState } from "react";
import { detectOverlap, mergeResults } from "../TestResults/merge";
import { TestResults } from "../TestResults";
import { parseResultsData } from "../TestResults/utils";

const freeParsedEntries = (data: ParsedFileEntry[] | undefined) => {
  for (const [, dps] of (data || [])) {
    for (const dp of dps) { try { dp.rttHistogram.free(); } catch { /* already freed */ } }
  }
};

type AgentTimeSeries = [string, { time: Date; count: number }[]][];

interface TestResultsMergeProps {
  fileTexts: string[];
  filenames: string[];
}

export const TestResultsMerge = React.memo(({ fileTexts, filenames }: TestResultsMergeProps) => {
  const [mergedData, setMergedData] = useState<ParsedFileEntry[] | undefined>(undefined);
  const [agentTimeSeries, setAgentTimeSeries] = useState<AgentTimeSeries>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [noOverlap, setNoOverlap] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (fileTexts.length < 2) {
        setMergedData(prev => { freeParsedEntries(prev); return undefined; });
        setAgentTimeSeries([]);
        setNoOverlap(false);
        return;
      }

      setLoading(true);
      setError(undefined);
      setNoOverlap(false);

      try {
        const allParsed = await Promise.all(fileTexts.map((text) => parseResultsData(text)));
        log("TestResultsMerge parsed", LogLevel.DEBUG, { fileCount: allParsed.length });

        setNoOverlap(!detectOverlap(allParsed));

        // Compute per-agent time series: sum all endpoints at each timestamp per file.
        // Reads getTotalCount() immediately so no WASM objects escape this scope.
        const computed: AgentTimeSeries = allParsed.map((fileData, i) => {
          const timeMap = new Map<number, { time: Date; count: number }>();
          for (const [, dataPoints] of fileData) {
            for (const dp of dataPoints) {
              const t = dp.time.getTime();
              const count = Number(dp.rttHistogram.getTotalCount());
              const existing = timeMap.get(t);
              if (existing) {
                existing.count += count;
              } else {
                timeMap.set(t, { time: new Date(t), count });
              }
            }
          }
          const points = Array.from(timeMap.values())
            .sort((a, b) => a.time.getTime() - b.time.getTime());
          return [filenames[i] ?? `Agent ${i + 1}`, points] as [string, { time: Date; count: number }[]];
        });
        setAgentTimeSeries(computed);

        const merged = mergeResults(allParsed);
        // Free source histograms — mergeResults cloned what it needed
        for (const fileData of allParsed) { freeParsedEntries(fileData); }
        log("TestResultsMerge merged", LogLevel.DEBUG, { endpointCount: merged.length });

        setMergedData(prev => { freeParsedEntries(prev); return merged; });
      } catch (err) {
        log("TestResultsMerge error", LogLevel.ERROR, err);
        setError(formatError(err));
        setAgentTimeSeries([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [fileTexts]);

  const downloadMergedResults = useCallback(() => {
    if (!mergedData) { return; }
    setIsDownloading(true);
    try {
      const lines: string[] = [];
      const bucketSize = mergedData[0]?.[1]?.[0]?.duration ?? 60;

      // Header
      lines.push(JSON.stringify({ test: "merged", bin: "merged", bucketSize }));

      // One tags entry per endpoint — use sequential index (not _id) to match the time entry keys
      mergedData.forEach(([bucketId]: [BucketId, DataPoint[]], i: number) => {
        lines.push(JSON.stringify({ index: i, tags: { ...bucketId } }));
      });

      // Collect all timestamps across all endpoints, keyed by sequential index string
      const timeMap = new Map<number, Map<string, DataPoint>>();
      mergedData.forEach(([, dataPoints]: [BucketId, DataPoint[]], i: number) => {
        const key = String(i);
        for (const dp of dataPoints) {
          const t = Math.round(dp.time.getTime() / 1000);
          if (!timeMap.has(t)) { timeMap.set(t, new Map()); }
          timeMap.get(t)!.set(key, dp);
        }
      });

      // One time-bucket entry per timestamp
      for (const [time, endpointMap] of Array.from(timeMap.entries()).sort(([a], [b]) => a - b)) {
        const entries: Record<string, unknown> = {};
        for (const [id, dp] of endpointMap) {
          const entry: Record<string, unknown> = {
            rttHistogram: dp.rttHistogram.toBase64(),
            statusCounts: dp.statusCounts,
            testErrors: dp.testErrors
          };
          if (dp.requestTimeouts > 0) {
            entry.requestTimeouts = dp.requestTimeouts;
          }
          entries[id] = entry;
        }
        lines.push(JSON.stringify({ time, entries }));
      }

      const blob = new Blob([lines.join("\n")], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "stats-merged.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      log("downloadMergedResults error", LogLevel.ERROR, err);
    } finally {
      setIsDownloading(false);
    }
  }, [mergedData]);

  if (loading) {
    return <p>Merging results from {fileTexts.length} files...</p>;
  }

  if (error) {
    return <Danger>{error}</Danger>;
  }

  if (!mergedData) {
    return null;
  }

  return (
    <>
      <p style={{ textAlign: "left" }}>Merged from {filenames.length} files: {filenames.join(", ")}</p>
      <p>
        <button
          onClick={downloadMergedResults}
          disabled={isDownloading}
          style={{ cursor: isDownloading ? "wait" : "pointer" }}
        >
          {isDownloading ? "Downloading…" : "Download Combined Results File"}
        </button>
      </p>
      {noOverlap && (
        <Warning>
          Warning: No overlapping time buckets found between these files. These may be from different test runs rather than concurrent agents.
        </Warning>
      )}
      <TestResults resultsData={mergedData} agentTimeSeries={agentTimeSeries} />
    </>
  );
});

export default TestResultsMerge;
