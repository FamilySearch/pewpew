/* eslint-disable no-console */
// Must reference the PpaasTestId file directly or we pull in stuff that won't compile on the client
import TestsList, { TestListProps } from ".";
import { GlobalStyle } from "../Layout";
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import React from "react";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: TestListProps = {
  tests: []
};
let counter = 0;
const makeTestData = (status: TestStatus): TestData => {
  counter++;
  const date: Date = new Date();
  date.setTime(date.getTime() - counter * 235 * 60000);
  let ppaasTestId: PpaasTestId;
  try {
    ppaasTestId = PpaasTestId.makeTestId("Story" + counter, {
      dateString: PpaasTestId.getDateString(date)
    });
  } catch (error) { // eslint-disable-line  @typescript-eslint/no-unused-vars
    // For some reason newer versions of storybook do not have path.extname()
    ppaasTestId = PpaasTestId.getFromS3Folder(`Story${counter}/` + PpaasTestId.getDateString(date));
  }
  const basicTest: TestData = {
    testId: ppaasTestId.testId,
    s3Folder: ppaasTestId.s3Folder,
    startTime: ppaasTestId.date.getTime(),
    status,
    resultsFileLocation: [""]
  };
  return basicTest;
};
const propsLoaded: TestListProps = {
  ...props,
  tests: Object.values(TestStatus).map((status: string) => makeTestData(status as TestStatus))
};

export default {
  title: "TestsList"
};

export const Empty = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestsList {...props} />
  </React.Fragment>
);

export const Loaded = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestsList {...propsLoaded} />
  </React.Fragment>
);

export const OnClick = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestsList {...propsLoaded} onClick={(_event, testData) => console.log("Clicked test:", testData.testId)} />
  </React.Fragment>
);
