vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ status: 200, data: { message: "Finished" } }))
  }
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { TestData } from "../../types";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import TestsList from ".";

// Use fixed testIds with the PpaasTestId format: <yamlname><date>
const testData1: TestData = {
  testId: "mytest20240115T120000001",
  s3Folder: "mytest/20240115T120000001",
  status: TestStatus.Finished,
  startTime: new Date("2024-01-15T12:00:00.001Z").getTime(),
  lastChecked: "2024-01-15T13:00:00Z"
};

const testData2: TestData = {
  testId: "othertest20240115T130000002",
  s3Folder: "othertest/20240115T130000002",
  status: TestStatus.Running,
  startTime: new Date("2024-01-15T13:00:00.002Z").getTime(),
  lastChecked: "2024-01-15T14:00:00Z"
};

describe("TestsList Component", () => {
  it("renders test IDs in the list", () => {
    render(<TestsList tests={[testData1]} />);
    expect(screen.getByText(/mytest20240115T120000001/)).toBeInTheDocument();
  });

  it("renders test status", () => {
    render(<TestsList tests={[testData1]} />);
    expect(screen.getByText(new RegExp(TestStatus.Finished))).toBeInTheDocument();
  });

  it("renders multiple tests", () => {
    render(<TestsList tests={[testData1, testData2]} />);
    expect(screen.getByText(/mytest20240115T120000001/)).toBeInTheDocument();
    expect(screen.getByText(/othertest20240115T130000002/)).toBeInTheDocument();
  });

  it("renders empty state with no list items when tests array is empty", () => {
    const { container } = render(<TestsList tests={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("renders as a button when onClick prop is provided", () => {
    const onClick = vi.fn();
    render(<TestsList tests={[testData1]} onClick={onClick} />);
    const button = screen.getByRole("button", { name: /mytest20240115T120000001/ });
    expect(button).toBeInTheDocument();
  });

  it("calls onClick with the test data when a test button is clicked", () => {
    const onClick = vi.fn();
    render(<TestsList tests={[testData1]} onClick={onClick} />);
    const button = screen.getByRole("button", { name: /mytest20240115T120000001/ });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(expect.anything(), testData1);
  });

  it("renders as a link when no onClick prop is provided", () => {
    render(<TestsList tests={[testData1]} />);
    const link = screen.getByRole("link", { name: /mytest20240115T120000001/ });
    expect(link).toBeInTheDocument();
  });

  it("renders Running status for a running test", () => {
    render(<TestsList tests={[testData2]} />);
    expect(screen.getByText(new RegExp(TestStatus.Running))).toBeInTheDocument();
  });

  it("renders the yaml filename portion of the test ID", () => {
    render(<TestsList tests={[testData1]} />);
    // PpaasTestId.getFromTestId extracts the yaml name as plain text before the date
    const listItems = document.querySelectorAll("li");
    expect(listItems.length).toBeGreaterThan(0);
    expect(listItems[0].textContent).toMatch(/mytest/);
  });

  it("polls status for Unknown tests and updates to Finished on success", async () => {
    const unknownTest: TestData = {
      testId: "mytest20240115T160000005",
      s3Folder: "mytest/20240115T160000005",
      status: TestStatus.Unknown,
      startTime: new Date("2024-01-15T16:00:00.005Z").getTime(),
      lastChecked: "2024-01-15T16:30:00Z"
    };
    render(<TestsList tests={[unknownTest]} />);
    await waitFor(() => {
      expect(screen.getByText(new RegExp(TestStatus.Finished))).toBeInTheDocument();
    });
  });
});
