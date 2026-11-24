import { fireEvent, render, screen } from "@testing-library/react";
import { NotesProvider } from "./NotesContext";
import React from "react";
import ViewModeToggle from "./ViewModeToggle";

const renderWithProvider = (ui: React.ReactElement) =>
  render(<NotesProvider>{ui}</NotesProvider>);

describe("ViewModeToggle", () => {
  it("renders a tablist with an accessible label", () => {
    renderWithProvider(<ViewModeToggle />);
    expect(screen.getByRole("tablist", { name: "View mode" })).toBeInTheDocument();
  });

  it("renders Edit, Split, and Preview tabs", () => {
    renderWithProvider(<ViewModeToggle />);
    expect(screen.getByRole("tab", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });

  it("Edit tab is selected by default", () => {
    renderWithProvider(<ViewModeToggle />);
    expect(screen.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
  });

  it("Split and Preview tabs are not selected by default", () => {
    renderWithProvider(<ViewModeToggle />);
    expect(screen.getByRole("tab", { name: "Split" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking Split selects it", () => {
    renderWithProvider(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("tab", { name: "Split" }));
    expect(screen.getByRole("tab", { name: "Split" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking Split deselects Edit", () => {
    renderWithProvider(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("tab", { name: "Split" }));
    expect(screen.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking Preview selects it", () => {
    renderWithProvider(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking Preview deselects Edit", () => {
    renderWithProvider(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "false");
  });

  it("can switch back from Preview to Edit", () => {
    renderWithProvider(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "false");
  });

  it("can switch from Split to Preview", () => {
    renderWithProvider(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("tab", { name: "Split" }));
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Split" })).toHaveAttribute("aria-selected", "false");
  });
});
