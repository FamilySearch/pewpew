import TestResults, { configureURL } from "../components/TestResults";
import React from "react";
import { TestData } from "../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { render } from "@testing-library/react";

// Will be used when we get wasm to load.
// import { testJsonResponse } from "./singleTestResult";

configureURL.baseS3Url = "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/";

// Will be used when we get wasm to load.
// let mockResponse = nock(configureURL.baseS3Url);

describe("Test Result Component", function () {
  const noResult: TestData = {
    testId: "createtest20200424T191934978",
    s3Folder: "createtest/20200424T191934978",
    status: TestStatus.Unknown,
    startTime: 1587755974978,
    lastChecked: "2020-04-27T19:08:17.968Z"
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const oneResult: TestData = {
    testId: "discoverywicffamilybeta20200311T221932362",
    s3Folder: "discoverywicffamilybeta/20200311T221932362",
    resultsFileLocation: [
      "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/discoverywicffamilybeta/20200311T221932362/stats-discoverywicffamilybeta20200311T221932362.json"
    ],
    startTime: 1583965172953,
    status: TestStatus.Finished
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const multipleResults: TestData = {
    testId: "discoverywicffamilybeta20200311T221932362",
    s3Folder: "discoverywicffamilybeta/20200311T221932362",
    resultsFileLocation: [
      "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/discoverywicffamilybeta/20200311T221932362/stats-discoverywicffamilybeta20200311T221932362.json",
      "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/discoverywicffamilybeta/20200311T200153210/stats-discoverywicffamilybeta20200311T200153210.json",
      "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/discoverywicffamilybeta/20200311T194618937/stats-discoverywicffamilybeta20200311T194618937.json"
    ],
    startTime: 1583965172953,
    status: TestStatus.Finished
  };

  it("should render No Results", function () {
    if (process.env.NODE_ENV === "test") {
      // jsdom-global/register doesn't play nice with our openId client we need for creating sessions.
      // integration and coverage tests don't have jsdom-global/register and set NODE_ENV to "test"
      this.skip();
      return;
    }
    const { getByText } = render(<TestResults testData={noResult} />);
    getByText("No Results Found");
  });

  // The following unit tests are commented out until we figure out a way to load wasm with virtual dom, in headless chrome or with Jest mocks.

  // it('should render Time Taken', async () => {
  //   mockResponse.get('/discoverywicffamilybeta/20200311T221932362/stats-discoverywicffamilybeta20200311T221932362.json')
  //   .reply(200, testJsonResponse);

  //   const { getByText } = render(<TestResults testData={oneResult} />);

  //   return waitFor(() =>
  //     getByText("Time Taken")
  //   );
  // });

  // it('should render Select Result File', async () => {
  //   mockResponse.get('/discoverywicffamilybeta/20200311T221932362/stats-discoverywicffamilybeta20200311T221932362.json')
  //   .reply(200, testJsonResponse);

  //   const { getByText } = render(<TestResults testData={multipleResults} />);

  //   return waitFor(() =>
  //     getByText("Select Result File")
  //   );
  // });

});
