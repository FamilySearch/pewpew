import {
  API_ERROR_FORMAT,
  API_SEARCH,
  API_TEST,
  AllTests,
  AllTestsResponse,
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  TestData,
  TestDataResponse,
  TestListResponse,
  TestManagerResponse
} from "../types";
import { Danger, Warning } from "../components/Alert";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { H1, H3 } from "../components/Headers";
import { LogLevel, log } from "./api/util/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import React, { useEffect, useState } from "react";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref, isTestData } from "./api/util/clientutil";
import Div from "../components/Div";
import { Layout } from "../components/Layout";
// Must reference the PpaasTestId file directly or we pull in stuff that won't compile on the client
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import { TestInfo } from "../components/TestInfo";
import { TestManager } from "./api/util/testmanager";
import { TestResults } from "../components/TestResults";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { TestsList } from "../components/TestsList";
import { authPage } from "./api/util/authserver";
import getConfig from "next/config";
import { getPewPewErrors } from "./api/error/[yamlFile]/[dateString]";
import styled from "styled-components";
import { useRouter } from "next/router";

// Have to check for null on this since the tsc test compile it will be, but nextjs will have a publicRuntimeConfig
const publicRuntimeConfig: any = getConfig() && getConfig().publicRuntimeConfig ? getConfig().publicRuntimeConfig : {};
const TEST_STATUS_REFRESH_DELAY: number = Number(publicRuntimeConfig.TEST_STATUS_REFRESH_DELAY) || 10000;
const TEST_ERRORS_MAX_DISPLAYED: number = Number(publicRuntimeConfig.TEST_ERRORS_MAX_DISPLAYED) || 20;
const TEST_ERRORS_MAX_LINE_LENGTH: number = Number(publicRuntimeConfig.TEST_ERRORS_MAX_LINE_LENGTH) || 200;
const SEARCH_REGEX: RegExp = /^[\w\d/]*$/;

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

// What this returns or calls from the parents
export interface TestStatusProps {
  testData: TestData | undefined;
  pewpewStdErrors?: string[];
  pewpewStdErrorsTruncated?: boolean;
  allTests: AllTests | undefined;
  testIdSearch?: string;
  searchTestResult?: TestData[];
  errorLoading: string | undefined;
  authPermission?: AuthPermission;
}

// It's own data that will redraw the UI on changes
export interface TestStatusState {
  testIdSearch: string;
  searchTestResult: TestData[] | undefined;
  error: string | undefined;
}

const noTestsFoundEror = (searchString: string, searchExtension?: string | string[]) =>
  `No s3Folders found starting with: "${searchString}"` + (searchExtension ? ` and extension ${JSON.stringify(searchExtension)}` : "");

const TestStatusPage = ({
  testData,
  pewpewStdErrors,
  pewpewStdErrorsTruncated,
  allTests,
  errorLoading,
  authPermission,
  searchTestResult: propsSearchTestResult,
  testIdSearch: propsTestIdSearch
}: TestStatusProps) => {
  let doubleClickCheck: boolean = false;
  const defaultState: TestStatusState = {
    testIdSearch: propsTestIdSearch || "",
    searchTestResult: propsSearchTestResult,
    error: errorLoading
  };
  const [state, setFormData] = useState(defaultState);
  const setState = (newState: Partial<TestStatusState>) => setFormData((oldState: TestStatusState) => ({ ...oldState, ...newState}));
  const router = useRouter();
  const fetchData = async (testId: string) => {
    try {
      const url = formatPageHref(`${API_TEST}?testId=${testId}`);
      // If we're client-side the cookie gets passed automatically
      const response: AxiosResponse = await axios.get(url);
      // Convert it to json
      if (!isTestData(response.data)) {
        const errorString = API_TEST + " did not return a TestData object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const newTestData: TestData = response.data;
      log("New testData", LogLevel.DEBUG, newTestData);
      if (testData) {
        Object.assign(testData, newTestData); // Assign to overwrite the current data since it's not state
      } else {
        testData = newTestData;
      }
      setState({ error: undefined }); // Force a redraw
    } catch (error) {
      log("Error loading test data", LogLevel.WARN, error);
      setState({ error: formatError(error) });
    }
  };

  // The "if" must be inside the useEffect or when we transition from running to finished we'll get this error:
  // Uncaught Error: Rendered fewer hooks than expected. This may be caused by an accidental early return statement.
  // We have to maintain the same number of hooks on a redraw
  useEffect(() => {
    log("teststatus useEffect", LogLevel.DEBUG, { testData });
    if (testData && (testData.status === TestStatus.Created || testData.status === TestStatus.Running)) {
      const intervalId = setInterval(() => fetchData(testData!.testId), TEST_STATUS_REFRESH_DELAY);
      // This clears the setInterval hook on redraw or client side navigate
      return () => clearInterval(intervalId);
    }
  }, [testData?.status]);

  let body: JSX.Element = <Div>Unknown Error</Div>;
  if (testData) {
    body = <TestStatusSection>
      <TestStatusDiv>
        <TestStatusSection>
          <TestInfo testData={testData} />
        </TestStatusSection>
        {(testData.errors || pewpewStdErrors) && <TestStatusSection>
          {testData.errors && <Warning>
            <TestStatusSection>
            Errors during Test
            <ul>
              {testData.errors.map((error: string, index: number) => <li key={"error" + index}>{error}</li>)}
            </ul>
            </TestStatusSection>
          </Warning>}
          {pewpewStdErrors && <Warning>
            <TestStatusSection>
            Pewpew Console Standard Errors
            {pewpewStdErrorsTruncated && /** If pewpewStdErrors are truncated, link to full results */
              <a href={formatPageHref(API_ERROR_FORMAT(testData.s3Folder))} target="_blank">Errors Truncated - Click for full log</a>
            }
            <ul>
              {pewpewStdErrors.map((error: string, index: number) => <li key={"error" + index}>{error}</li>)}
            </ul>
            </TestStatusSection>
          </Warning>}
        </TestStatusSection>}
      </TestStatusDiv>
    </TestStatusSection>;
  } else if (allTests) {
    body = <React.Fragment>
      <TestStatusSection>
        <H3>Running Tests</H3>
        <TestsList tests={allTests.runningTests} />
      </TestStatusSection>
      <TestStatusSection>
        <H3>Recently Run Tests</H3>
        <TestsList tests={allTests.recentTests} />
      </TestStatusSection>
      <TestStatusSection>
        <H3>Recently Viewed Tests</H3>
        <TestsList tests={allTests.requestedTests} />
      </TestStatusSection>
    </React.Fragment>;
  } else if (errorLoading) {
    body = <Div>Error: {errorLoading}</Div>;
  }

  const updateInputHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input: HTMLInputElement = event.target as HTMLInputElement;

    if (input.name === "testIdSearch") {
      setState({ testIdSearch: input.value, error: undefined });
    }
  };

  const onClickHandlerSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    if (doubleClickCheck) {
      return;
    }
    try {
      doubleClickCheck = true;
      event.preventDefault();
      setState({
        searchTestResult: undefined,
        error: undefined
      });
      // Sanitized the search
      const searchString = state.testIdSearch;
      // eslint-disable-next-line no-useless-escape
      if (!SEARCH_REGEX.test(searchString)) {
        setState({
          error: "Only Alphanumeric characters are allowed"
        });
        return;
      }
      // PUT /api/search - Don't include the extension here. Only on page loads
      const url = formatPageHref(`${API_SEARCH}?s3Folder=${searchString}`);
      const response: AxiosResponse = await axios.get(url);
      // Update the URL to include the search param `?search=${searchString}`
      const searchUrl = `${router.pathname}?search=${searchString}`;
      log("searchUrl", LogLevel.DEBUG, { searchUrl, pathname: router.pathname, asPath: router.asPath, query: router.query });
      router.push(searchUrl, formatPageHref(searchUrl), { shallow: true });
      if (response.status === 204) {
        // No test results found
        setState({
          error: noTestsFoundEror(searchString)
        });
        return;
      }
      // Convert it to json
      if (!Array.isArray(response.data) || !(response.data as TestData[]).every((data) => isTestData(data))) {
        const errorString = API_TEST + " did not return a TestData array";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const searchTestResult: TestData[] = response.data;
      setState({
        searchTestResult
      });
    } catch (error) {
      log("Error searching for testId", LogLevel.ERROR, error);
      setState({
        error: formatError(error)
      });
    } finally {
      doubleClickCheck = false;
    }
  };

  return (
    <Layout authPermission={authPermission}>
      <TestStatusSection>
        <H1>Check the Test Status</H1>
        <TestStatusDiv>
          {body}
        </TestStatusDiv>
        {!testData && <TestStatusSection>
          <form onSubmit={onClickHandlerSubmit}>
            <label>Search for S3Folder: </label>
            <input type="text" name="testIdSearch" value={state.testIdSearch} onChange={updateInputHandler} />
            <br/>(must be the start of the yaml file name)
          </form>
          {state.searchTestResult &&
          <>
            <H3>Tests Found in S3</H3>
            <TestsList tests={state.searchTestResult} />
          </>}
        </TestStatusSection>}
        {state.error && <Danger>Error: {state.error}</Danger>}
      </TestStatusSection>
      {testData && <TestResults testData={testData} />}
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<TestStatusProps>> => {
  let authPermissions: AuthPermissions | string | undefined;
  try {
    // Authenticate
    authPermissions = await authPage(ctx, AuthPermission.ReadOnly);
    // If we have a authPermissions we're authorized, if we're not, we'l redirect
    if (typeof authPermissions === "string") {
      return {
        redirect: {
          destination: authPermissions,
          permanent: false
        },
        props: {
          testData: undefined,
          allTests: undefined,
          errorLoading: "No permissions"
         }
      };
    }

    // If we get more than one testId, just return all, don't try to pick one
    if (ctx.query?.testId && !Array.isArray(ctx.query.testId)) {
      const testId: string = ctx.query.testId;
      let ppaasTestId: PpaasTestId;
      try {
        ppaasTestId = PpaasTestId.getFromTestId(testId);
      } catch (error) {
        logServer(`Could not parse ${testId} into a PpaasTestId`, LogLevelServer.ERROR, error);
        throw error;
      }
      // If we're client-side the cookie gets passed. Server side it doesn't
      const testDataResponse: TestManagerResponse = await TestManager.getTest(testId);
      if (testDataResponse.status >= 300) {
        throw new Error((testDataResponse as ErrorResponse).json.message);
      }
      // Convert it to json
      const testData: TestData = (testDataResponse as TestDataResponse).json;

      // If we're client-side the cookie gets passed. Server side it doesn't
      let pewpewStdErrors: string[] | undefined;
      let pewpewStdErrorsTruncated: boolean | undefined;
      // Get the text contents
      const { yamlFile, dateString } = ppaasTestId;
      const pewpewErrorText: string | undefined = await getPewPewErrors({ yamlFile, dateString });
      logServer("pewpewErrorText", LogLevelServer.DEBUG, pewpewErrorText);
      if (pewpewErrorText && pewpewErrorText.length > 0) {
        // Split and remove empty lines
        pewpewStdErrors = pewpewErrorText.split("\n").filter((line: string) => line);
        // https://fhjira.churchofjesuschrist.org/browse/SYSTEST-1115
        if (pewpewStdErrors.length > TEST_ERRORS_MAX_DISPLAYED) {
          // Cap this at TEST_ERRORS_MAX_DISPLAYED length
          pewpewStdErrors = pewpewStdErrors.slice(0, TEST_ERRORS_MAX_DISPLAYED);
          // Set as truncated
          pewpewStdErrorsTruncated = true;
        }
        // Truncate line length
        pewpewStdErrors = pewpewStdErrors.map((line: string) => {
          if (line.length > TEST_ERRORS_MAX_LINE_LENGTH) {
            pewpewStdErrorsTruncated = true;
            return line.substring(0, TEST_ERRORS_MAX_LINE_LENGTH) + " ...";
          }
          return line;
        });
        logServer("pewpewStdErrors", LogLevelServer.DEBUG, pewpewStdErrors);
      }

      // if (testData.status === TestStatus.Scheduled)
      return {
        props: {
          testData,
          pewpewStdErrors,
          pewpewStdErrorsTruncated,
          allTests: undefined,
          errorLoading: undefined,
          authPermission: authPermissions.authPermission
        }
      };
    } else {
      const allTestsResponse: AllTestsResponse = TestManager.getAllTest();
      const allTests: AllTests = allTestsResponse.json;
      let searchTestResult: TestData[] | undefined;
      let errorLoading: string | undefined;
      const searchString = typeof ctx.query?.search === "string" ? ctx.query.search : undefined;
      const searchExtension = ctx.query.extension;
      if (searchString || searchExtension) {
        // Check for search param and do search
        const testManagerResponse: ErrorResponse | TestListResponse = await TestManager.searchTests(searchString, ctx.query.maxResults, searchExtension);
        if ("message" in testManagerResponse.json) {
          return {
            props: {
              testData: undefined,
              allTests,
              errorLoading: testManagerResponse.json.message,
              searchTestResult,
              authPermission: authPermissions.authPermission
            }
          };
        }
        searchTestResult = testManagerResponse.json;
        if (searchTestResult.length === 0) {
          searchTestResult = undefined;
          errorLoading = noTestsFoundEror(searchString || "", searchExtension);
        }
      }
      return {
        props: {
          testData: undefined,
          allTests,
          errorLoading,
          testIdSearch: searchString,
          searchTestResult,
          authPermission: authPermissions.authPermission
        }
      };
    }
  } catch (error) {
    const errorLoading = formatError(error);
    logServer(
      "TestStatusPage Error loading test data", LogLevelServer.WARN, error,
      typeof authPermissions === "string" ? authPermissions : authPermissions?.userId
    );
    return {
      props: { testData: undefined, allTests: undefined, errorLoading, authPermission: undefined }
    };
  }
};

export default TestStatusPage;
