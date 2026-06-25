import { AgentChart, FinalResultsTable, HostChart, OverviewChart, QuadPanelCharts } from "../TestResults";
import { Danger, Warning } from "../Alert";
import { LogLevel, log } from "../../src/log";
import { MinMaxTime, minMaxTime, parseResultsData } from "../TestResults/utils";
import React, { useEffect, useState } from "react";
import { detectOverlap, mergeResults } from "../TestResults/merge";
import { ParsedFileEntry } from "../TestResults/model";
import { formatError } from "../../src/clientutil";
import styled from "styled-components";

const SectionHeading = styled.h1`
  text-align: left;
`;

const SectionHeadingH2 = styled.h2`
  text-align: left;
`;

const TimeTaken = styled.div`
  text-align: left;
`;

export interface TestResultsMergeProps {
  fileTexts: string[];
  filenames: string[];
}

type AgentTimeSeries = [string, { time: Date; count: number }[]][];

export const TestResultsMerge = React.memo(({ fileTexts, filenames }: TestResultsMergeProps) => {
  const [mergedData, setMergedData] = useState<ParsedFileEntry[] | undefined>(undefined);
  const [agentTimeSeries, setAgentTimeSeries] = useState<AgentTimeSeries>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [noOverlap, setNoOverlap] = useState(false);
  const [startEndTime, setStartEndTime] = useState<MinMaxTime | undefined>(undefined);

  useEffect(() => {
    const loadData = async () => {
      if (fileTexts.length < 2) {
        setMergedData(undefined);
        setAgentTimeSeries([]);
        setNoOverlap(false);
        setStartEndTime(undefined);
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
        // Reads getTotalCount() immediately — no WASM objects escape this scope.
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
        log("TestResultsMerge merged", LogLevel.DEBUG, { endpointCount: merged.length });

        // Free intermediate parsed data — mergeResults cloned what it needed
        for (const fileData of allParsed) {
          for (const [, dps] of fileData) {
            for (const dp of dps) { try { dp.rttHistogram.free(); } catch { } }
          }
        }

        const times = minMaxTime(merged);
        setStartEndTime(times);
        setMergedData(merged);
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
    <TimeTaken>
      <p style={{ textAlign: "left" }}>
        Merged from {filenames.length} files: {filenames.join(", ")}
      </p>
      {noOverlap && (
        <Warning>
          Warning: No overlapping time buckets found between these files. These may be from different test runs rather than concurrent agents.
        </Warning>
      )}

      {startEndTime && (
        <>
          <SectionHeading>Time Taken</SectionHeading>
          <p>{startEndTime.startTime} to {startEndTime.endTime}</p>
          <p>Total time: {startEndTime.deltaTime}</p>
        </>
      )}

      <SectionHeadingH2>Request Count Overview</SectionHeadingH2>
      <OverviewChart displayData={mergedData} mergeEndpoints={false} />
      <HostChart displayData={mergedData} />
      <AgentChart displayData={mergedData} agentTimeSeries={agentTimeSeries} />

      <SectionHeadingH2>Performance &amp; Error Metrics</SectionHeadingH2>
      <QuadPanelCharts displayData={mergedData} mergeEndpoints={false} />

      <SectionHeading>Final Results</SectionHeading>
      <FinalResultsTable displayData={mergedData} />
    </TimeTaken>
  );
});

export default TestResultsMerge;
