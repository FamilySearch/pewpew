vi.mock("axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ status: 200, data: "Existing notes" })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));
vi.mock("next/dynamic", () => ({
  default: () => {
    const MockEditor = ({ editorContentRef }: any) => {
      editorContentRef.current = () => "mock editor content";
      return <div data-testid="mock-tiptap-editor" />;
    };
    return MockEditor;
  }
}));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: "/", query: {} }) }));
vi.mock("./ExportMenu", () => ({ default: () => <div data-testid="mock-export-menu" /> }));
vi.mock("./StatusBar", () => ({ default: () => <div data-testid="mock-status-bar" /> }));
vi.mock("./ViewModeToggle", () => ({ default: () => <div data-testid="mock-view-mode-toggle" /> }));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthPermission } from "../../types";
import { TestNotes } from ".";
import axios from "axios";

const baseTestData = { s3Folder: "unittest/20240115T120000000" };

describe("TestNotes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("shows notes-loading section before API resolves", () => {
      vi.mocked(axios.get).mockReturnValueOnce(new Promise(() => vi.fn()));
      render(<TestNotes testData={baseTestData} />);
      expect(screen.getByTestId("notes-loading")).toBeInTheDocument();
    });

    it("shows 'Loading notes...' text before API resolves", () => {
      vi.mocked(axios.get).mockReturnValueOnce(new Promise(() => vi.fn()));
      render(<TestNotes testData={baseTestData} />);
      expect(screen.getByText("Loading notes...")).toBeInTheDocument();
    });
  });

  describe("loaded state (via initialNotesContent)", () => {
    it("shows 'Test Notes' heading", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.getByText("Test Notes")).toBeInTheDocument();
    });

    it("shows notes-editor section when loaded", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.getByTestId("notes-editor")).toBeInTheDocument();
    });

    it("renders the editor", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.getByTestId("mock-tiptap-editor")).toBeInTheDocument();
    });

    it("renders ExportMenu", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.getByTestId("mock-export-menu")).toBeInTheDocument();
    });

    it("renders StatusBar", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.getByTestId("mock-status-bar")).toBeInTheDocument();
    });
  });

  describe("auth gating", () => {
    it("shows not-logged-in message when authPermission is undefined", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.getByText(/not logged in/i)).toBeInTheDocument();
    });

    it("does not show Save button when authPermission is undefined", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.queryByTestId("notes-save-button")).not.toBeInTheDocument();
    });

    it("does not show Save button for ReadOnly permission", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" authPermission={AuthPermission.ReadOnly} />);
      expect(screen.queryByTestId("notes-save-button")).not.toBeInTheDocument();
    });

    it("does not show Generate Template button for ReadOnly permission", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" authPermission={AuthPermission.ReadOnly} />);
      expect(screen.queryByTestId("notes-generate-template-button")).not.toBeInTheDocument();
    });

    it("shows Save button for User permission", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" authPermission={AuthPermission.User} />);
      expect(screen.getByTestId("notes-save-button")).toBeInTheDocument();
    });

    it("shows Generate Template button for User permission", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" authPermission={AuthPermission.User} />);
      expect(screen.getByTestId("notes-generate-template-button")).toBeInTheDocument();
    });

    it("does not show Delete button for User permission (not Admin)", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="Some notes" authPermission={AuthPermission.User} />);
      expect(screen.queryByTestId("notes-delete-button")).not.toBeInTheDocument();
    });

    it("shows Delete button for Admin permission when notes exist", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="Some notes" authPermission={AuthPermission.Admin} />);
      expect(screen.getByTestId("notes-delete-button")).toBeInTheDocument();
    });

    it("does not show Delete button for Admin when notes content is empty", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" authPermission={AuthPermission.Admin} />);
      expect(screen.queryByTestId("notes-delete-button")).not.toBeInTheDocument();
    });
  });

  describe("Save button state", () => {
    it("Save button is disabled initially (content not dirty)", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" authPermission={AuthPermission.User} />);
      expect(screen.getByTestId("notes-save-button")).toBeDisabled();
    });
  });

  describe("collapse / expand", () => {
    it("does not show collapse button when onToggle is not provided", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" />);
      expect(screen.queryByTestId("notes-collapse-button")).not.toBeInTheDocument();
    });

    it("shows collapse button when onToggle is provided", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" onToggle={vi.fn()} isExpanded={true} />);
      expect(screen.getByTestId("notes-collapse-button")).toBeInTheDocument();
    });

    it("shows '▲ Collapse' label when expanded", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" onToggle={vi.fn()} isExpanded={true} />);
      expect(screen.getByText("▲ Collapse")).toBeInTheDocument();
    });

    it("shows '▼ Expand' label when collapsed", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" onToggle={vi.fn()} isExpanded={false} />);
      expect(screen.getByText("▼ Expand")).toBeInTheDocument();
    });

    it("hides editor content when isExpanded is false", () => {
      render(<TestNotes testData={baseTestData} initialNotesContent="" onToggle={vi.fn()} isExpanded={false} />);
      expect(screen.queryByTestId("mock-tiptap-editor")).not.toBeInTheDocument();
    });

    it("calls onToggle when collapse button is clicked", () => {
      const onToggle = vi.fn();
      render(<TestNotes testData={baseTestData} initialNotesContent="" onToggle={onToggle} isExpanded={true} />);
      fireEvent.click(screen.getByTestId("notes-collapse-button"));
      expect(onToggle).toHaveBeenCalled();
    });
  });

  describe("API load", () => {
    it("transitions from loading to editor after API resolves", async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: "Loaded notes content" } as any);
      render(<TestNotes testData={baseTestData} />);
      await waitFor(() => expect(screen.getByTestId("notes-editor")).toBeInTheDocument());
    });

    it("loads template when API returns 204 (no notes yet)", async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 204, data: "" } as any)
        .mockResolvedValueOnce({ status: 200, data: { markdown: "# Template" } } as any);
      render(<TestNotes testData={baseTestData} />);
      await waitFor(() => expect(screen.getByTestId("notes-editor")).toBeInTheDocument());
    });

    it("shows error message when notes load fails", async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error("Network error"));
      render(<TestNotes testData={baseTestData} />);
      await waitFor(() => expect(screen.getByTestId("notes-message")).toBeInTheDocument());
      expect(screen.getByText("Failed to load notes")).toBeInTheDocument();
    });
  });

  describe("delete interaction", () => {
    it("calls axios.delete when Admin confirms deletion", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TestNotes testData={baseTestData} initialNotesContent="Some notes" authPermission={AuthPermission.Admin} />);
      fireEvent.click(screen.getByTestId("notes-delete-button"));
      await waitFor(() => expect(vi.mocked(axios.delete)).toHaveBeenCalled());
    });

    it("shows success message after deletion", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TestNotes testData={baseTestData} initialNotesContent="Some notes" authPermission={AuthPermission.Admin} />);
      fireEvent.click(screen.getByTestId("notes-delete-button"));
      await waitFor(() => expect(screen.getByText("Notes deleted")).toBeInTheDocument());
    });

    it("does not call axios.delete when user cancels confirmation", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<TestNotes testData={baseTestData} initialNotesContent="Some notes" authPermission={AuthPermission.Admin} />);
      fireEvent.click(screen.getByTestId("notes-delete-button"));
      expect(vi.mocked(axios.delete)).not.toHaveBeenCalled();
    });

    it("shows error message when deletion fails", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(axios.delete).mockRejectedValueOnce(new Error("Server error"));
      render(<TestNotes testData={baseTestData} initialNotesContent="Some notes" authPermission={AuthPermission.Admin} />);
      fireEvent.click(screen.getByTestId("notes-delete-button"));
      await waitFor(() => expect(screen.getByText("Failed to delete notes")).toBeInTheDocument());
    });
  });

  describe("save interaction", () => {
    // Generate Template sets isDirty=true, which enables the Save button.
    // With initialNotesContent set, the editor mock sets editorContentRef so Save can proceed.
    it("enables Save button after Generate Template succeeds", async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: { markdown: "# Generated" } } as any);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TestNotes testData={baseTestData} initialNotesContent="Existing" authPermission={AuthPermission.User} />);
      fireEvent.click(screen.getByTestId("notes-generate-template-button"));
      await waitFor(() => expect(screen.getByTestId("notes-save-button")).not.toBeDisabled());
    });

    it("calls axios.put when Save is clicked after template is generated", async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: { markdown: "# Generated" } } as any);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TestNotes testData={baseTestData} initialNotesContent="Existing" authPermission={AuthPermission.User} />);
      fireEvent.click(screen.getByTestId("notes-generate-template-button"));
      await waitFor(() => expect(screen.getByTestId("notes-save-button")).not.toBeDisabled());
      fireEvent.click(screen.getByTestId("notes-save-button"));
      await waitFor(() => expect(vi.mocked(axios.put)).toHaveBeenCalled());
    });

    it("shows success message after save", async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: { markdown: "# Generated" } } as any);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TestNotes testData={baseTestData} initialNotesContent="Existing" authPermission={AuthPermission.User} />);
      fireEvent.click(screen.getByTestId("notes-generate-template-button"));
      await waitFor(() => expect(screen.getByTestId("notes-save-button")).not.toBeDisabled());
      fireEvent.click(screen.getByTestId("notes-save-button"));
      await waitFor(() => expect(screen.getByText("Notes saved")).toBeInTheDocument());
    });

    it("shows error message when save fails", async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: { markdown: "# Generated" } } as any);
      vi.mocked(axios.put).mockRejectedValueOnce(new Error("Save error"));
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TestNotes testData={baseTestData} initialNotesContent="Existing" authPermission={AuthPermission.User} />);
      fireEvent.click(screen.getByTestId("notes-generate-template-button"));
      await waitFor(() => expect(screen.getByTestId("notes-save-button")).not.toBeDisabled());
      fireEvent.click(screen.getByTestId("notes-save-button"));
      await waitFor(() => expect(screen.getByText("Failed to save notes")).toBeInTheDocument());
    });
  });
});
