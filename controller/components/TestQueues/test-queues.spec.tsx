vi.mock("@fs/ppaas-common/dist/types", () => ({ AgentQueueDescription: {} }));
vi.mock("../Alert", () => ({ Danger: ({ children }: any) => <span role="alert">{children}</span> }));
vi.mock("../Div", () => ({ default: ({ children, ...props }: any) => <div {...props}>{children}</div> }));

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { TestQueues } from ".";

const defaultProps = {
  queueName: "us-east-1",
  testQueues: { "us-east-1": "US East 1", "us-west-2": "US West 2" },
  loading: false,
  error: false,
  onChange: vi.fn()
};

describe("TestQueues", () => {
  describe("Rendering", () => {
    it("should render the Test Queue label", () => {
      render(<TestQueues {...defaultProps} />);
      expect(screen.getByText("Test Queue")).toBeInTheDocument();
    });

    it("should render the queue select dropdown when not loading and no error", () => {
      render(<TestQueues {...defaultProps} />);
      expect(screen.getByTestId("queue-select")).toBeInTheDocument();
    });

    it("should render all queue options in the dropdown", () => {
      render(<TestQueues {...defaultProps} />);
      const select = screen.getByTestId("queue-select") as HTMLSelectElement;
      expect(select.options.length).toBe(2);
    });

    it("should render queue options formatted as description - key", () => {
      render(<TestQueues {...defaultProps} />);
      expect(screen.getByText("US East 1 - us-east-1")).toBeInTheDocument();
      expect(screen.getByText("US West 2 - us-west-2")).toBeInTheDocument();
    });

    it("should set the selected value to the queueName prop", () => {
      render(<TestQueues {...defaultProps} />);
      const select = screen.getByTestId("queue-select") as HTMLSelectElement;
      expect(select.value).toBe("us-east-1");
    });
  });

  describe("Loading state", () => {
    it("should show loading text when loading is true", () => {
      render(<TestQueues {...defaultProps} loading={true} />);
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should not show select dropdown when loading is true", () => {
      render(<TestQueues {...defaultProps} loading={true} />);
      expect(screen.queryByTestId("queue-select")).not.toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("should show error message when error is true", () => {
      render(<TestQueues {...defaultProps} error={true} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Could not load the current Test Queues")).toBeInTheDocument();
    });

    it("should not show select dropdown when error is true", () => {
      render(<TestQueues {...defaultProps} error={true} />);
      expect(screen.queryByTestId("queue-select")).not.toBeInTheDocument();
    });

    it("should not show loading text when error is true", () => {
      render(<TestQueues {...defaultProps} error={true} />);
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("should render select with no options when testQueues is empty object", () => {
      render(<TestQueues {...defaultProps} testQueues={{}} />);
      const select = screen.getByTestId("queue-select") as HTMLSelectElement;
      expect(select.options.length).toBe(0);
    });
  });

  describe("onChange handler", () => {
    it("should call onChange when a different queue is selected", () => {
      const onChange = vi.fn();
      render(<TestQueues {...defaultProps} onChange={onChange} />);
      fireEvent.change(screen.getByTestId("queue-select"), { target: { value: "us-west-2" } });
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("Name prop", () => {
    it("should apply the name attribute to the select element when provided", () => {
      render(<TestQueues {...defaultProps} name="queue-name" />);
      const select = screen.getByTestId("queue-select") as HTMLSelectElement;
      expect(select.name).toBe("queue-name");
    });
  });
});
