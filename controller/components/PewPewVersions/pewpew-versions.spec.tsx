vi.mock("../Alert", () => ({ Danger: ({ children }: any) => <span role="alert">{children}</span> }));
vi.mock("../Div", () => ({ Div: ({ children, ...props }: any) => <div {...props}>{children}</div>, default: ({ children, ...props }: any) => <div {...props}>{children}</div> }));
vi.mock("../Toaster", () => ({ Toaster: ({ message }: any) => <div data-testid="toaster">{message}</div> }));

import { fireEvent, render, screen } from "@testing-library/react";
import { PewPewVersions } from ".";
import React from "react";

const defaultProps = {
  pewpewVersion: "latest",
  pewpewVersions: ["latest", "0.5.11", "0.5.10"],
  latestPewPewVersion: "0.5.11",
  loading: false,
  error: false,
  onChange: vi.fn()
};

describe("PewPewVersions", () => {
  describe("Rendering", () => {
    it("should render the label", () => {
      render(<PewPewVersions {...defaultProps} />);
      expect(screen.getByText("PewPew Version")).toBeInTheDocument();
    });

    it("should render the version select dropdown when not loading and no error", () => {
      render(<PewPewVersions {...defaultProps} />);
      expect(screen.getByTestId("pewpew-version-select")).toBeInTheDocument();
    });

    it("should render all version options in the dropdown", () => {
      render(<PewPewVersions {...defaultProps} />);
      const select = screen.getByTestId("pewpew-version-select") as HTMLSelectElement;
      expect(select.options.length).toBe(3);
      expect(select.options[0].value).toBe("latest");
      expect(select.options[1].value).toBe("0.5.11");
      expect(select.options[2].value).toBe("0.5.10");
    });

    it("should set the selected value to pewpewVersion prop", () => {
      render(<PewPewVersions {...defaultProps} pewpewVersion="0.5.10" />);
      const select = screen.getByTestId("pewpew-version-select") as HTMLSelectElement;
      expect(select.value).toBe("0.5.10");
    });
  });

  describe("Loading state", () => {
    it("should show loading text when loading is true", () => {
      render(<PewPewVersions {...defaultProps} loading={true} />);
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should not show select dropdown when loading is true", () => {
      render(<PewPewVersions {...defaultProps} loading={true} />);
      expect(screen.queryByTestId("pewpew-version-select")).not.toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("should show error message when error is true", () => {
      render(<PewPewVersions {...defaultProps} error={true} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Could not load the current PewPew Versions")).toBeInTheDocument();
    });

    it("should not show select dropdown when error is true", () => {
      render(<PewPewVersions {...defaultProps} error={true} />);
      expect(screen.queryByTestId("pewpew-version-select")).not.toBeInTheDocument();
    });

    it("should not show loading text when error is true", () => {
      render(<PewPewVersions {...defaultProps} error={true} />);
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  describe("onChange handler", () => {
    it("should call onChange when the selection changes", () => {
      const onChange = vi.fn();
      render(<PewPewVersions {...defaultProps} onChange={onChange} />);
      fireEvent.change(screen.getByTestId("pewpew-version-select"), { target: { value: "0.5.10" } });
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("Empty versions list", () => {
    it("should render select with no options when pewpewVersions is empty", () => {
      render(<PewPewVersions {...defaultProps} pewpewVersions={[]} />);
      const select = screen.getByTestId("pewpew-version-select") as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      expect(select.options.length).toBe(0);
    });
  });

  describe("Name prop", () => {
    it("should apply the name attribute to the select element when provided", () => {
      render(<PewPewVersions {...defaultProps} name="version-select" />);
      const select = screen.getByTestId("pewpew-version-select") as HTMLSelectElement;
      expect(select.name).toBe("version-select");
    });
  });
});
