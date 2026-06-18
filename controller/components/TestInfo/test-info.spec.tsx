vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: "/", query: {} }) }));

import { AuthPermission, TestData } from "../../types";
import TestInfo, { canDownloadTestFiles } from ".";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
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

  it("renders messageId when both message and messageId are provided", () => {
    render(<TestInfo testData={baseTestData} message="Stop Sent" messageId="msg-123" />);
    expect(screen.getByText(/MessageId: msg-123/)).toBeInTheDocument();
  });

  describe("optional fields", () => {
    it("renders instanceId when provided", () => {
      render(<TestInfo testData={{ ...baseTestData, instanceId: "i-1234abcd" }} />);
      expect(screen.getByText(/InstanceId:/)).toBeInTheDocument();
    });

    it("renders hostname when provided", () => {
      render(<TestInfo testData={{ ...baseTestData, hostname: "test-host-1" }} />);
      expect(screen.getByText(/Hostname:/)).toBeInTheDocument();
    });

    it("renders ipAddress when provided", () => {
      render(<TestInfo testData={{ ...baseTestData, ipAddress: "10.0.0.1" }} />);
      expect(screen.getByText(/IPAddress:/)).toBeInTheDocument();
    });

    it("renders queueName when provided", () => {
      render(<TestInfo testData={{ ...baseTestData, queueName: "unit-test-queue" }} />);
      expect(screen.getByText(/Test Queue:/)).toBeInTheDocument();
    });

    it("renders version when provided", () => {
      render(<TestInfo testData={{ ...baseTestData, version: "0.5.8" }} />);
      expect(screen.getByText(/Pewpew Version:/)).toBeInTheDocument();
    });

    it("renders userId as an email link when provided", () => {
      render(<TestInfo testData={{ ...baseTestData, userId: "user@example.com" }} />);
      expect(screen.getByText("user@example.com")).toBeInTheDocument();
    });

    it("renders a single resultsFileLocation link", () => {
      const testWithResults: TestData = {
        ...baseTestData,
        resultsFileLocation: ["https://s3.example.com/results/test.json"]
      };
      render(<TestInfo testData={testWithResults} />);
      expect(screen.getByText("S3 Results Url")).toBeInTheDocument();
    });

    it("renders multiple resultsFileLocation links with numbered labels", () => {
      const testWithResults: TestData = {
        ...baseTestData,
        resultsFileLocation: [
          "https://s3.example.com/results/test1.json",
          "https://s3.example.com/results/test2.json"
        ]
      };
      render(<TestInfo testData={testWithResults} />);
      expect(screen.getByText("S3 Results Url")).toBeInTheDocument();
      expect(screen.getByText("S3 Results Url 2")).toBeInTheDocument();
    });

    it("renders lastUpdated for a running test with a recent timestamp", () => {
      const recentTime = new Date().toISOString();
      const runningTest: TestData = { ...baseTestData, status: TestStatus.Running, lastUpdated: recentTime };
      render(<TestInfo testData={runningTest} />);
      expect(screen.getByText(/Last Updated:/)).toBeInTheDocument();
    });

    it("renders lastUpdated for a running test with a stale timestamp", () => {
      const staleTime = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      const runningTest: TestData = { ...baseTestData, status: TestStatus.Running, lastUpdated: staleTime };
      render(<TestInfo testData={runningTest} />);
      expect(screen.getByText(/Last Updated:/)).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls window.confirm when the stop button is clicked", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      const runningTest: TestData = { ...baseTestData, status: TestStatus.Running };
      render(<TestInfo testData={runningTest} />);
      fireEvent.click(screen.getByText("Stop Test"));
      expect(confirmSpy).toHaveBeenCalled();
    });

    it("shows an error when stop is confirmed but the response is not a TestManagerMessage", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const runningTest: TestData = { ...baseTestData, status: TestStatus.Running };
      render(<TestInfo testData={runningTest} />);
      fireEvent.click(screen.getByText("Stop Test"));
      await waitFor(() => {
        expect(screen.getByText(/Error:/)).toBeInTheDocument();
      });
    });

    it("shows an error when the download button is clicked and the response is invalid", async () => {
      render(<TestInfo testData={baseTestData} authPermission={AuthPermission.Admin} />);
      fireEvent.click(screen.getByText("Download Test Files"));
      await waitFor(() => {
        expect(screen.getByText(/Error:/)).toBeInTheDocument();
      });
    });
  });

  describe("canDownloadTestFiles", () => {
    it("returns false when authPermission is undefined", () => {
      expect(canDownloadTestFiles(undefined, "user@example.com", "user@example.com")).toBe(false);
    });

    it("returns false when authPermission is Expired", () => {
      expect(canDownloadTestFiles(AuthPermission.Expired, "user@example.com", "user@example.com")).toBe(false);
    });

    it("returns false when authPermission is NoAuth", () => {
      expect(canDownloadTestFiles(AuthPermission.NoAuth, "user@example.com", "user@example.com")).toBe(false);
    });

    it("returns true for Admin regardless of userId match", () => {
      expect(canDownloadTestFiles(AuthPermission.Admin, "other@example.com", "user@example.com")).toBe(true);
    });

    it("returns true for Admin when testDataUserId is undefined", () => {
      expect(canDownloadTestFiles(AuthPermission.Admin, undefined, undefined)).toBe(true);
    });

    it("returns true for ReadOnly user when userId matches testDataUserId", () => {
      expect(canDownloadTestFiles(AuthPermission.ReadOnly, "user@example.com", "user@example.com")).toBe(true);
    });

    it("returns true for User when userId matches testDataUserId", () => {
      expect(canDownloadTestFiles(AuthPermission.User, "user@example.com", "user@example.com")).toBe(true);
    });

    it("returns false for ReadOnly user when userId does not match testDataUserId", () => {
      expect(canDownloadTestFiles(AuthPermission.ReadOnly, "other@example.com", "user@example.com")).toBe(false);
    });

    it("returns false when testDataUserId is undefined and user is not Admin", () => {
      expect(canDownloadTestFiles(AuthPermission.ReadOnly, "user@example.com", undefined)).toBe(false);
    });

    it("returns false when userId is undefined and user is not Admin", () => {
      expect(canDownloadTestFiles(AuthPermission.ReadOnly, undefined, "user@example.com")).toBe(false);
    });
  });
});
