// Must reference the PpaasTestId file directly or we pull in stuff that won't compile on the client
import { API_TEST_STATUS, PAGE_TEST_HISTORY, TestData, TestManagerMessage } from "../../types";
import { LogLevel, log } from "../../src/log";
import React, { JSX, useEffect, useState } from "react";
import axios, { AxiosResponse } from "axios";
import { formatPageHref, isTestManagerMessage } from "../../src/clientutil";
import Div from "../Div";
import LinkButton from "../LinkButton";
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import styled from "styled-components";

const TestsDiv = styled(Div)`
  flex: initial;
`;

interface TestIdData {
  testData: TestData;
  ppaasTestId: PpaasTestId;
}

// What this returns or calls from the parents
export interface TestListProps {
  tests: TestData[];
}

// It's own data that will redraw the UI on changes
export interface TestListState {
  tests: TestData[];
  notFoundList: string[];
}

export const TestsList = ({
  tests
}: TestListProps) => {
  const defaultState: TestListState = {
    tests,
    notFoundList: []
  };
  const [state, setState] = useState(defaultState);

  const updateStatus = (testId: string, status: TestStatus) => setState((oldState: TestListState) => {
    const oldTests: TestData[] = oldState.tests;
    const testData = oldTests.find((eachTest) => eachTest.testId === testId);
    if (testData) {
      testData.status = status;
    }
    return { ...oldState, tests: oldTests };
  });
  useEffect(() => state.tests.forEach((testData: TestData, _index: number) => {
    const addToNotFound = (testId: string) => {
      // Add the testId to the not found list so we don't keep trying
      setState((oldState: TestListState) => {
        const { notFoundList, ...rest }: TestListState = oldState;
        if (!notFoundList.includes(testId)) { notFoundList.push(testId); }
        return { ...rest, notFoundList };
      });
      updateStatus(testId, TestStatus.Unknown);
    };
    // If we're unknown and haven't checked yet
    if (testData.status === TestStatus.Unknown && !state.notFoundList.includes(testData.testId)) {
      log("Checking " + testData.testId, LogLevel.DEBUG, { testData, notFoundList: state.notFoundList });
      updateStatus(testData.testId, TestStatus.Checking);
      axios.get(formatPageHref(API_TEST_STATUS + "?testId=" + testData.testId))
      .then((response: AxiosResponse) => {
        log("Checked " + testData.testId, LogLevel.DEBUG, { status: response.status, data: response.data });
        if (response.status === 200) {
          if (!isTestManagerMessage(response.data)) {
            const errorString = API_TEST_STATUS + " did not return a TestManagerMessage object";
            log(errorString, LogLevel.WARN, response.data);
            throw new Error(errorString);
          }
          const testManagerMessage: TestManagerMessage = response.data;
          if (testManagerMessage.message === `${TestStatus.Unknown}`) {
            addToNotFound(testData.testId);
          } else {
            updateStatus(testData.testId, testManagerMessage.message as TestStatus);
          }
        } else {
          addToNotFound(testData.testId);
        }
      }).catch((error) => {
        log("Error getting teststatus for testId " + testData.testId, LogLevel.WARN, error);
        addToNotFound(testData.testId);
      });
    }
  }), tests); // Only retrigger useEffect on new tests coming in, not changes to the current state.tests

  const additionalFileJsx: JSX.Element[] = tests
    .map((testData: TestData) => ({ testData, ppaasTestId: PpaasTestId.getFromTestId(testData.testId)}))
    .map((testIdData: TestIdData) => (
      <li key={testIdData.ppaasTestId.testId}>{testIdData.ppaasTestId.yamlFile} - {testIdData.ppaasTestId.date.toLocaleString()}&nbsp;
        <LinkButton name={testIdData.ppaasTestId.testId} href={PAGE_TEST_HISTORY + "?testId=" + testIdData.ppaasTestId.testId}>
          {testIdData.ppaasTestId.testId}
        </LinkButton> - {testIdData.testData.status}
      </li>
    ));
  return (
    <React.Fragment>
      {additionalFileJsx.length > 0 && <TestsDiv><ul>{additionalFileJsx}</ul></TestsDiv>}
    </React.Fragment>
  );
};

export default TestsList;
