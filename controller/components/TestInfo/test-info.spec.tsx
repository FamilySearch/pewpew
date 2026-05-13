vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: "/", query: {} }) }));

import { render, screen } from "@testing-library/react";
import React from "react";
import { TestData } from "../../types";
import TestInfo from ".";
import { TestStatus } from "@fs/ppaas-common/dist/types";

const baseTestData: TestData = {
  testId: "unittest20240115T120000000",
  s3Folder: "unittest/20240115T120000000",
  status: TestStatus.Finished,
  startTime: new Date("2024-01-15T12:00:00Z").getTime(),
  lastChecked: "2024-01-15T13:00:00Z"
};

describe("TestInfo Component", () => {
  it("renders testId", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.getByText(/unittest20240115T120000000/)).toBeInTheDocument();
  });

  it("renders start time", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.getByText(/Start Time:/)).toBeInTheDocument();
  });

  it("renders status", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.getByText(/Status:/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TestStatus.Finished))).toBeInTheDocument();
  });

  it("renders the Test Information heading", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.getByText("Test Information")).toBeInTheDocument();
  });

  it("renders Rerun Test button for any status", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.getByText("Rerun Test")).toBeInTheDocument();
  });

  it("renders Stop Test button when test is Running", () => {
    const runningTest: TestData = { ...baseTestData, status: TestStatus.Running };
    render(<TestInfo testData={runningTest} />);
    expect(screen.getByText("Stop Test")).toBeInTheDocument();
  });

  it("renders Kill Test button text after stop is clicked (via storybook prop)", () => {
    const runningTest: TestData = { ...baseTestData, status: TestStatus.Running };
    render(<TestInfo testData={runningTest} killTest={true} />);
    expect(screen.getByText("Kill Test")).toBeInTheDocument();
  });

  it("does not render Stop button when test is Finished", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.queryByText("Stop Test")).not.toBeInTheDocument();
    expect(screen.queryByText("Kill Test")).not.toBeInTheDocument();
  });

  it("renders Delete Schedule button when test is Scheduled", () => {
    const futureTime = Date.now() + 60 * 60 * 1000;
    const scheduledTest: TestData = { ...baseTestData, status: TestStatus.Scheduled, startTime: futureTime };
    render(<TestInfo testData={scheduledTest} />);
    expect(screen.getByText("Delete Schedule")).toBeInTheDocument();
  });

  it("renders Update Yaml File button when test is Running", () => {
    const runningTest: TestData = { ...baseTestData, status: TestStatus.Running };
    render(<TestInfo testData={runningTest} />);
    expect(screen.getByText("Update Yaml File")).toBeInTheDocument();
  });

  it("renders s3Folder in the list", () => {
    render(<TestInfo testData={baseTestData} />);
    expect(screen.getByText(/S3 Folder:/)).toBeInTheDocument();
  });

  it("renders end time when provided", () => {
    const testWithEnd: TestData = {
      ...baseTestData,
      endTime: new Date("2024-01-15T13:00:00Z").getTime()
    };
    render(<TestInfo testData={testWithEnd} />);
    expect(screen.getByText(/End Time:/)).toBeInTheDocument();
  });

  it("renders Created status as waiting message", () => {
    const createdTest: TestData = { ...baseTestData, status: TestStatus.Created };
    render(<TestInfo testData={createdTest} />);
    expect(screen.getByText(/Test Uploaded, Waiting for Agent/)).toBeInTheDocument();
  });

  it("renders storybook error prop", () => {
    render(<TestInfo testData={baseTestData} error="Download failed" />);
    expect(screen.getByText(/Download failed/)).toBeInTheDocument();
  });

  it("renders storybook message prop", () => {
    render(<TestInfo testData={baseTestData} message="Stop Sent" />);
    expect(screen.getByText("Stop Sent")).toBeInTheDocument();
  });
});
