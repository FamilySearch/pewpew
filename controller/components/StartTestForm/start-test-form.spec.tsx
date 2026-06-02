vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: "/", query: {} }) }));
vi.mock("rc-progress", () => ({ Line: () => <div data-testid="progress-line" /> }));
vi.mock("react-datepicker", () => ({ default: () => <input data-testid="date-picker" /> }));

import { AuthPermission, AuthPermissions, PreviousTestData } from "../../types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueueInitialProps } from "../TestQueues";
import React from "react";
import StartTestForm from ".";
import { TestStatus } from "@fs/ppaas-common/dist/types";
import { VersionInitalProps } from "../PewPewVersions";

const defaultQueueProps: QueueInitialProps = {
  queueName: "unittestqueue",
  testQueues: { unittestqueue: "Unit Test Queue" },
  loading: false,
  error: false
};

const defaultVersionProps: VersionInitalProps = {
  pewpewVersion: "latest",
  pewpewVersions: ["latest", "0.5.8"],
  latestPewPewVersion: "0.5.8",
  loading: false,
  error: false
};

const defaultAuthPermissions: AuthPermissions = {
  token: undefined,
  authPermission: AuthPermission.User,
  userId: "test.user@familysearch.org"
};

describe("StartTestForm Component", () => {
  it("renders the form title", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    expect(screen.getByText("Run a new test")).toBeInTheDocument();
  });

  it("renders the submit button", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    expect(screen.getByTestId("submit-test-button")).toBeInTheDocument();
  });

  it("renders queue select dropdown", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    expect(screen.getByTestId("queue-select")).toBeInTheDocument();
  });

  it("renders version select dropdown", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    expect(screen.getByTestId("pewpew-version-select")).toBeInTheDocument();
  });

  it("renders with provided queue name selected", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    const select = screen.getByTestId("queue-select") as HTMLSelectElement;
    expect(select.value).toBe("unittestqueue");
  });

  it("renders schedule radio buttons", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    expect(screen.getByTestId("schedule-now-radio")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-future-radio")).toBeInTheDocument();
  });

  it("shows bypass parser section for Admin permission", () => {
    const adminPermissions: AuthPermissions = {
      ...defaultAuthPermissions,
      authPermission: AuthPermission.Admin
    };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={adminPermissions}
      />
    );
    expect(screen.getByTestId("bypass-parser-section")).toBeInTheDocument();
  });

  it("shows bypass parser section when no authPermissions provided", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
      />
    );
    expect(screen.getByTestId("bypass-parser-section")).toBeInTheDocument();
  });

  it("hides bypass parser section for User permission", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    expect(screen.queryByTestId("bypass-parser-section")).not.toBeInTheDocument();
  });

  it("shows not-authorized message for ReadOnly permission", () => {
    const readOnlyPermissions: AuthPermissions = {
      ...defaultAuthPermissions,
      authPermission: AuthPermission.ReadOnly
    };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={readOnlyPermissions}
      />
    );
    expect(screen.getByTestId("not-authorized-message")).toBeInTheDocument();
  });

  it("shows error message when error prop is provided", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        error="Something went wrong"
      />
    );
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("shows validation error when submitted without a yaml file", async () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    fireEvent.click(screen.getByTestId("submit-test-button"));
    await waitFor(() =>
      expect(screen.getByText(/You must provide 1 yaml file and 1 queueName/)).toBeInTheDocument()
    );
  });

  it("shows schedule date picker when scheduling in the future", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    fireEvent.click(screen.getByTestId("schedule-future-radio"));
    expect(screen.getByTestId("date-picker")).toBeInTheDocument();
  });

  it("updates queue selection when select changes", () => {
    const multiQueueProps: QueueInitialProps = {
      queueName: "queue-a",
      testQueues: { "queue-a": "Queue A", "queue-b": "Queue B" },
      loading: false,
      error: false
    };
    render(
      <StartTestForm
        queueInitialProps={multiQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    const select = screen.getByTestId("queue-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "queue-b" } });
    expect(select.value).toBe("queue-b");
  });

  it("updates version selection when select changes", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    const select = screen.getByTestId("pewpew-version-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "0.5.8" } });
    expect(select.value).toBe("0.5.8");
  });

  it("shows upload progress bar when uploading storybook prop is set", () => {
    const storyProps = { uploading: true, uploadProgress: 50 };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        {...(storyProps as any)}
      />
    );
    expect(screen.getByTestId("progress-line")).toBeInTheDocument();
  });

  it("shows prior yaml section when previousTestData is provided", () => {
    const previousTestData: PreviousTestData = {
      testId: "test20240115T120000000",
      s3Folder: "test/20240115T120000000",
      status: TestStatus.Finished,
      startTime: new Date("2024-01-15T12:00:00Z").getTime(),
      lastChecked: "2024-01-15T13:00:00Z",
      yamlFile: "load-test.yaml",
      environmentVariables: {}
    };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        previousTestData={previousTestData}
      />
    );
    expect(screen.getByTestId("prior-yaml-section")).toBeInTheDocument();
  });

  it("uses previousTestData queueName when it exists in available queues", () => {
    const multiQueueProps: QueueInitialProps = {
      queueName: "unittestqueue",
      testQueues: { unittestqueue: "Unit Test Queue", devxl: "c5n.xlarge" },
      loading: false,
      error: false
    };
    const previousTestData: PreviousTestData = {
      testId: "test20240115T120000000",
      s3Folder: "test/20240115T120000000",
      status: TestStatus.Finished,
      startTime: new Date("2024-01-15T12:00:00Z").getTime(),
      lastChecked: "2024-01-15T13:00:00Z",
      yamlFile: "load-test.yaml",
      queueName: "devxl",
      environmentVariables: {}
    };
    render(
      <StartTestForm
        queueInitialProps={multiQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        previousTestData={previousTestData}
      />
    );
    expect((screen.getByTestId("queue-select") as HTMLSelectElement).value).toBe("devxl");
  });

  it("falls back to default queueName when previousTestData queueName is not in available queues", () => {
    const previousTestData: PreviousTestData = {
      testId: "test20240115T120000000",
      s3Folder: "test/20240115T120000000",
      status: TestStatus.Finished,
      startTime: new Date("2024-01-15T12:00:00Z").getTime(),
      lastChecked: "2024-01-15T13:00:00Z",
      yamlFile: "load-test.yaml",
      queueName: "devxl",
      environmentVariables: {}
    };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        previousTestData={previousTestData}
      />
    );
    // devxl is not in defaultQueueProps.testQueues — should fall back to "unittestqueue"
    expect((screen.getByTestId("queue-select") as HTMLSelectElement).value).toBe("unittestqueue");
  });

  it("uses previousTestData version when it exists in available versions", () => {
    const previousTestData: PreviousTestData = {
      testId: "test20240115T120000000",
      s3Folder: "test/20240115T120000000",
      status: TestStatus.Finished,
      startTime: new Date("2024-01-15T12:00:00Z").getTime(),
      lastChecked: "2024-01-15T13:00:00Z",
      yamlFile: "load-test.yaml",
      version: "0.5.8",
      environmentVariables: {}
    };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        previousTestData={previousTestData}
      />
    );
    expect((screen.getByTestId("pewpew-version-select") as HTMLSelectElement).value).toBe("0.5.8");
  });

  it("falls back to default version when previousTestData version is not in available versions", () => {
    const previousTestData: PreviousTestData = {
      testId: "test20240115T120000000",
      s3Folder: "test/20240115T120000000",
      status: TestStatus.Finished,
      startTime: new Date("2024-01-15T12:00:00Z").getTime(),
      lastChecked: "2024-01-15T13:00:00Z",
      yamlFile: "load-test.yaml",
      version: "0.5.7",
      environmentVariables: {}
    };
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
        previousTestData={previousTestData}
      />
    );
    // 0.5.7 is not in defaultVersionProps.pewpewVersions — should fall back to "latest"
    expect((screen.getByTestId("pewpew-version-select") as HTMLSelectElement).value).toBe("latest");
  });

  it("shows recurring test options when scheduling in future and recurring is selected", () => {
    render(
      <StartTestForm
        queueInitialProps={defaultQueueProps}
        versionInitalProps={defaultVersionProps}
        authPermissions={defaultAuthPermissions}
      />
    );
    fireEvent.click(screen.getByTestId("schedule-future-radio"));
    fireEvent.click(screen.getByTestId("recurring-yes-radio"));
    expect(screen.getByTestId("recurring-yes-radio")).toBeInTheDocument();
    expect(screen.getByTestId("recurring-no-radio")).toBeInTheDocument();
  });
});
