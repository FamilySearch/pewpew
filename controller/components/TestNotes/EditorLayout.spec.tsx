vi.mock("./EditorToolbar", () => ({ default: () => <div data-testid="mock-toolbar" /> }));
vi.mock("./MarkdownEditor", () => ({ default: () => <div data-testid="mock-editor" /> }));
vi.mock("./MarkdownPreview", () => ({ default: () => <div data-testid="mock-preview" /> }));

import { NotesProvider, VIEW_MODES, useNotesContext } from "./NotesContext";
import { fireEvent, render, screen } from "@testing-library/react";
import EditorLayout from "./EditorLayout";
import React from "react";

const mockEditor = {} as any;
const mockGetContent = vi.fn(() => "content");

function ModeSelector () {
  const { setViewMode } = useNotesContext();
  return (
    <div>
      <button onClick={() => setViewMode(VIEW_MODES.EDIT)}>Edit Mode</button>
      <button onClick={() => setViewMode(VIEW_MODES.SPLIT)}>Split Mode</button>
      <button onClick={() => setViewMode(VIEW_MODES.PREVIEW)}>Preview Mode</button>
    </div>
  );
}

function renderWithModes () {
  return render(
    <NotesProvider>
      <ModeSelector />
      <EditorLayout editor={mockEditor} getContent={mockGetContent} />
    </NotesProvider>
  );
}

describe("EditorLayout", () => {
  it("renders the notes-editor-layout container", () => {
    renderWithModes();
    expect(screen.getByTestId("notes-editor-layout")).toBeInTheDocument();
  });

  describe("edit mode (default)", () => {
    it("shows toolbar in edit mode", () => {
      renderWithModes();
      expect(screen.getByTestId("mock-toolbar")).toBeInTheDocument();
    });

    it("shows the editor in edit mode", () => {
      renderWithModes();
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    });

    it("hides the preview in edit mode", () => {
      renderWithModes();
      expect(screen.queryByTestId("mock-preview")).not.toBeInTheDocument();
    });
  });

  describe("preview mode", () => {
    it("hides toolbar in preview mode", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Preview Mode"));
      expect(screen.queryByTestId("mock-toolbar")).not.toBeInTheDocument();
    });

    it("hides the editor in preview mode", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Preview Mode"));
      expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
    });

    it("shows the preview in preview mode", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Preview Mode"));
      expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
    });
  });

  describe("split mode", () => {
    it("shows toolbar in split mode", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Split Mode"));
      expect(screen.getByTestId("mock-toolbar")).toBeInTheDocument();
    });

    it("shows the editor in split mode", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Split Mode"));
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    });

    it("shows the preview in split mode", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Split Mode"));
      expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
    });
  });

  describe("mode transitions", () => {
    it("switching from split back to edit hides preview", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Split Mode"));
      fireEvent.click(screen.getByText("Edit Mode"));
      expect(screen.queryByTestId("mock-preview")).not.toBeInTheDocument();
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    });

    it("switching from preview back to edit shows toolbar and editor", () => {
      renderWithModes();
      fireEvent.click(screen.getByText("Preview Mode"));
      fireEvent.click(screen.getByText("Edit Mode"));
      expect(screen.getByTestId("mock-toolbar")).toBeInTheDocument();
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
      expect(screen.queryByTestId("mock-preview")).not.toBeInTheDocument();
    });
  });
});
