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

import { AuthPermission, AuthPermissions } from "../../types";
import { render, screen } from "@testing-library/react";
import { QueueInitialProps } from "../TestQueues";
import React from "react";
import StartTestForm from ".";
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
});
