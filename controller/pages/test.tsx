import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  PreviousTestData,
  PreviousTestDataResponse
} from "../types";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import { StartTestForm, StartTestProps } from "../components/StartTestForm";
import Layout from "../components/Layout";
import { QueueInitialProps } from "../components/TestQueues";
import React from "react";
import { TestManager } from "./api/util/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { VersionInitalProps } from "../components/PewPewVersions";
import { authPage } from "./api/util/authserver";
import { formatError } from "./api/util/clientutil";
import { getServerSideProps as getPropsPewPewVersions } from "../components/PewPewVersions/initialProps";
import { getServerSideProps as getPropsTestQueues } from "../components/TestQueues/initialProps";

export interface StartTestPageProps extends StartTestProps {
  formKey: string | number;
}

const StartNewTest = (props: StartTestPageProps) => {
  const authPermission: AuthPermission | undefined = props.authPermissions?.authPermission;

  return (
    <Layout authPermission={authPermission}>
      <StartTestForm
        { ...props }
        key={props.formKey}
      />
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<StartTestPageProps>> => {
  let authPermissions: AuthPermissions | string | undefined;
  let queueInitialProps: QueueInitialProps = { queueName: "", loading: false, testQueues: {}, error: true };
  let versionInitalProps: VersionInitalProps = { pewpewVersion: "", loading: false, pewpewVersions: [], error: true };
  let queryScheduleDate: number | undefined;
  let previousTestData: PreviousTestData | undefined;
  let editSchedule: boolean | undefined;
  try {
    // Authenticate
    authPermissions = await authPage(ctx, AuthPermission.ReadOnly);
    // If we have a authPermissions we're authorized, if we're not, we'll redirect
    if (typeof authPermissions === "string") {
      return {
        redirect: {
          destination: authPermissions,
          permanent: false
        },
        props: {
          formKey: Date.now(),
          queueInitialProps,
          versionInitalProps
        }
      };
    }

    queueInitialProps = getPropsTestQueues();
    versionInitalProps = await getPropsPewPewVersions();

    if (ctx.query.scheduleDate && !Array.isArray(ctx.query.scheduleDate)) {
      try {
        // If it's a timestamp we have to parse it into a number before passing it to new Date()
        const numberDate =  Number(ctx.query.scheduleDate);
        const scheduleDate = new Date(isNaN(numberDate) ? ctx.query.scheduleDate : numberDate);
        if (!isNaN(scheduleDate.getTime())) {
          queryScheduleDate = scheduleDate.getTime();
        }
      } catch (error) {
        logServer("Error parsing date", LogLevelServer.ERROR, error);
        queryScheduleDate = undefined;
      }
    }

    if (ctx.query.testId && !Array.isArray(ctx.query.testId)) {

      // If we get more than one testId, just return all, don't try to pick one
      const testId: string = ctx.query.testId;
      const previousTestDataResponse: ErrorResponse | PreviousTestDataResponse = await TestManager.getPreviousTestData(testId);
      if (previousTestDataResponse.status > 300) {
        throw new Error((previousTestDataResponse as ErrorResponse).json.message);
      }
      previousTestData = (previousTestDataResponse as PreviousTestDataResponse).json;
      editSchedule = ctx.query["edit"] !== undefined && previousTestData?.status === TestStatus.Scheduled;
    }

    const formKey = (previousTestData?.testId
        ? previousTestData?.testId + editSchedule
        : undefined)
      || queryScheduleDate
      || Date.now();
    return {
      props: {
        formKey,
        queueInitialProps,
        versionInitalProps,
        authPermissions,
        queryScheduleDate,
        previousTestData,
        editSchedule
      }
    };
  } catch (error) {
    logServer("Error loading previousTestData, queues, or versions", LogLevelServer.ERROR, error);
    return {
      props: {
        formKey: Date.now(),
        error: `Error loading data: ${formatError(error)}`,
        authPermissions: typeof authPermissions === "string" ? undefined : authPermissions,
        queueInitialProps,
        versionInitalProps,
        queryScheduleDate,
        previousTestData
      }
    };
  }
};

export default StartNewTest;
