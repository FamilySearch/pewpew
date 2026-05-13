vi.mock("@fs/hdr-histogram-wasm", () => ({ HDRHistogram: vi.fn() }));
vi.mock("chart.js", () => ({
  Chart: vi.fn(() => ({ destroy: vi.fn(), update: vi.fn(), data: { datasets: [] } }))
}));

import TestResults, { configureURL } from ".";
import { render, screen } from "@testing-library/react";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";

configureURL.baseS3Url = "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/";

describe("Test Result Component", () => {
  const noResult: TestData = {
    testId: "createtest20200424T191934978",
    s3Folder: "createtest/20200424T191934978",
    status: TestStatus.Unknown,
    startTime: 1587755974978,
    lastChecked: "2020-04-27T19:08:17.968Z"
  };

  it("should render No Results", () => {
    render(<TestResults testData={noResult} />);
    expect(screen.getByText("No Results Found")).toBeInTheDocument();
  });

  // The following unit tests are commented out until we figure out a way to load wasm with virtual dom.

  // it('should render Time Taken', async () => {
  //   const oneResult: TestData = {
  //     testId: "discoverywicffamilybeta20200311T221932362",
  //     s3Folder: "discoverywicffamilybeta/20200311T221932362",
  //     resultsFileLocation: [
  //       "https://ps-services-us-east-1-unittests-pewpewcontroller.s3.amazonaws.com/discoverywicffamilybeta/20200311T221932362/stats-discoverywicffamilybeta20200311T221932362.json"
  //     ],
  //     startTime: 1583965172953,
  //     status: TestStatus.Finished
  //   };
  //   const { getByText } = render(<TestResults testData={oneResult} />);
  //   return waitFor(() => getByText("Time Taken"));
  // });

  // it('should render Select Result File', async () => {
  //   const multipleResults: TestData = { ... };
  //   const { getByText } = render(<TestResults testData={multipleResults} />);
  //   return waitFor(() => getByText("Select Result File"));
  // });
});
