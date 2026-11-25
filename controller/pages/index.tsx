import {
  API_SEARCH_FORMAT,
  AllTests,
  AllTestsResponse,
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  PAGE_TEST_STATUS_FORMAT,
  TestData,
  TestListResponse
} from "../types";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { H1, H3 } from "../components/Headers";
import { LogLevel, log } from "../src/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import React, { useEffect, useRef, useState } from "react";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref, isTestData } from "../src/clientutil";
import { Danger } from "../components/Alert";
import Div from "../components/Div";
import { Layout } from "../components/Layout";
import { TestManager } from "../src/testmanager";
import { TestsList } from "../components/TestsList";
import { authPage } from "../src/authserver";
import styled from "styled-components";
import { useRouter } from "next/router";

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

export interface TestHistoryProps {
  allTests: AllTests | undefined;
  testIdSearch?: string;
  searchTestResult?: TestData[];
  errorLoading: string | undefined;
  authPermission?: AuthPermission;
}

export interface TestHistoryState {
  testIdSearch: string;
  searchTestResult: TestData[] | undefined;
  error: string | undefined;
}

const noTestsFoundEror = (searchString: string, searchExtension?: string | string[]) =>
  `No s3Folders found starting with: "${searchString}"` + (searchExtension ? ` and extension ${JSON.stringify(searchExtension)}` : "");

const TestHistoryPage = ({
  allTests,
  errorLoading,
  authPermission,
  searchTestResult: propsSearchTestResult,
  testIdSearch: propsTestIdSearch
}: TestHistoryProps) => {
  let doubleClickCheck: boolean = false;
  const defaultState: TestHistoryState = {
    testIdSearch: propsTestIdSearch || "",
    searchTestResult: propsSearchTestResult,
    error: errorLoading
  };
  const [state, setFormData] = useState(defaultState);
  const setState = (newState: Partial<TestHistoryState>) => setFormData((oldState: TestHistoryState) => ({ ...oldState, ...newState}));
  const router = useRouter();
  // The search whose results are on screen (initially the server-rendered one) so the
  // ?search= effect only fetches when the URL actually moves to a different search
  const lastSearch = useRef<string | undefined>(propsTestIdSearch);
  // Incremented per fetch so a slow older response can't overwrite a newer one
  const searchCounter = useRef(0);

  const runSearch = async (searchString: string): Promise<void> => {
    lastSearch.current = searchString;
    const searchId = ++searchCounter.current;
    setState({ testIdSearch: searchString, searchTestResult: undefined, error: undefined });
    if (!SEARCH_REGEX.test(searchString)) {
      setState({ error: "Only Alphanumeric characters are allowed" });
      return;
    }
    try {
      const url = formatPageHref(API_SEARCH_FORMAT(searchString));
      const response: AxiosResponse = await axios.get(url);
      if (searchId !== searchCounter.current) { return; }
      if (response.status === 204) {
        setState({ error: noTestsFoundEror(searchString) });
        return;
      }
      if (!Array.isArray(response.data) || !(response.data as TestData[]).every((data) => isTestData(data))) {
        const errorString = "/api/search did not return a TestData array";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const searchTestResult: TestData[] = response.data;
      setState({ searchTestResult });
    } catch (error) {
      if (searchId !== searchCounter.current) { return; }
      log("Error searching for testId", LogLevel.ERROR, error);
      setState({ error: formatError(error) });
    }
  };

  // Keep the results in sync with ?search= so Back/Forward show results that match the search box
  useEffect(() => {
    const search: string | undefined = typeof router.query.search === "string" ? router.query.search : undefined;
    if (search === lastSearch.current) {
      return;
    }
    if (search === undefined) {
      lastSearch.current = undefined;
      searchCounter.current++; // Drop any in-flight search
      setState({ testIdSearch: "", searchTestResult: undefined, error: undefined });
      return;
    }
    runSearch(search).catch(() => { /* runSearch sets its own error state */ });
  }, [router.query.search]);

  let body: React.JSX.Element = <Div>Unknown Error</Div>;
  if (allTests) {
    body = <React.Fragment>
      <TestStatusSection data-testid="running-tests">
        <H3>Running Tests</H3>
        <TestsList tests={allTests.runningTests} />
      </TestStatusSection>
      <TestStatusSection data-testid="recently-run-tests">
        <H3>Recently Run Tests</H3>
        <TestsList tests={allTests.recentTests} />
      </TestStatusSection>
      <TestStatusSection data-testid="recently-viewed-tests">
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
    event.preventDefault();
    if (doubleClickCheck) {
      return;
    }
    try {
      doubleClickCheck = true;
      const searchString = state.testIdSearch;
      if (!SEARCH_REGEX.test(searchString)) {
        setState({
          searchTestResult: undefined,
          error: "Only Alphanumeric characters are allowed"
        });
        return;
      }
      if (router.query.search === searchString) {
        // Same URL, so the ?search= effect won't fire. Re-run the search directly.
        await runSearch(searchString);
        return;
      }
      // The ?search= effect runs the search once the URL changes
      const searchUrl = `${router.pathname}?search=${searchString}`;
      log("searchUrl", LogLevel.DEBUG, { searchUrl, pathname: router.pathname, asPath: router.asPath, query: router.query });
      await router.push(searchUrl, formatPageHref(searchUrl), { shallow: true });
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
        <TestStatusSection>
          <form onSubmit={onClickHandlerSubmit}>
            <label>Search for S3Folder: </label>
            <input type="text" name="testIdSearch" data-testid="search-input" value={state.testIdSearch} onChange={updateInputHandler} />
            <br/>(must be the start of the yaml file name)
          </form>
          {state.searchTestResult &&
          <div data-testid="search-results">
            <H3>Tests Found in S3</H3>
            <TestsList tests={state.searchTestResult} />
          </div>}
        </TestStatusSection>
        {state.error && <Danger>Error: {state.error}</Danger>}
      </TestStatusSection>
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<TestHistoryProps>> => {
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

    // Redirect old /?testId= links to the /teststatus page
    if (ctx.query?.testId && !Array.isArray(ctx.query.testId)) {
      const resultsStr = typeof ctx.query.results === "string" ? ctx.query.results : "";
      const notesStr = typeof ctx.query.notes === "string" ? ctx.query.notes : "";
      const destination = formatPageHref(PAGE_TEST_STATUS_FORMAT({
        testId: ctx.query.testId,
        results: /^\d+$/.test(resultsStr) ? parseInt(resultsStr, 10) : undefined,
        compare: typeof ctx.query.compare === "string" ? ctx.query.compare : undefined,
        notes: /^\d+$/.test(notesStr) ? parseInt(notesStr, 10) : undefined
      }));
      return { redirect: { destination, permanent: false } };
    }

    const allTestsResponse: AllTestsResponse = TestManager.getAllTest();
    const allTests: AllTests = allTestsResponse.json;
    let searchTestResult: TestData[] | undefined;
    let errorLoading: string | undefined;
    const searchString = typeof ctx.query?.search === "string" ? ctx.query.search : undefined;
    const searchExtension = ctx.query.extension;
    if (searchString || searchExtension) {
      const testManagerResponse: ErrorResponse | TestListResponse = await TestManager.searchTests(searchString, ctx.query.maxResults, searchExtension);
      if ("message" in testManagerResponse.json) {
        return {
          props: {
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
        allTests,
        errorLoading,
        testIdSearch: searchString,
        searchTestResult,
        authPermission: authPermissions.authPermission
      }
    };
  } catch (error) {
    const errorLoading = formatError(error);
    logServer(
      "TestHistoryPage Error loading", LogLevelServer.WARN, error,
      typeof authPermissions === "string" ? authPermissions : authPermissions?.userId
    );
    return {
      props: { allTests: undefined, errorLoading, authPermission: undefined }
    };
  }
};

export default TestHistoryPage;
