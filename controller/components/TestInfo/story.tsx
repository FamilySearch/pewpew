import TestInfo, { TestInfoProps } from ".";
import { GlobalStyle } from "../Layout";
// Must reference the PpaasTestId file directly or we pull in stuff that won't compile on the client
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import React from "react";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { latestPewPewVersion } from "../../src/clientutil";

// This interface needs to match the one in index.tsx
interface TestInfoStorybookProps extends TestInfoProps {
  /** Export for storybook. DO NOT USE */
  message?: string;
  /** Export for storybook. DO NOT USE */
  messageId?: string;
  /** Export for storybook. DO NOT USE */
  killTest?: boolean;
  /** Export for storybook. DO NOT USE */
  downloadFiles?: string[];
  /** Export for storybook. DO NOT USE */
  error?: any;
}

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
let ppaasTestId: PpaasTestId;
try {
  ppaasTestId = PpaasTestId.makeTestId("Story");
} catch (error) { // eslint-disable-line  @typescript-eslint/no-unused-vars
  // For some reason newer versions of storybook do not have path.extname()
  ppaasTestId = PpaasTestId.getFromS3Folder("Story/" + PpaasTestId.getDateString());
}
const endTime = ppaasTestId.date.getTime() + 60000;
const basicTest: TestData = {
  testId: ppaasTestId.testId,
  s3Folder: ppaasTestId.s3Folder,
  resultsFileLocation: undefined,
  startTime: ppaasTestId.date.getTime(),
  status: TestStatus.Unknown
};
const fullTest: Required<TestData> = {
  testId: ppaasTestId.testId,
  s3Folder: ppaasTestId.s3Folder,
  resultsFileLocation: ["https://go.to.s3/path/to/results"],
  startTime: ppaasTestId.date.getTime(),
  endTime,
  status: TestStatus.Running,
  hostname: "pewpewagent-dev-app-1-2-3",
  instanceId: "i-abcdefg",
  ipAddress: "10.1.2.3",
  resultsFilename: ["results.json"],
  lastUpdated: new Date(Date.now() - 300000),
  lastChecked: new Date(Date.now() - 100000),
  errors: ["error1", "error2", "error3"],
  version: latestPewPewVersion,
  queueName: "unittest",
  userId: "bruno.madrigal@pewpew.org"
};
const props: TestInfoStorybookProps = {
  testData: { ...basicTest, status: TestStatus.Created, lastUpdated: fullTest.lastUpdated }
};

const propsWithRunTime: TestInfoStorybookProps = {
  testData: {
    ...basicTest,
    endTime,
    hostname: fullTest.hostname,
    status: TestStatus.Running,
    lastUpdated: new Date()
  }
};

const propsWithAgentInfo: TestInfoStorybookProps = {
  testData: { ...fullTest, resultsFileLocation: undefined }
};

const propsWithResults: TestInfoStorybookProps = {
  testData: { ...fullTest, status: TestStatus.Finished }
};

const propsWithMoreResults: TestInfoStorybookProps = {
  testData: {
    ...basicTest,
    resultsFileLocation: [
      ...fullTest.resultsFileLocation,
      "https://go.to.s3/path/to/results2",
      "https://go.to.s3/path/to/results3"
    ],
    status: TestStatus.Failed
  }
};

const propsWithDownloadFiles: TestInfoStorybookProps = {
  testData: {
    ...basicTest,
    status: TestStatus.Running,
    resultsFileLocation: [
      ...fullTest.resultsFileLocation
    ]
  },
  downloadFiles: [
    "Story.yaml",
    "Story.csv",
    "app-ppaas-pewpew-basicwithenv20250918T170447046-out.json",
    "app-ppaas-pewpew-basicwithenv20250918T170447046-error.json",
    "stats-basicwithenv20250918T170447046.json"
  ]
};

const propsWithStopSuccess: TestInfoStorybookProps = {
  testData: { ...basicTest, status: TestStatus.Running },
  killTest: true,
  message: "Stop TestId basic20191216T165541825 Message Sent.",
  messageId: "efaea50f-45d3-42a1-ab96-4e446f016b59"
};

const propsWithStopSuccessNoId: TestInfoStorybookProps = {
  testData: { ...basicTest, status: TestStatus.Running },
  message: "Stop Sent."
};

const propsWithStopError: TestInfoStorybookProps = {
  testData: { ...basicTest, status: TestStatus.Running },
  error: "Could not Send Message to Queue"
};

const scheduledProps: TestInfoStorybookProps = {
  testData: {
    ...basicTest,
    status: TestStatus.Scheduled,
    startTime: Date.now() - 600000,
    endTime: Date.now()
  }
};

const scheduledPastProps: TestInfoStorybookProps = {
  testData: {
    ...basicTest,
    status: TestStatus.Scheduled,
    startTime: Date.now() + 600000,
    endTime: Date.now() + 900000
  }
};

export default {
  title: "TestInfo"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestInfo {...props} />
  </React.Fragment>
);

export const WithEndTime = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithRunTime} />
    </React.Fragment>
  ),

  name: "WithEndTime"
};

export const WithAgentInfo = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithAgentInfo} />
    </React.Fragment>
  ),

  name: "WithAgentInfo"
};

export const WithResults = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithResults} />
    </React.Fragment>
  ),

  name: "WithResults"
};

export const WithMoreResults = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithMoreResults} />
    </React.Fragment>
  ),

  name: "WithMoreResults"
};

export const WithDownloadFiles = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithDownloadFiles} />
    </React.Fragment>
  ),

  name: "WithDownloadFiles"
};

export const WithSuccess = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithStopSuccess} />
    </React.Fragment>
  ),

  name: "WithSuccess"
};

export const WithSuccessNoId = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithStopSuccessNoId} />
    </React.Fragment>
  ),

  name: "WithSuccessNoId"
};

export const WithError = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <TestInfo {...propsWithStopError} />
    </React.Fragment>
  ),

  name: "WithError"
};

export const ScheduledPast = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestInfo {...scheduledProps} />
  </React.Fragment>
);

export const ScheduledFuture = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestInfo {...scheduledPastProps} />
  </React.Fragment>
);
