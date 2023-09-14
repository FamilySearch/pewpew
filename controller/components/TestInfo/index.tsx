import {
  API_SCHEDULE,
  API_STOP,
  PAGE_CALENDAR,
  PAGE_START_TEST,
  PAGE_TEST_UPDATE,
  TestData,
  TestManagerMessage
} from "../../types";
import { Danger, Success } from "../Alert";
import { LogLevel, log } from "../../pages/api/util/log";
import React, { useState } from "react";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref, isTestManagerMessage } from "../../pages/api/util/clientutil";
import Div from "../Div";
import { H3 } from "../Headers";
import LinkButton from "../LinkButton";
// Must reference the PpaasTestId file directly or we pull in stuff that won't compile on the client
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import styled from "styled-components";
import { useRouter } from "next/router";

const pewpewDashboardBaseUrl: string = "https://familysearch.splunkcloud.com/en-US/app/QA/pewpew_dashboard?form.envSelector=";
const agentDashboardBaseUrl: string = "https://familysearch.splunkcloud.com/en-US/app/QA/pewpew_agent_dashboard?form.envSelector=";
const hostnameSearchBaseUrl: string = "https://familysearch.splunkcloud.com/en-US/app/QA/search?q=search%20index%3Dproduction%20host%3D";
const dashboardEarliestQuery: string = "&form.timeSelector.earliest=";
const dashboardLatestQuery: string = "&form.timeSelector.latest=";
const dashboardRefreshQuery: string = "&form.autoRefresh=1m";
const dashboardAgentQuery: string = "&form.agentSelector=";
const searchEarliestQuery: string = "&earliest=";
const searchLatestQuery: string = "&latest=";

const StopTestButton = styled.button`
  font-size: 1.25rem;
  color: red;
  width: 200px;
  height: 50px;
  text-align: center;
  margin: 10px;
`;

export interface TestInfoState {
  message: string | undefined;
  messageId: string | undefined;
  killTest: boolean | undefined;
  error: any;
}

// What this returns or calls from the parents
export interface TestInfoProps {
  testData: TestData;
  /** Export for storybook. DO NOT USE */
  message?: string;
  /** Export for storybook. DO NOT USE */
  messageId?: string;
  /** Export for storybook. DO NOT USE */
  killTest?: boolean;
  /** Export for storybook. DO NOT USE */
  error?: any;
}

export const TestInfo = ({ testData, ...testInfoProps }: TestInfoProps) => {
  let doubleClickCheck: boolean = false;
  // The default states coming in from props is only so we can storybook them.
  const defaultState: TestInfoState = {
    message: testInfoProps.message || undefined,
    messageId: testInfoProps.messageId || undefined,
    killTest : testInfoProps.killTest || undefined,
    error: testInfoProps.error || undefined
  };
  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<TestInfoState>) => setState((oldState: TestInfoState) => ({ ...oldState, ...newState}));
  const router = useRouter();

  /** Is our test in a created or running state */
  const testIsRunning: boolean = testData.status === TestStatus.Created || testData.status === TestStatus.Running;
  const testIsScheduled: boolean = testData.status === TestStatus.Scheduled && testData.startTime > Date.now();
  /** If we have a lastUpdated and it hasn't been updated in 3 minutes, color it red */
  const lastUpdatedStyle: React.CSSProperties = testIsRunning && testData.lastUpdated !== undefined
      && new Date(testData.lastUpdated).getTime() < (Date.now() - 3 * 60 * 1000)
      ? { color: "red" }
      : {};

  // Hostname fix for legacy tests, we're missing the -app
  if (testData.hostname &&  /^\w+-\w+-\d+-\d+-\d+$/.test(testData.hostname)) {
    const split = testData.hostname.split("-");
    split.splice(2, 0, "app");
    testData.hostname = split.join("-");
  }

  let testIdPlusTime: string = testData.testId;
  let hostnamePlusTime: string = testData.hostname || "";
  try {
    const ppaasTestId: PpaasTestId = PpaasTestId.getFromTestId(testData.testId);
    const startTime: number = Math.floor((testData.startTime || ppaasTestId.date.getTime()) / 1000);
    testIdPlusTime += dashboardEarliestQuery + startTime;
    hostnamePlusTime += searchEarliestQuery + startTime;
    if (testData.endTime) {
      const endTime: number = Math.floor((testData.endTime) / 1000);
      testIdPlusTime += dashboardLatestQuery + (endTime + 30); // 30 seconds for the data to upload to Splunk
      hostnamePlusTime += searchLatestQuery + endTime;
    }
  } catch (error) {
    log("Caught error parsing testId: " + testData.testId, LogLevel.ERROR, error);
  }
  if (testIsRunning) {
    testIdPlusTime += dashboardRefreshQuery;
  }
  const pewpewDashboard: string = pewpewDashboardBaseUrl + testIdPlusTime;
  const agentDashboard: string = agentDashboardBaseUrl + testIdPlusTime + (testData.hostname ? `${dashboardAgentQuery}${testData.hostname}` : "");
  const hostnameSearch: string = hostnameSearchBaseUrl + hostnamePlusTime;

  const onClick = async (event: React.MouseEvent<HTMLButtonElement>, deleteSchedule?: boolean) => {
    event.preventDefault();
    if (doubleClickCheck) {
      return;
    }
    // Save the current state of killTest and use it
    const killTest = state.killTest;
    const action: string = deleteSchedule ? "Delete" : (killTest ? "Kill" : "Stop");
    try {
      doubleClickCheck = true;
      updateState({
        message: undefined,
        messageId: undefined,
        error: undefined
      });
      let confirmPrompt: string = `Are you sure you want to ${action} this test?`;
      if (killTest) {
        confirmPrompt += `\n\nThis will IMMEDIATELY kill the test and no results will be logged.
Only do this if you are sure you want to lose all final data.
The previous "Stop" will automatically send a "Kill" after a few minutes if pewpew has not exited.`;
      }
      const confirm: boolean = window.confirm(confirmPrompt);
      if (!confirm) { return; }
      const response: AxiosResponse = deleteSchedule
        ? await axios.delete(formatPageHref(API_SCHEDULE + "?testId=" + testData.testId))
        : await axios.put(formatPageHref(`${API_STOP}?testId=${testData.testId}${killTest ? "&kill=true" : ""}`));
      if (!isTestManagerMessage(response.data)) {
        const errorString = (deleteSchedule ? API_SCHEDULE : API_STOP) + " did not return a TestManagerMessage object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const json: TestManagerMessage = response.data;
      updateState({
        message: json?.message || action + " Sent",
        messageId: json?.messageId,
        killTest: !deleteSchedule ? true : undefined, // Toggle killTest on after we click Stop
        error: undefined
      });
      // Clear the message after 30 seconds or it never goes away
      setTimeout(() => updateState({
        message: undefined,
        messageId: undefined
      }), 30000);
      if (deleteSchedule) {
        const deleteUrl: string = PAGE_CALENDAR +  "?defaultDate=" + testData.startTime;
        await router.push(deleteUrl, formatPageHref(deleteUrl));
      }
    } catch (error) {
      log("onClick error", LogLevel.ERROR, error);
      updateState({
        message: undefined,
        messageId: undefined,
        error: formatError(error)
      });
    } finally {
      doubleClickCheck = false;
    }
  };

  return (
    <React.Fragment>
      <Div>
        <H3>Test Information</H3>
      </Div>
      <Div>
        <ul>
          <li key="startTime">Start Time: {new Date(testData.startTime).toLocaleString()}</li>
          {testData.endTime && <li key="endTime">End Time: {new Date(testData.endTime).toLocaleString()}</li>}
          <li key="testId">TestId: {testData.testId}</li>
          <li key="s3Folder">S3 Folder: {testData.s3Folder}</li>
          {testData.instanceId && <li key="instanceId">InstanceId: {testData.instanceId}</li>}
          {testData.hostname && <li key="hostname">Hostname: <a href={hostnameSearch} target="_blank">{testData.hostname}</a></li>}
          {testData.ipAddress && <li key="ipAddress">IPAddress: {testData.ipAddress}</li>}
          {testData.queueName && <li key="queueName">Test Queue: {testData.queueName}</li>}
          {testData.version && <li key="version">Pewpew Version: {testData.version}</li>}
          {testData.userId && <li key="userId">UserId: <a href={`mailto:${testData.userId}`} >{testData.userId}</a></li>}
          {testData.resultsFileLocation && testData.resultsFileLocation.map((resultsLocation: string, index: number) =>
            <li key={"resultsFileLocation" + index}><a href={resultsLocation} target="_blank">S3 Results Url{index > 0 ? ` ${index + 1}` : ""}</a></li>)}
          <li key="pewpewDashboard"><a href={pewpewDashboard} target="_blank">PewPew Dashboard</a></li>
          <li key="agentDashboard"><a href={agentDashboard} target="_blank">PewPew Agent Dashboard</a></li>
          <li key="testStatus">Status: {testData.status === TestStatus.Created ? "Test Uploaded, Waiting for Agent" : testData.status}</li>
          {testData.lastUpdated && <li key="lastUpdated" style={lastUpdatedStyle}>Last Updated: {new Date(testData.lastUpdated).toLocaleString()}</li>}
        </ul>
      </Div>
      <Div>
      <LinkButton theme={{ buttonFontSize: "1.25rem", buttonWidth: "200px", buttonHeight: "50px", buttonMargin: "10px" }} href={PAGE_START_TEST + "?testId=" + testData.testId}>Rerun Test</LinkButton>
      {(testIsRunning || testIsScheduled) && <>
        <LinkButton theme={{ buttonFontSize: "1.25rem", buttonWidth: "200px", buttonHeight: "50px", buttonMargin: "10px" }} href={PAGE_TEST_UPDATE + "?testId=" + testData.testId}>Update Yaml File</LinkButton>
        {testIsRunning && <StopTestButton onClick={onClick} value={testData.testId}>{state.killTest ? "Kill" : "Stop"} Test</StopTestButton>}
        {testIsScheduled && <StopTestButton onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => onClick(e, true)} value={testData.testId}>Delete Schedule</StopTestButton>}
      </>}
      </Div>
      {state.message && <Success>{state.message}{state.messageId && <><br/>MessageId: {state.messageId}</>}</Success>}
      {state.error && <Danger>Error: {state.error}</Danger>}
    </React.Fragment>
  );
};

export default TestInfo;
