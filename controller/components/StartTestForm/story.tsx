import "react-datepicker/dist/react-datepicker.css";
import "../../pages/styles.css";
import { AuthPermission, AuthPermissions, PreviousTestData } from "../../types";
import { ONE_WEEK, SIX_MONTHS, StartTestForm, StartTestProps, StartTestPropsStorybook } from ".";
import React, { useEffect, useState } from "react";
import { GlobalStyle } from "../Layout";
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import { QueueInitialProps } from "../TestQueues";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { VersionInitalProps } from "../PewPewVersions";
import { latestPewPewVersion } from "../../pages/api/util/clientutil";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */

const authPermissions: AuthPermissions = {
  authPermission: AuthPermission.User,
  token: "usertoken"
};
const authPermissionsAdmin: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admintoken"
};
const authPermissionsReadOnly: AuthPermissions = {
  authPermission: AuthPermission.ReadOnly,
  token: "readonlytoken"
};
const queueInitialPropsEmpty: QueueInitialProps = {
  queueName: "",
  loading: false,
  testQueues: {},
  error: true
};
const versionInitalPropsEmpty: VersionInitalProps = {
  pewpewVersion: "",
  loading: false,
  pewpewVersions: [],
  latestPewPewVersion: "unknown",
  error: true
};
const queueInitialProps: QueueInitialProps = {
  queueName: "",
  loading: false,
  testQueues: { unittest1: "unittest1", unittest2: "unittest2" },
  error: false
};
const versionInitalProps: VersionInitalProps = {
  pewpewVersion: "",
  loading: false,
  pewpewVersions: [latestPewPewVersion, "0.5.10", "0.5.11", "0.5.12"],
  latestPewPewVersion: "0.5.12",
  error: false
};
let ppaasTestId: PpaasTestId;
try {
  ppaasTestId = PpaasTestId.makeTestId("Story");
} catch (error) { // eslint-disable-line  @typescript-eslint/no-unused-vars
  // For some reason newer versions of storybook do not have path.extname()
  ppaasTestId = PpaasTestId.getFromS3Folder("Story/" + PpaasTestId.getDateString());
}
const previousTestDataBasic: PreviousTestData = {
  yamlFile: "test.yaml",
  additionalFiles: ["file1.txt", "file2.txt"],
  environmentVariables: {
    emptyVariable: "",
    hiddenVariable: null,
    populatedVariable: "populated",
    otherHidden: null,
    otherVariable: "other"
  },
  s3Folder: ppaasTestId.s3Folder,
  testId: ppaasTestId.testId,
  startTime: Date.now() - 60000,
  status: TestStatus.Finished
};
const previousTestData: PreviousTestData = {
  ...previousTestDataBasic,
  queueName: "unittest2",
  version: "0.5.11",
  restartOnFailure: true,
  bypassParser: true
};
const scheduleDate = Date.now() + 60000;
const previousTestDataRecurring: PreviousTestData = {
  ...previousTestDataBasic,
  daysOfWeek: [1, 3, 5],
  startTime: scheduleDate,
  scheduleDate,
  version: undefined,
  endDate: scheduleDate + SIX_MONTHS - ONE_WEEK,
  status: TestStatus.Scheduled
};

const previousTestDataRecurringMoreThan6Months: PreviousTestData = {
  ...previousTestDataRecurring,
  daysOfWeek: [0, 2, 4, 6],
  endDate: scheduleDate + SIX_MONTHS + ONE_WEEK
};

const props: StartTestProps = {
  queueInitialProps,
  versionInitalProps
};

const propsEmpty: StartTestProps = {
  queueInitialProps: queueInitialPropsEmpty,
  versionInitalProps: versionInitalPropsEmpty,
  error: "Could not load queues or versions"
};

export default {
  title: "StartTestForm"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <StartTestForm {...props} />
  </React.Fragment>
);

export const _User = () => (
  <React.Fragment>
    <GlobalStyle />
    <StartTestForm {...props} authPermissions={authPermissions} />
  </React.Fragment>
);

export const _Admin = () => (
  <React.Fragment>
    <GlobalStyle />
    <StartTestForm {...props} authPermissions={authPermissionsAdmin} />
  </React.Fragment>
);

export const _ReadOnly = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm
        {...props}
        authPermissions={{ ...authPermissionsReadOnly, userId: "bogus@pewpew.org" }}
      />
    </React.Fragment>
  ),

  name: "ReadOnly"
};

export const ScheduleDate = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm {...props} queryScheduleDate={Date.now()} />
    </React.Fragment>
  ),

  name: "ScheduleDate"
};

export const _PreviousTestData = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm {...props} previousTestData={previousTestData} />
    </React.Fragment>
  ),

  name: "PreviousTestData"
};

export const PreviousTestDataReadOnly = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm
        {...props}
        previousTestData={previousTestData}
        authPermissions={authPermissionsReadOnly}
      />
    </React.Fragment>
  ),

  name: "PreviousTestDataReadOnly"
};

export const PreviousTestDataRecurring = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm {...props} previousTestData={previousTestDataRecurring} />
    </React.Fragment>
  ),

  name: "PreviousTestDataRecurring"
};

export const RecurringSixMonths = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm {...props} previousTestData={previousTestDataRecurringMoreThan6Months} />
    </React.Fragment>
  ),

  name: "RecurringSixMonths"
};

export const EditSchedule = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm {...props} previousTestData={previousTestDataRecurring} editSchedule={true} />
    </React.Fragment>
  ),

  name: "EditSchedule"
};

const TestComponent: React.FC = () => {
  let timerId: NodeJS.Timeout;
  const [uploadProgressState, setUploadProgress] = useState(0);
  const stateProps: StartTestPropsStorybook = {
    ...props,
    uploading: true,
    uploadProgress: uploadProgressState,
    previousTestData
  };

  const increaseUpload = () => {
    setUploadProgress((prevState: number) => {
      // eslint-disable-next-line no-console
      console.log("prevState: " + prevState);
      const newState =
        prevState >= 100 ? 0 : Math.min(prevState + Math.round(Math.random() * 8), 100);
      timerId = setTimeout(
        () => {
          increaseUpload();
        },
        newState > 85 ? (newState > 99 ? 3000 : 1000) : 300
      );
      return newState;
    });
  };
  useEffect(() => {
    increaseUpload();
    return () => clearTimeout(timerId);
  }, [props, previousTestData]); // Can't include uploadProgressState or it messed it up.

  return (
    <React.Fragment>
      <GlobalStyle />
      <StartTestForm {...stateProps} />
    </React.Fragment>
  );
};

export const Uploading = () => <TestComponent />;

export const Error = () => (
  <React.Fragment>
    <GlobalStyle />
    <StartTestForm {...propsEmpty} />
  </React.Fragment>
);
