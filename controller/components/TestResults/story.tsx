import TestResults, { configureURL } from ".";
import { GlobalStyle } from "../Layout";
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import React from "react";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";

configureURL.baseS3Url = "/";

let ppaasTestId: PpaasTestId;
try {
  ppaasTestId = PpaasTestId.makeTestId("Story");
} catch (error) { // eslint-disable-line  @typescript-eslint/no-unused-vars
  // For some reason newer versions of storybook do not have path.extname()
  ppaasTestId = PpaasTestId.getFromS3Folder("Story/" + PpaasTestId.getDateString());
}

const noResults: TestData = {
  testId: ppaasTestId.testId,
  s3Folder: ppaasTestId.s3Folder,
  resultsFileLocation: undefined,
  startTime: ppaasTestId.date.getTime(),
  status: TestStatus.Unknown
};

const oneResult: TestData = {
  testId: "discoverywicffamilybeta20200311T221932362",
  s3Folder: "discoverywicffamilybeta/20200311T221932362",
  resultsFileLocation: ["test-results/stats-discoverywicffamilybeta20200311T221932362.json"],
  startTime: 1583965172953,
  status: TestStatus.Finished
};

const discoveryRun1: TestData = {
  testId: "discoverywicffamilybeta20200311T194618937",
  s3Folder: "discoverywicffamilybeta/20200311T194618937",
  resultsFileLocation: ["test-results/stats-discoverywicffamilybeta20200311T194618937.json"],
  startTime: 1583955978000,
  status: TestStatus.Finished
};

const discoveryRun2: TestData = {
  testId: "discoverywicffamilybeta20200311T200153210",
  s3Folder: "discoverywicffamilybeta/20200311T200153210",
  resultsFileLocation: ["test-results/stats-discoverywicffamilybeta20200311T200153210.json"],
  startTime: 1583956913000,
  status: TestStatus.Finished
};

// Concurrent agent versions — timestamps shifted so all three runs overlap
// (same shifts used in TestResultsMerge/story.tsx)
const agentRun2Concurrent: TestData = {
  testId: "discoverywicffamilybeta20200311T200153210",
  s3Folder: "discoverywicffamilybeta/20200311T200153210",
  resultsFileLocation: ["test-results/stats-discoverywicffamilybeta20200311T200153210-agent.json"],
  startTime: 1583956035000,
  status: TestStatus.Finished
};

const agentRun3Concurrent: TestData = {
  testId: "discoverywicffamilybeta20200311T221932362",
  s3Folder: "discoverywicffamilybeta/20200311T221932362",
  resultsFileLocation: ["test-results/stats-discoverywicffamilybeta20200311T221932362-agent.json"],
  startTime: 1583956035000,
  status: TestStatus.Finished
};

const multipleResults: TestData = {
  testId: "discoverywicffamilybeta20200311T221932362",
  s3Folder: "discoverywicffamilybeta/20200311T221932362",
  resultsFileLocation: [
    "test-results/stats-discoverywicffamilybeta20200311T221932362.json",
    "test-results/stats-discoverywicffamilybeta20200311T200153210.json",
    "test-results/stats-discoverywicffamilybeta20200311T194618937.json"
  ],
  startTime: 1583965172953,
  status: TestStatus.Finished
};

const permissionsResult: TestData = {
  testId: "rmsgetpermissionsdev20200527T190620783",
  s3Folder: "rmsgetpermissionsdev/20200527T190620783",
  resultsFileLocation: ["test-results/stats-rmsgetpermissionsdev20200527T190620783.json"],
  startTime: 1590606393699,
  status: TestStatus.Finished
};

const deepzoomResult: TestData = {
  testId: "deepzoomcloudtest20250630T180711861",
  s3Folder: "deepzoomcloudtest/20250630T180711861",
  resultsFileLocation: ["test-results/stats-deepzoomcloudtest20250630T180711861.json"],
  startTime: 1688139071861,
  status: TestStatus.Finished
};

const largeResult: TestData = {
  testId: "rmsallstage20220603T012101115",
  s3Folder: "rmsallstage/20220603T012101115",
  resultsFileLocation: ["test-results/stats-rmsallstage20220603T012101115.json"],
  startTime: 1654220825218,
  status: TestStatus.Finished
};

export default {
  title: "TestResults"
};

export const NoResults = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={noResults} />
  </React.Fragment>
);

export const _1Result = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={oneResult} />
  </React.Fragment>
);

export const _1ResultSelected = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={oneResult} initialResultsIndex={0} />
  </React.Fragment>
);

export const _1ResultSelectedWithCompare = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults
      testData={discoveryRun2}
      initialResultsIndex={0}
      initialCompareTestId={discoveryRun1.testId}
      initialCompareTestData={discoveryRun1}
    />
  </React.Fragment>
);

export const _1ResultSelectedWith1Merge = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults
      testData={discoveryRun1}
      initialResultsIndex={0}
      initialMergeTestIds={[agentRun2Concurrent.testId]}
      initialMergeTestData={[agentRun2Concurrent]}
    />
  </React.Fragment>
);

export const _1ResultSelectedWith2Merge = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults
      testData={discoveryRun1}
      initialResultsIndex={0}
      initialMergeTestIds={[agentRun2Concurrent.testId, agentRun3Concurrent.testId]}
      initialMergeTestData={[agentRun2Concurrent, agentRun3Concurrent]}
    />
  </React.Fragment>
);

export const MultipleResults = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={multipleResults} />
  </React.Fragment>
);

export const PermissionsResult = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={permissionsResult} />
  </React.Fragment>
);

export const DeepZoomResult = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={deepzoomResult} />
  </React.Fragment>
);

export const LargeResult = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults testData={largeResult} />
  </React.Fragment>
);
