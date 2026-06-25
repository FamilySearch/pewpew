import { GlobalStyle } from "../Layout";
import React from "react";
import { TestResultsMerge } from ".";

// Real Discovery test result JSON strings (same data used in TestResults stories)
// eslint-disable-next-line quotes
const discoveryData1 = `{"buckets":[[{"_id":"0","method":"POST","url":"https://ident.pewpew.org/oauth2/v3/token"},[{"duration":15,"endTime":1583956040,"requestTimeouts":0,"rttHistogram":"HISTEwAAAA4AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAKV9AocCAucFAtsBAjkC","startTime":1583956039,"statusCounts":{"200":5},"testErrors":{},"time":1583956035}]],[{"_id":"1","method":"GET","url":"https://beta.pewpew.org/service/family/*?generations=8"},[{"duration":15,"endTime":1583956098,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI","startTime":1583956098,"statusCounts":{"200":1},"testErrors":{},"time":1583956095},{"duration":15,"endTime":1583956124,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI","startTime":1583956124,"statusCounts":{"200":1},"testErrors":{},"time":1583956110},{"duration":15,"endTime":1583956142,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAOnMAQI","startTime":1583956142,"statusCounts":{"200":1},"testErrors":{},"time":1583956140},{"duration":15,"endTime":1583956169,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAcAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAM/NAQKpAwI","startTime":1583956157,"statusCounts":{"200":2},"testErrors":{},"time":1583956155},{"duration":15,"endTime":1583956181,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAOnLAQI","startTime":1583956181,"statusCounts":{"200":1},"testErrors":{},"time":1583956170},{"duration":15,"endTime":1583956194,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAO/RAQI","startTime":1583956194,"statusCounts":{"200":1},"testErrors":{},"time":1583956185},{"duration":15,"endTime":1583956205,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAANPLAQI","startTime":1583956205,"statusCounts":{"200":1},"testErrors":{},"time":1583956200},{"duration":15,"endTime":1583956217,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfNAQI","startTime":1583956217,"statusCounts":{"200":1},"testErrors":{},"time":1583956215}]]],"testName":"DiscoveryWicfFamilyBeta"}`;
// eslint-disable-next-line quotes
const discoveryData2 = '{"buckets":[[{"_id":"0","method":"POST","url":"https://ident.pewpew.org/oauth2/v3/token"},[{"duration":15,"endTime":1583956914,"requestTimeouts":0,"rttHistogram":"HISTEwAAAA8AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAO19AtkEArEDAscBAq8BAg","startTime":1583956913,"statusCounts":{"200":5},"testErrors":{},"time":1583956905}]],[{"_id":"1","method":"GET","url":"https://beta.pewpew.org/service/family/*?generations=8"},[{"duration":15,"endTime":1583956934,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAkAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAANm+AQLrCgIFAg","startTime":1583956926,"statusCounts":{"200":3},"testErrors":{},"time":1583956920},{"duration":15,"endTime":1583956949,"requestTimeouts":0,"rttHistogram":"HISTEwAAABgAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAKO2AQL7AwLrCALLAQJ7AtMCAqsBAtUIAg","startTime":1583956935,"statusCounts":{"200":8},"testErrors":{},"time":1583956935},{"duration":15,"endTime":1583956963,"requestTimeouts":0,"rttHistogram":"HISTEwAAACAAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAANfFAQKRBQJJAoMEAo0CAiEC5wQCVwIRAiEC/wEC5QEC","startTime":1583956953,"statusCounts":{"200":12},"testErrors":{},"time":1583956950},{"duration":15,"endTime":1583956976,"requestTimeouts":0,"rttHistogram":"HISTEwAAACAAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAM/GAQKtBgLLAgKZAgJHArECAtMDAjECuQIC5QECrQEC","startTime":1583956966,"statusCounts":{"200":11},"testErrors":{},"time":1583956965},{"duration":15,"endTime":1583957009,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAH///8/8AAAAAAAAK/mAQLrCgK3CgI","startTime":1583957007,"statusCounts":{"200":3},"testErrors":{},"time":1583956995},{"duration":15,"endTime":1583957023,"requestTimeouts":0,"rttHistogram":"HISTEwAAAC8AAAAAAAAAAwAAAAAAAAABAAAAAAP///8/8AAAAAAAAJ/CAQKbBALTBQLbCgLXBgIrAq0DAt8QAr0GAjMCfQJNAsEBAvUEAhcC7wEC7wIC","startTime":1583957010,"statusCounts":{"200":16,"500":1},"testErrors":{"endpoint was delayed waiting for provider `countrycode`":7,"endpoint was delayed waiting for provider `sessionid`":7},"time":1583957010},{"duration":15,"endTime":1583957039,"requestTimeouts":0,"rttHistogram":"HISTEwAAAEcAAAAAAAAAAwAAAAAAAAABAAAAAAP///8/8AAAAAAAAPHKAQKJAgKrBQKfAQL7BgJDAqsEAkECoQMCIQJ3ArsOAosNAmMC9wICZQI3AisCBQJjAg0C0QUCAwICAwQAAgsCAgcCAgUC","startTime":1583957026,"statusCounts":{"200":21,"504":11},"testErrors":{"endpoint was delayed waiting for provider `sessionid`":12,"endpoint was delayed waiting for provider `countrycode`":12},"time":1583957025},{"duration":15,"endTime":1583957054,"requestTimeouts":1,"rttHistogram":"HISTEwAAAA0AAAAAAAAAAwAAAAAAAAABAAAAAAP///8/8AAAAAAAAJGMAgICCwICAhECEQI","startTime":1583957040,"statusCounts":{"504":6},"testErrors":{},"time":1583957040},{"duration":15,"endTime":1583957069,"requestTimeouts":0,"rttHistogram":"HISTEwAAAA0AAAAAAAAAAwAAAAAAAAABAAAAAAP///8/8AAAAAAAAJnEAQKDAgKzIQLRJAQ","startTime":1583957066,"statusCounts":{"200":3,"504":2},"testErrors":{"endpoint was delayed waiting for provider `countrycode`":5,"endpoint was delayed waiting for provider `sessionid`":5},"time":1583957055},{"duration":15,"endTime":1583957083,"requestTimeouts":0,"rttHistogram":"HISTEwAAADgAAAAAAAAAAwAAAAAAAAABAAAAAAP///8/8AAAAAAAAKHLAQLRAwJ7Ap8CAssPAgsCFQIHAqUBAvMCAr0LAg0CjQ8CWQKlAQITAjUCgwICxQYCAwILAgAC","startTime":1583957071,"statusCounts":{"200":18,"504":4},"testErrors":{"endpoint was delayed waiting for provider `countrycode`":22,"endpoint was delayed waiting for provider `sessionid`":22},"time":1583957070},{"duration":15,"endTime":1583957092,"requestTimeouts":0,"rttHistogram":"HISTEwAAACEAAAAAAAAAAwAAAAAAAAABAAAAAAP///8/8AAAAAAAAPfZAQK/AwKhBgJDAvMCArcCAqUKAqMYAgcCAgIHAgIPBA","startTime":1583957085,"statusCounts":{"200":7,"504":8},"testErrors":{"endpoint was delayed waiting for provider `sessionid`":15,"endpoint was delayed waiting for provider `countrycode`":15},"time":1583957085}]]],"testName":"DiscoveryWicfFamilyBeta"}';
// eslint-disable-next-line quotes
const discoveryData3 = `{"buckets":[[{"_id":"0","method":"POST","url":"https://ident.pewpew.org/oauth2/v3/token"},[{"duration":15,"endTime":1583965173,"requestTimeouts":0,"rttHistogram":"HISTEwAAAA4AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAP9+AisCrwECtwICrQIC","startTime":1583965173,"statusCounts":{"200":5},"testErrors":{},"time":1583965170}]],[{"_id":"1","method":"GET","url":"https://beta.pewpew.org/service/family/*?generations=8"},[{"duration":15,"endTime":1583965228,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAAf//8/8AAAAAAAAKm8AQI","startTime":1583965228,"statusCounts":{"200":1},"testErrors":{},"time":1583965215},{"duration":15,"endTime":1583965255,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAAf//8/8AAAAAAAALu8AQI","startTime":1583965255,"statusCounts":{"200":1},"testErrors":{},"time":1583965245},{"duration":15,"endTime":1583965273,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAAf//8/8AAAAAAAAK+6AQI","startTime":1583965273,"statusCounts":{"200":1},"testErrors":{},"time":1583965260},{"duration":15,"endTime":1583965288,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAJvCAQI","startTime":1583965288,"statusCounts":{"200":1},"testErrors":{},"time":1583965275},{"duration":15,"endTime":1583965300,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAAf//8/8AAAAAAAAM+5AQI","startTime":1583965300,"statusCounts":{"200":1},"testErrors":{},"time":1583965290},{"duration":15,"endTime":1583965312,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAAf//8/8AAAAAAAAPu+AQI","startTime":1583965312,"statusCounts":{"200":1},"testErrors":{},"time":1583965305},{"duration":15,"endTime":1583965325,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfCAQI","startTime":1583965325,"statusCounts":{"200":1},"testErrors":{},"time":1583965320},{"duration":15,"endTime":1583965337,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAKnIAQI","startTime":1583965337,"statusCounts":{"200":1},"testErrors":{},"time":1583965335},{"duration":15,"endTime":1583965361,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAcAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAPfEAQK5BAI","startTime":1583965350,"statusCounts":{"200":2},"testErrors":{},"time":1583965350},{"duration":15,"endTime":1583965372,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAAf//8/8AAAAAAAANO4AQI","startTime":1583965372,"statusCounts":{"200":1},"testErrors":{},"time":1583965365},{"duration":15,"endTime":1583965385,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAJ/HAQI","startTime":1583965385,"statusCounts":{"200":1},"testErrors":{},"time":1583965380},{"duration":15,"endTime":1583965409,"requestTimeouts":0,"rttHistogram":"HISTEwAAAAcAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAAI/DAQLXAgI","startTime":1583965397,"statusCounts":{"200":2},"testErrors":{},"time":1583965395}]]],"testName":"DiscoveryWicfFamilyBeta"}`;

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
// Overlap region: t=1583956155 through t=1583956215.
// ============================================================================

// Agent 1 (early start): POST /token at t=1583956035, GET /family buckets through t=1583956215
const agentEarlyStart = "{\"buckets\":[[{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"https://ident.pewpew.org/oauth2/v3/token\"},[{\"duration\":60,\"endTime\":1583956094,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAA4AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAKV9AocCAucFAtsBAjkC\",\"startTime\":1583956035,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956035}]],[{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"https://beta.pewpew.org/service/family/*?generations=8\"},[{\"duration\":60,\"endTime\":1583956154,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956095,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956095},{\"duration\":60,\"endTime\":1583956214,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956155,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956155},{\"duration\":60,\"endTime\":1583956274,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956215,\"statusCounts\":{\"200\":4},\"testErrors\":{},\"time\":1583956215},{\"duration\":60,\"endTime\":1583956334,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956275,\"statusCounts\":{\"200\":6},\"testErrors\":{},\"time\":1583956275},{\"duration\":60,\"endTime\":1583956394,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956335,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956335}]]],\"testName\":\"DiscoveryWicfFamilyBeta\"}";

// Agent 2 (late start, ~2 min after agent 1): POST /token at t=1583956155, GET /family continues past agent 1
const agentLateStart = "{\"buckets\":[[{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"https://ident.pewpew.org/oauth2/v3/token\"},[{\"duration\":60,\"endTime\":1583956214,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAA4AAAAAAAAAAwAAAAAAAAABAAAAAAAD//8/8AAAAAAAAKV9AocCAucFAtsBAjkC\",\"startTime\":1583956155,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956155}]],[{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"https://beta.pewpew.org/service/family/*?generations=8\"},[{\"duration\":60,\"endTime\":1583956274,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956215,\"statusCounts\":{\"200\":4},\"testErrors\":{},\"time\":1583956215},{\"duration\":60,\"endTime\":1583956334,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956275,\"statusCounts\":{\"200\":5},\"testErrors\":{},\"time\":1583956275},{\"duration\":60,\"endTime\":1583956394,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956335,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956335},{\"duration\":60,\"endTime\":1583956454,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAA///8/8AAAAAAAALfPAQI\",\"startTime\":1583956395,\"statusCounts\":{\"200\":4},\"testErrors\":{},\"time\":1583956395},{\"duration\":60,\"endTime\":1583956514,\"requestTimeouts\":0,\"rttHistogram\":\"HISTEwAAAAQAAAAAAAAAAwAAAAAAAAABAAAAAAB///8/8AAAAAAAAJHRAQI\",\"startTime\":1583956455,\"statusCounts\":{\"200\":3},\"testErrors\":{},\"time\":1583956455}]]],\"testName\":\"DiscoveryWicfFamilyBeta\"}";

// ============================================================================
// No-overlap data (sequential runs 14 minutes apart — clearly different tests).
// Should trigger the overlap warning in the UI.
// ============================================================================

const sequentialRun1 = agentRun1;
const sequentialRun2 = discoveryData2; // unshifted — POST at 1583956905, well after run1's last bucket

export default {
  title: "TestResultsMerge"
};

export const NoFiles = () => (
  <React.Fragment>
    <GlobalStyle />
    <p>TestResultsMerge with fewer than 2 files renders nothing:</p>
    <TestResultsMerge fileTexts={[]} filenames={[]} />
  </React.Fragment>
);

NoFiles.storyName = "No Files (Empty State)";

export const MergeTwoAgents = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentRun1, agentRun2]}
      filenames={["agent-1.json", "agent-2.json"]}
    />
  </React.Fragment>
);

MergeTwoAgents.storyName = "Merge Two Concurrent Agents";

export const MergeThreeAgents = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentRun1, agentRun2, agentRun3]}
      filenames={["agent-1.json", "agent-2.json", "agent-3.json"]}
    />
  </React.Fragment>
);

MergeThreeAgents.storyName = "Merge Three Agent Runs (Multi-Agent)";

export const MergeStaggeredStart = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentEarlyStart, agentLateStart]}
      filenames={["agent-early.json", "agent-late.json"]}
    />
  </React.Fragment>
);

MergeStaggeredStart.storyName = "Staggered Agent Starts (+/- 2 min offset, partial overlap)";

export const MergeNoOverlap = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[sequentialRun1, sequentialRun2]}
      filenames={["run-19h47.json", "run-20h01.json"]}
    />
  </React.Fragment>
);

MergeNoOverlap.storyName = "No Overlap — Different Test Runs (Warning)";

export const MergeSameFileTwice = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={[agentRun1, agentRun1]}
      filenames={["agent-1.json", "agent-1-copy.json"]}
    />
  </React.Fragment>
);

MergeSameFileTwice.storyName = "Merge Same File Twice (Doubles All Counts)";

export const MergeDifferentEndpoints = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResultsMerge
      fileTexts={["{\"test\":\"integration\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"http://localhost:9001/\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAYAAAAAAAAAAwAAAAAAAAABAAAAAAAAD/8/8AAAAAAAAP8VAqkTAg\",\"statusCounts\":{\"200\":2}}}}", "{\"test\":\"int_on_demand\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"GET\",\"url\":\"http://localhost:9001\"}}{\"index\":1,\"tags\":{\"_id\":\"1\",\"method\":\"GET\",\"url\":\"http://localhost:9001?*\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAALkVAtkBAjkCEwI\",\"statusCounts\":{\"204\":4}},\"1\":{\"rttHistogram\":\"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAANUSAmsCvQECVQI\",\"statusCounts\":{\"204\":4}}}}"]}
      filenames={["integration.json", "int-on-demand.json"]}
    />
  </React.Fragment>
);

MergeDifferentEndpoints.storyName = "Merge Different Endpoints (Union)";
