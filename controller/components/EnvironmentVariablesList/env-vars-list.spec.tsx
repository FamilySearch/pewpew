import { fireEvent, render, screen } from "@testing-library/react";
import { EnvironmentVariablesList } from ".";
import React from "react";
import userEvent from "@testing-library/user-event";

describe("EnvironmentVariablesList", () => {
  const defaultVar = {
    name: "var0",
    variableName: "MY_VAR",
    variableValue: "my-value",
    type: "text" as const
  };

  describe("Empty state", () => {
    it("should render the Add Environment Variable button when no variables exist", () => {
      render(<EnvironmentVariablesList environmentVariables={[]} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      expect(screen.getByTestId("add-env-var-button")).toBeInTheDocument();
    });

    it("should not render the variable table when no variables exist", () => {
      render(<EnvironmentVariablesList environmentVariables={[]} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      expect(screen.queryByTestId("env-var-name-var0")).not.toBeInTheDocument();
    });

    it("should not show the production warning when no variables exist", () => {
      render(<EnvironmentVariablesList environmentVariables={[]} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      expect(screen.queryByText("Do Not Use Production Passwords!!!")).not.toBeInTheDocument();
    });
  });

  describe("Rendering existing variables", () => {
    it("should render an existing variable's name input", () => {
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      const nameInput = screen.getByTestId("env-var-name-var0") as HTMLInputElement;
      expect(nameInput.value).toBe("MY_VAR");
    });

    it("should render an existing variable's value input", () => {
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      const valueInput = screen.getByTestId("env-var-value-var0") as HTMLInputElement;
      expect(valueInput.value).toBe("my-value");
    });

    it("should render multiple variables", () => {
      const vars = [
        { name: "var0", variableName: "VAR_A", variableValue: "val-a", type: "text" as const },
        { name: "var1", variableName: "VAR_B", variableValue: "val-b", type: "text" as const }
      ];
      render(<EnvironmentVariablesList environmentVariables={vars} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      expect(screen.getByTestId("env-var-name-var0")).toBeInTheDocument();
      expect(screen.getByTestId("env-var-name-var1")).toBeInTheDocument();
    });

    it("should show the production password warning when variables exist", () => {
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={() => { /* noop */ }} onRemove={() => { /* noop */ }} />);
      expect(screen.getByText("Do Not Use Production Passwords!!!")).toBeInTheDocument();
    });
  });

  describe("Add Variable button", () => {
    it("should call onAddOrUpdate when the Add Environment Variable button is clicked", () => {
      const mockAddOrUpdate = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={[]} onAddOrUpdate={mockAddOrUpdate} onRemove={() => { /* noop */ }} />);
      fireEvent.click(screen.getByTestId("add-env-var-button"));
      expect(mockAddOrUpdate).toHaveBeenCalledTimes(1);
    });

    it("should pass a new variable object to onAddOrUpdate when Add is clicked", () => {
      const mockAddOrUpdate = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={[]} onAddOrUpdate={mockAddOrUpdate} onRemove={() => { /* noop */ }} />);
      fireEvent.click(screen.getByTestId("add-env-var-button"));
      expect(mockAddOrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ variableName: "", variableValue: "", type: "text" })
      );
    });
  });

  describe("updateItemHandler", () => {
    it("calls onAddOrUpdate with updated variableName when name input changes", () => {
      const mockAddOrUpdate = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={mockAddOrUpdate} onRemove={() => { /* noop */ }} />);
      fireEvent.change(screen.getByTestId("env-var-name-var0"), { target: { value: "NEW_VAR" } });
      expect(mockAddOrUpdate).toHaveBeenLastCalledWith({ name: "var0", variableName: "NEW_VAR" });
    });

    it("calls onAddOrUpdate with updated variableValue when value input changes", () => {
      const mockAddOrUpdate = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={mockAddOrUpdate} onRemove={() => { /* noop */ }} />);
      fireEvent.change(screen.getByTestId("env-var-value-var0"), { target: { value: "new-value" } });
      expect(mockAddOrUpdate).toHaveBeenLastCalledWith({ name: "var0", variableValue: "new-value" });
    });

    it("calls onAddOrUpdate with type=password when type checkbox is checked", async () => {
      const user = userEvent.setup();
      const mockAddOrUpdate = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={mockAddOrUpdate} onRemove={() => { /* noop */ }} />);
      await user.click(screen.getByRole("checkbox"));
      expect(mockAddOrUpdate).toHaveBeenLastCalledWith({ name: "var0", type: "password" });
    });

    it("calls onAddOrUpdate without type when type checkbox is unchecked", async () => {
      const user = userEvent.setup();
      const mockAddOrUpdate = vi.fn();
      const passwordVar = { ...defaultVar, type: "password" as const };
      render(<EnvironmentVariablesList environmentVariables={[passwordVar]} onAddOrUpdate={mockAddOrUpdate} onRemove={() => { /* noop */ }} />);
      await user.click(screen.getByRole("checkbox"));
      expect(mockAddOrUpdate).toHaveBeenLastCalledWith({ name: "var0" });
    });
  });

  describe("removeItemHandler", () => {
    it("calls onRemove with the variable name when delete button is clicked", () => {
      const mockRemove = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={[defaultVar]} onAddOrUpdate={() => { /* noop */ }} onRemove={mockRemove} />);
      const deleteButton = screen.getByTitle("Delete this value");
      fireEvent.click(deleteButton);
      expect(mockRemove).toHaveBeenCalledWith("var0");
    });

    it("calls onRemove with the correct name when multiple variables exist", () => {
      const vars = [
        { name: "var0", variableName: "VAR_A", variableValue: "val-a", type: "text" as const },
        { name: "var1", variableName: "VAR_B", variableValue: "val-b", type: "text" as const }
      ];
      const mockRemove = vi.fn();
      render(<EnvironmentVariablesList environmentVariables={vars} onAddOrUpdate={() => { /* noop */ }} onRemove={mockRemove} />);
      const deleteButtons = screen.getAllByTitle("Delete this value");
      fireEvent.click(deleteButtons[1]);
      expect(mockRemove).toHaveBeenCalledWith("var1");
    });
  });
});
