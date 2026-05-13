import { fireEvent, render, screen } from "@testing-library/react";
import { CheckboxButton } from ".";
import React from "react";

describe("CheckboxButton", () => {
  describe("Rendering", () => {
    it("should render a checked checkbox when value is true", () => {
      render(<CheckboxButton id="test-id" value={true} onClick={() => { /* noop */ }} />);
      const input = screen.getByRole("checkbox") as HTMLInputElement;
      expect(input.checked).toBe(true);
    });

    it("should render an unchecked checkbox when value is false", () => {
      render(<CheckboxButton id="test-id" value={false} onClick={() => { /* noop */ }} />);
      const input = screen.getByRole("checkbox") as HTMLInputElement;
      expect(input.checked).toBe(false);
    });

    it("should render the id as label text when text prop is not provided", () => {
      render(<CheckboxButton id="my-checkbox" value={false} onClick={() => { /* noop */ }} />);
      expect(screen.getByText("my-checkbox")).toBeInTheDocument();
    });

    it("should render the text prop as label text when provided", () => {
      render(<CheckboxButton id="my-checkbox" value={false} text="Click Me" onClick={() => { /* noop */ }} />);
      expect(screen.getByText("Click Me")).toBeInTheDocument();
    });

    it("should prefer text prop over id for label display", () => {
      render(<CheckboxButton id="my-checkbox" value={false} text="Custom Label" onClick={() => { /* noop */ }} />);
      expect(screen.getByText("Custom Label")).toBeInTheDocument();
      expect(screen.queryByText("my-checkbox")).not.toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("should call onClick when the label is clicked", () => {
      const mockClick = vi.fn();
      render(<CheckboxButton id="test-id" value={false} text="Label" onClick={mockClick} />);
      fireEvent.click(screen.getByText("Label"));
      expect(mockClick).toHaveBeenCalled();
    });

    it("should call onClick when the checkbox input is clicked", () => {
      const mockClick = vi.fn();
      render(<CheckboxButton id="test-id" value={false} onClick={mockClick} />);
      fireEvent.click(screen.getByRole("checkbox"));
      expect(mockClick).toHaveBeenCalledTimes(1);
    });

    it("should render with data-testid based on id", () => {
      render(<CheckboxButton id="my-id" value={true} onClick={() => { /* noop */ }} />);
      expect(screen.getByTestId("checkbox-my-id")).toBeInTheDocument();
    });
  });
});
