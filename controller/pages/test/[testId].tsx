import {
  API_ERROR_FORMAT,
  API_TEST_FORMAT,
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  TestData,
  TestDataResponse,
  TestManagerResponse
} from "../../types";
import { Danger, Warning } from "../../components/Alert";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { LogLevel, log } from "../../src/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import React, { JSX, useEffect, useState } from "react";
import axios, { AxiosError, AxiosResponse } from "axios";
import { formatError, formatPageHref } from "../../src/clientutil";
import Div from "../../components/Div";
import { H1 } from "../../components/Headers";
import { Layout } from "../../components/Layout";
import { TestInfo } from "../../components/TestInfo";
import { TestManager } from "../../src/testmanager";
import { TestResults } from "../../components/TestResults";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { authPage } from "../../src/authserver";
import styled from "styled-components";
import { useRouter } from "next/router";

const TEST_STATUS_REFRESH_DELAY: number = Number(process.env.TEST_STATUS_REFRESH_DELAY) || 10000;
const TEST_ERRORS_MAX_DISPLAYED: number = Number(process.env.TEST_ERRORS_MAX_DISPLAYED) || 20;
const TEST_ERRORS_MAX_LINE_LENGTH: number = Number(process.env.TEST_ERRORS_MAX_LINE_LENGTH) || 200;

const TestStatusDiv = styled(Div)`
  flex-flow: row wrap;
  flex: initial;
`;
const TestStatusSection = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;
const TestResultsContainer = styled.div`
  width: 100%;
  max-width: 1800px;
  margin: 0 auto;
  box-sizing: border-box;
`;

export interface TestStatusProps {
  testData: TestData | undefined;
  errorLoading: string | undefined;
  authPermission?: AuthPermission;
  resultsIndex?: number;
  compareTestId?: string;
}

export interface TestStatusState {
  pewpewStdErrors?: string[];
  pewpewStdErrorsTruncated?: boolean;
  pewpewStdErrorsRedirect?: boolean;
  error: string | undefined;
}

const TestStatusPage = ({
  testData,
  errorLoading,
  authPermission,
  resultsIndex: propsResultsIndex,
  compareTestId: propsCompareTestId
}: TestStatusProps) => {
  const defaultState: TestStatusState = {
    pewpewStdErrors: undefined,
    pewpewStdErrorsTruncated: undefined,
    pewpewStdErrorsRedirect: undefined,
    error: errorLoading
  };
  const [state, setFormData] = useState(defaultState);
  const setState = (newState: Partial<TestStatusState>) => setFormData((oldState: TestStatusState) => ({ ...oldState, ...newState}));
  const router = useRouter();

  const updateQuery = (changes: Record<string, string | undefined>): void => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(router.query)) {
      if (k === "testId") { continue; } // path param, not a query string param
      if (Array.isArray(v)) {
        v.forEach((val) => params.append(k, val));
      } else if (v !== undefined) {
        params.set(k, v);
      }
    }
    for (const [k, v] of Object.entries(changes)) {
      if (v !== undefined) {
        params.set(k, v);
      } else {
        params.delete(k);
      }
    }
    const queryStr = params.toString();
    const basePath = router.asPath.split("?")[0];
    const newUrl = queryStr ? `${basePath}?${queryStr}` : basePath;
    log("router.push in updateQuery", LogLevel.DEBUG, { newUrl, pathname: router.pathname, query: router.query, asPath: router.asPath });
    router.push(newUrl, formatPageHref(newUrl), { shallow: true }).catch((error: unknown) => log("router.push error", LogLevel.ERROR, error));
  };

  const handleResultsIndexChange = (index: number | undefined): void => {
    updateQuery({ results: index !== undefined ? String(index) : undefined });
  };

  const handleCompareTestIdChange = (testId: string | undefined): void => {
    updateQuery({ compare: testId });
  };

  const fetchData = async (testId: string) => {
    try {
      const url = formatPageHref(API_TEST_FORMAT(testId));
      const response: AxiosResponse = await axios.get(url);
      if (response.data === null || typeof response.data !== "object" || Array.isArray(response.data)) {
        const errorString = "GET /api/test did not return a TestData object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const newTestData: TestData = response.data;
      log("New testData", LogLevel.DEBUG, newTestData);
      if (testData) {
        Object.assign(testData, newTestData);
      } else {
        testData = newTestData;
      }
      setState({ error: undefined });
    } catch (error) {
      log("Error loading test data", LogLevel.WARN, error);
      setState({ error: formatError(error) });
    }
  };

  useEffect(() => {
    log("teststatus useEffect", LogLevel.DEBUG, { testData });
    if (testData && (testData.status === TestStatus.Created || testData.status === TestStatus.Running)) {
      const intervalId = setInterval(() => fetchData(testData!.testId), TEST_STATUS_REFRESH_DELAY);
      return () => clearInterval(intervalId);
    }
  }, [testData?.status]);

  useEffect(() => {
    log("console errors useEffect", LogLevel.DEBUG, testData?.s3Folder);
    if (testData?.status && (testData.status === TestStatus.Running || testData.status === TestStatus.Finished || testData.status === TestStatus.Failed)) {
      const url = formatPageHref(API_ERROR_FORMAT(testData.s3Folder));
      log("console errors url", LogLevel.DEBUG, url);
      axios.get(url).then((response: AxiosResponse) => {
        log("console error data response: " + response.status, LogLevel.DEBUG, response.statusText);
        let pewpewStdErrors: string[] | undefined;
        let pewpewStdErrorsTruncated: boolean | undefined;
        const pewpewErrorText: string | undefined = response.data;
        log("pewpewErrorText", LogLevel.DEBUG, { type: typeof pewpewErrorText, length: pewpewErrorText?.length });
        if (pewpewErrorText && pewpewErrorText.length > 0) {
          pewpewStdErrors = pewpewErrorText.split("\n").filter((line: string) => line);
          if (pewpewStdErrors.length > TEST_ERRORS_MAX_DISPLAYED) {
            pewpewStdErrors = pewpewStdErrors.slice(0, TEST_ERRORS_MAX_DISPLAYED);
            pewpewStdErrorsTruncated = true;
          }
          pewpewStdErrors = pewpewStdErrors.map((line: string) => {
            if (line.length > TEST_ERRORS_MAX_LINE_LENGTH) {
              pewpewStdErrorsTruncated = true;
              return line.substring(0, TEST_ERRORS_MAX_LINE_LENGTH) + " ...";
            }
            return line;
          });
          log("pewpewStdErrors", LogLevel.DEBUG, pewpewStdErrors.length);
          setState({
            pewpewStdErrors,
            pewpewStdErrorsTruncated,
            pewpewStdErrorsRedirect: undefined
          });
        } else {
          setState({
            pewpewStdErrors: undefined,
            pewpewStdErrorsTruncated: undefined,
            pewpewStdErrorsRedirect: undefined
          });
        }
      }).catch((error: unknown) => {
        log("Could not retrieve the console errors", LogLevel.WARN, error);
        setState({
          pewpewStdErrors: ["Could not retrieve the console errors:", formatError(error)],
          pewpewStdErrorsTruncated: true,
          pewpewStdErrorsRedirect: (error as AxiosError)?.isAxiosError
            ? (error as AxiosError).response?.status === 413
            : undefined
        });
      });
    } else {
      setState({ pewpewStdErrors: undefined, pewpewStdErrorsTruncated: undefined });
    }
  }, [testData?.testId]);

  let body: JSX.Element;
  if (testData) {
    body = <TestStatusSection>
      <TestStatusDiv>
        <TestStatusSection>
          <TestInfo testData={testData} />
        </TestStatusSection>
        {(testData.errors || state.pewpewStdErrors) && <TestStatusSection>
          {testData.errors && <Warning>
            <TestStatusSection>
            Errors during Test
            <ul>
              {testData.errors.map((error: string, index: number) => <li key={"error" + index}>{error}</li>)}
            </ul>
            </TestStatusSection>
          </Warning>}
          {state.pewpewStdErrors && <Warning>
            <TestStatusSection>
            Pewpew Console Standard Errors
            {state.pewpewStdErrorsTruncated && /** If pewpewStdErrors are truncated, link to full results */
              <a href={formatPageHref(API_ERROR_FORMAT(testData.s3Folder)) + (state.pewpewStdErrorsRedirect ? "?redirect" : "")} target="_blank">
                Errors Truncated - Click for full log
              </a>
            }
            <ul>
              {state.pewpewStdErrors.map((error: string, index: number) => <li key={"error" + index}>{error}</li>)}
            </ul>
            </TestStatusSection>
          </Warning>}
        </TestStatusSection>}
      </TestStatusDiv>
    </TestStatusSection>;
  } else {
    body = <Div>{errorLoading ? `Error: ${errorLoading}` : "Unknown Error"}</Div>;
  }

  const resultsStr = typeof router.query.results === "string" ? router.query.results : "";
  const resultsN = /^\d+$/.test(resultsStr) ? parseInt(resultsStr, 10) : NaN;
  const currentResultsIndex = router.isReady ? (isNaN(resultsN) ? undefined : resultsN) : propsResultsIndex;
  const currentCompareTestId = router.isReady ? (typeof router.query.compare === "string" ? router.query.compare : undefined) : propsCompareTestId;

  return (
    <Layout authPermission={authPermission}>
      <TestStatusSection>
        <H1>Check the Test Status</H1>
        <TestStatusDiv>
          {body}
        </TestStatusDiv>
        {state.error && <Danger>Error: {state.error}</Danger>}
      </TestStatusSection>
      {testData && <TestResultsContainer>
        <TestResults
          key={testData.testId}
          testData={testData}
          initialResultsIndex={currentResultsIndex}
          onResultsIndexChange={handleResultsIndexChange}
          initialCompareTestId={currentCompareTestId}
          onCompareTestIdChange={handleCompareTestIdChange}
        />
      </TestResultsContainer>}
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<TestStatusProps>> => {
  let authPermissions: AuthPermissions | string | undefined;
  try {
    authPermissions = await authPage(ctx, AuthPermission.ReadOnly);
    if (typeof authPermissions === "string") {
      return {
        redirect: {
          destination: authPermissions,
          permanent: false
        }
      };
    }

    const testId = ctx.params?.testId;
    if (!testId || Array.isArray(testId)) {
      return { redirect: { destination: "/", permanent: false } };
    }

    const testDataResponse: TestManagerResponse = await TestManager.getTest(testId);
    if (testDataResponse.status >= 300) {
      throw new Error((testDataResponse as ErrorResponse).json.message);
    }
    const testData: TestData = (testDataResponse as TestDataResponse).json;

    const resultsQueryStr = typeof ctx.query.results === "string" ? ctx.query.results : "";
    const resultsParam = /^\d+$/.test(resultsQueryStr) ? parseInt(resultsQueryStr, 10) : NaN;
    return {
      props: {
        testData,
        errorLoading: undefined,
        authPermission: authPermissions.authPermission,
        resultsIndex: !isNaN(resultsParam) ? resultsParam : undefined,
        compareTestId: typeof ctx.query.compare === "string" ? ctx.query.compare : undefined
      }
    };
  } catch (error) {
    const errorLoading = formatError(error);
    logServer(
      "TestStatusPage Error loading test data", LogLevelServer.WARN, error,
      typeof authPermissions === "string" ? authPermissions : authPermissions?.userId
    );
    return {
      props: { testData: undefined, errorLoading, authPermission: undefined }
    };
  }
};

export default TestStatusPage;
