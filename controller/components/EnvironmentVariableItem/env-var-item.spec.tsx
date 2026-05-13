import { fireEvent, render, screen } from "@testing-library/react";
import { EnvironmentVariableItem } from ".";
import React from "react";

describe("EnvironmentVariableItem", () => {
  const defaultProps = {
    name: "var0",
    variableName: "MY_VAR",
    variableValue: "my-value",
    type: "text" as const,
    onChange: () => { /* noop */ },
    onRemove: () => { /* noop */ }
  };

  describe("Rendering", () => {
    it("should render the variable name input with the correct value", () => {
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} /></tr></tbody></table>);
      const nameInput = screen.getByTestId("env-var-name-var0") as HTMLInputElement;
      expect(nameInput.value).toBe("MY_VAR");
    });

    it("should render the variable value input with the correct value", () => {
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} /></tr></tbody></table>);
      const valueInput = screen.getByTestId("env-var-value-var0") as HTMLInputElement;
      expect(valueInput.value).toBe("my-value");
    });

    it("should render a text input for the value when type is text", () => {
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} type="text" /></tr></tbody></table>);
      const valueInput = screen.getByTestId("env-var-value-var0") as HTMLInputElement;
      expect(valueInput.type).toBe("text");
    });

    it("should render a password input for the value when type is password", () => {
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} type="password" variableValue="secret" /></tr></tbody></table>);
      const valueInput = screen.getByTestId("env-var-value-var0") as HTMLInputElement;
      expect(valueInput.type).toBe("password");
    });

    it("should render the delete button", () => {
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} /></tr></tbody></table>);
      expect(screen.getByTitle("Delete this value")).toBeInTheDocument();
    });

    it("should render a checkbox for the hide/password toggle", () => {
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} /></tr></tbody></table>);
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(1);
    });
  });

  describe("Interaction", () => {
    it("should call onChange when the variable name input changes", () => {
      const mockChange = vi.fn();
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} onChange={mockChange} /></tr></tbody></table>);
      fireEvent.change(screen.getByTestId("env-var-name-var0"), { target: { value: "NEW_VAR" } });
      expect(mockChange).toHaveBeenCalledTimes(1);
    });

    it("should call onChange when the variable value input changes", () => {
      const mockChange = vi.fn();
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} onChange={mockChange} /></tr></tbody></table>);
      fireEvent.change(screen.getByTestId("env-var-value-var0"), { target: { value: "new-value" } });
      expect(mockChange).toHaveBeenCalledTimes(1);
    });

    it("should call onRemove when the delete button is clicked", () => {
      const mockRemove = vi.fn();
      render(<table><tbody><tr><EnvironmentVariableItem {...defaultProps} onRemove={mockRemove} /></tr></tbody></table>);
      fireEvent.click(screen.getByTitle("Delete this value"));
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
  });
});
