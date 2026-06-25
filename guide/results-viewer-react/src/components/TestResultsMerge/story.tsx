import type { Meta, StoryFn } from "@storybook/react";
import { discoveryData1, discoveryData2, discoveryData3 } from "../TestResults/story";
import { GlobalStyle } from "../Global";
import React from "react";
import { TestResultsMerge } from ".";

// Same test data as used in TestResults and TestResultsCompare stories
const statsIntegration = "{\"test\":\"integration\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"http://localhost:9001/\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAYAAAAAAAAAAwAAAAAAAAABAAAAAAAAD/8/8AAAAAAAAP8VAqkTAg\",\"statusCounts\":{\"200\":2}}}}";

const statsIntOnDemand = "{\"test\":\"int_on_demand\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"GET\",\"url\":\"http://localhost:9001\"}}{\"index\":1,\"tags\":{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"http://localhost:9001?*\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAALkVAtkBAjkCEwI\",\"statusCounts\":{\"204\":4}},\"1\":{\"rttHistogram\":\"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAANUSAmsCvQECVQI\",\"statusCounts\":{\"204\":4}}}}";

// ============================================================================
// Concurrent agent data — real Discovery results, timestamps shifted to be
// concurrent (all three POST /token buckets land at t=1583956035, within
// seconds of each other, matching what happens when agents start together).
//
//   agentRun1 = Discovery 1 (19:46 UTC) — used as-is, no shift
//   agentRun2 = Discovery 2 (20:01 UTC) — shifted by -870 s (POST → 1583956035)
//   agentRun3 = Discovery 3 (22:19 UTC) — shifted by -9135 s (POST → 1583956035)
//
// Because the agents share bucket timestamps (15-second windows align after
// the first few buckets), detectOverlap() returns true for all combinations.
// ============================================================================

// Shifts "time", "startTime", and "endTime" fields in a PewPew JSON string.
function shiftTimestamps (json: string, shiftSeconds: number): string {
  return json.replace(/"(time|startTime|endTime)":(\d+)/g, (_match, key, val) =>
    `"${key}":${Number(val) + shiftSeconds}`
  );
}

const agentRun1 = discoveryData1;
// Discovery 2 POST time 1583956905 → 1583956035 (shift = -870)
const agentRun2 = shiftTimestamps(discoveryData2, -870);
// Discovery 3 POST time 1583965170 → 1583956035 (shift = -9135)
const agentRun3 = shiftTimestamps(discoveryData3, -9135);

// ============================================================================
// Staggered start data (+/- 2 minutes offset, like real agent deployments)
// Agent 1 starts at t=1583956035 (19:47 UTC), agent 2 starts ~2 min later.
// Overlap region: t=1583956155 through t=1583956335.
// POST /token appears at the start of each agent's run (different timestamps).
// ============================================================================

// Agent 1 (early start): 5 GET /family buckets beginning at t=1583956095, ends at t=1583956335
const agentEarlyStart = "{\"buckets\":[[{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"https://ident.pewpew.org/oauth2/v3/token\"},[{\"duration\":60,\"endTime\":1583956094,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAA4AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAKV9AocCAucFAtsBAjkC\",\"startTime\":1583956035,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956035}]],[{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"https://beta.pewpew.org/service/family/*?generations=8\"},[{\"duration\":60,\"endTime\":1583956154,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956095,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956095},{\"duration\":60,\"endTime\":1583956214,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956155,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956155},{\"duration\":60,\"endTime\":1583956274,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956215,\"statusCounts\":{\"200\":4},\"testErrors\":{},\"time\":1583956215},{\"duration\":60,\"endTime\":1583956334,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956275,\"statusCounts\":{\"200\":6},\"testErrors\":{},\"time\":1583956275},{\"duration\":60,\"endTime\":1583956394,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956335,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956335}]]],\"testName\":\"DiscoveryWicfFamilyBeta\"}";

// Agent 2 (late start, ~2 min after agent 1): POST /token at t=1583956155, GET /family continues past agent 1
const agentLateStart = "{\"buckets\":[[{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"https://ident.pewpew.org/oauth2/v3/token\"},[{\"duration\":60,\"endTime\":1583956214,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAA4AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAKV9AocCAucFAtsBAjkC\",\"startTime\":1583956155,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956155}]],[{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"https://beta.pewpew.org/service/family/*?generations=8\"},[{\"duration\":60,\"endTime\":1583956274,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956215,\"statusCounts\":{\"200\":4},\"testErrors\":{},\"time\":1583956215},{\"duration\":60,\"endTime\":1583956334,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956275,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956275},{\"duration\":60,\"endTime\":1583956394,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956335,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956335},{\"duration\":60,\"endTime\":1583956454,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956395,\"statusCounts\":{\"200\":4},\"testErrors\":{},\"time\":1583956395},{\"duration\":60,\"endTime\":1583956514,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956455,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956455}]]],\"testName\":\"DiscoveryWicfFamilyBeta\"}";

// ============================================================================
// No-overlap data (sequential runs 14 minutes apart — clearly different tests)
// Should trigger the overlap warning in the UI.
// ============================================================================

// Run at 19:47 UTC (timestamps ~1583956035)
const sequentialRun1 = agentRun1;

// Run at 20:01 UTC (timestamps ~1583956905) — 14 minutes after sequentialRun1
const sequentialRun2 = "{\"buckets\":[[{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"https://ident.pewpew.org/oauth2/v3/token\"},[{\"duration\":15,\"endTime\":1583956914,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAA8AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAO19AtkEArEDAscBAq8BAg\",\"startTime\":1583956913,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956905}]],[{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"https://beta.pewpew.org/service/family/*?generations=8\"},[{\"duration\":15,\"endTime\":1583956934,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAkAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAANm+AQLrCgIFAg\",\"startTime\":1583956926,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956920}]]],\"testName\":\"DiscoveryWicfFamilyBeta\"}";

export default {
  title: "TestResultsMerge"
} as Meta<typeof TestResultsMerge>;

export const NoFiles: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <p>TestResultsMerge with no files (renders nothing — needs ≥2 files):</p>
    <TestResultsMerge fileTexts={[]} filenames={[]} />
  </React.Fragment>
);

NoFiles.storyName = "No Files (Empty State)";

export const MergeTwoDiscoveryRuns: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentRun1, agentRun2]}
      filenames={["agent-1.json", "agent-2.json"]}
    />
  </React.Fragment>
);

MergeTwoDiscoveryRuns.storyName = "Merge Two Concurrent Agents";

export const MergeThreeDiscoveryRuns: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentRun1, agentRun2, agentRun3]}
      filenames={["agent-1.json", "agent-2.json", "agent-3.json"]}
    />
  </React.Fragment>
);

MergeThreeDiscoveryRuns.storyName = "Merge Three Agent Runs (Multi-Agent)";

export const MergeStaggeredStart: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentEarlyStart, agentLateStart]}
      filenames={["agent-early.json", "agent-late.json"]}
    />
  </React.Fragment>
);

MergeStaggeredStart.storyName = "Staggered Agent Starts (+/- 2 min offset, partial overlap)";

export const MergeNoOverlap: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[sequentialRun1, sequentialRun2]}
      filenames={["run-19h47.json", "run-20h01.json"]}
    />
  </React.Fragment>
);

MergeNoOverlap.storyName = "No Overlap — Different Test Runs (Warning)";

export const MergeSameFile: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentRun1, agentRun1]}
      filenames={["agent-1.json", "agent-2.json"]}
    />
  </React.Fragment>
);

MergeSameFile.storyName = "Merge Same File Twice (Doubles All Counts)";

export const MergeDifferentEndpoints: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[statsIntegration, statsIntOnDemand]}
      filenames={["integration.json", "int-on-demand.json"]}
    />
  </React.Fragment>
);

MergeDifferentEndpoints.storyName = "Merge Different Endpoints (Union)";
