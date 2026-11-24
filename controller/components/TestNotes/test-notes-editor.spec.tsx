// TestNotes with the real TipTap editor (test-notes.spec.tsx mocks it out): editor content must survive
// collapse/expand and save, Generate Template must always replace the content, and unsaved edits warn on unload.
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));
vi.mock("next/dynamic", async () => {
  const { default: TipTapEditorInner } = await vi.importActual<typeof import("./TipTapEditorInner")>("./TipTapEditorInner");
  return { default: () => TipTapEditorInner };
});
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: "/", query: {} }) }));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthPermission } from "../../types";
import type { Editor } from "@tiptap/react";
import React from "react";
import { TestNotes } from ".";
import axios from "axios";

const testData = { s3Folder: "unittest/20240115T120000000" };

function Harness ({ initialNotesContent }: { initialNotesContent: string }) {
  const [expanded, setExpanded] = React.useState(true);
  return (
    <TestNotes
      testData={testData}
      authPermission={AuthPermission.User}
      initialNotesContent={initialNotesContent}
      isExpanded={expanded}
      onToggle={() => setExpanded((old) => !old)}
    />
  );
}

/** The live TipTap instance TipTap attaches to its DOM node. Re-query after a remount. */
async function getEditor (): Promise<{ editor: Editor; dom: HTMLElement }> {
  const dom = await waitFor(() => {
    const el = document.querySelector(".ProseMirror");
    expect(el).not.toBeNull();
    return el as HTMLElement & { editor: Editor };
  });
  return { editor: dom.editor, dom };
}

async function typeAtEnd (text: string) {
  const { editor } = await getEditor();
  // Insert at the end of the last block without focus("end"), which scrolls and jsdom has no layout for
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, text); });
}

async function collapseAndExpand () {
  fireEvent.click(screen.getByTestId("notes-collapse-button"));
  await waitFor(() => expect(screen.getByTestId("notes-editor-container")).not.toBeVisible());
  fireEvent.click(screen.getByTestId("notes-collapse-button"));
  await waitFor(() => expect(screen.getByTestId("notes-editor-container")).toBeVisible());
}

describe("TestNotes (real editor)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("keeps unsaved edits across collapse and expand", async () => {
    render(<Harness initialNotesContent="hello" />);
    await typeAtEnd(" world");
    expect(screen.getByTestId("notes-dirty-indicator")).toBeInTheDocument();

    await collapseAndExpand();

    const { dom } = await getEditor();
    expect(dom).toHaveTextContent("hello world");
    expect(screen.getByTestId("notes-dirty-indicator")).toBeInTheDocument();
  });

  it("shows the saved content (not the page-load content) after save, collapse and expand", async () => {
    render(<Harness initialNotesContent="hello" />);
    await typeAtEnd(" saved");
    fireEvent.click(screen.getByTestId("notes-save-button"));
    await waitFor(() => expect(vi.mocked(axios.put)).toHaveBeenCalledWith(
      expect.any(String), { content: "hello saved" }, expect.anything()
    ));
    await waitFor(() => expect(screen.queryByTestId("notes-dirty-indicator")).not.toBeInTheDocument());

    await collapseAndExpand();

    const { dom } = await getEditor();
    expect(dom).toHaveTextContent("hello saved");
    expect(screen.queryByTestId("notes-dirty-indicator")).not.toBeInTheDocument();
  });

  it("Generate Template replaces edits even when the template equals the loaded content", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: { markdown: "## Objectives" } });
    render(<Harness initialNotesContent="## Objectives" />);
    await typeAtEnd(" edited");
    expect((await getEditor()).dom).toHaveTextContent("Objectives edited");

    fireEvent.click(screen.getByTestId("notes-generate-template-button"));

    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toHaveTextContent("edited"));
    expect((await getEditor()).dom).toHaveTextContent("Objectives");
    expect(screen.getByTestId("notes-dirty-indicator")).toBeInTheDocument();
  });

  it("shows an error instead of silently ignoring Save when the notes are empty", async () => {
    render(<Harness initialNotesContent="hello" />);
    const { editor } = await getEditor();
    act(() => { editor.commands.clearContent(true); });

    fireEvent.click(screen.getByTestId("notes-save-button"));

    expect(await screen.findByTestId("notes-message")).toHaveTextContent("Notes are empty");
    expect(vi.mocked(axios.put)).not.toHaveBeenCalled();
  });

  describe("unsaved changes warning", () => {
    const fireBeforeUnload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it("does not warn when there are no unsaved changes", async () => {
      render(<Harness initialNotesContent="hello" />);
      await getEditor();
      expect(fireBeforeUnload()).toBe(false);
    });

    it("warns on unload while there are unsaved changes, and stops after saving", async () => {
      render(<Harness initialNotesContent="hello" />);
      await typeAtEnd(" world");
      expect(fireBeforeUnload()).toBe(true);

      fireEvent.click(screen.getByTestId("notes-save-button"));
      await waitFor(() => expect(screen.queryByTestId("notes-dirty-indicator")).not.toBeInTheDocument());
      expect(fireBeforeUnload()).toBe(false);
    });
  });

  it("keeps the draft when the panel collapses without the Collapse button (e.g. browser Back)", async () => {
    const props = { testData, authPermission: AuthPermission.User, initialNotesContent: "hello", onToggle: vi.fn() };
    const { rerender } = render(<TestNotes {...props} isExpanded={true} />);
    await typeAtEnd(" world");
    // ?notes=1 removed by history navigation: isExpanded flips without onToggle running
    rerender(<TestNotes {...props} isExpanded={false} />);
    expect(screen.getByTestId("notes-editor-container")).not.toBeVisible();
    rerender(<TestNotes {...props} isExpanded={true} />);
    expect((await getEditor()).dom).toHaveTextContent("hello world");
  });

  it("does not mount the editor until the panel is first expanded", async () => {
    render(<TestNotes testData={testData} authPermission={AuthPermission.User} initialNotesContent="hello" isExpanded={false} onToggle={vi.fn()} />);
    await screen.findByTestId("notes-collapse-button");
    expect(document.querySelector(".ProseMirror")).toBeNull();
  });

  it("hides the formatting toolbar from read-only users", async () => {
    render(<TestNotes testData={testData} authPermission={AuthPermission.ReadOnly} initialNotesContent="hello" />);
    await getEditor();
    expect(screen.queryByTitle("Bold")).not.toBeInTheDocument();
  });

  it("shows a fresh editor when the test changes", async () => {
    const { rerender } = render(<TestNotes testData={testData} authPermission={AuthPermission.User} initialNotesContent="first" />);
    await typeAtEnd(" edited");
    expect(screen.getByTestId("notes-dirty-indicator")).toBeInTheDocument();
    rerender(<TestNotes testData={{ s3Folder: "othertest/20240115T120000000" }} authPermission={AuthPermission.User} initialNotesContent="second" />);
    expect((await getEditor()).dom).toHaveTextContent("second");
    expect(screen.queryByTestId("notes-dirty-indicator")).not.toBeInTheDocument();
  });

  it("loads notes that look like JSON as text", async () => {
    vi.mocked(axios.get).mockImplementationOnce((_url: string, config?: { transformResponse?: unknown[] }) => {
      // Mirrors axios: without transformResponse: [] the body "123" would be parsed to a number
      const raw = "123";
      return Promise.resolve({ status: 200, data: config?.transformResponse?.length === 0 ? raw : JSON.parse(raw) });
    });
    render(<TestNotes testData={testData} authPermission={AuthPermission.User} />);
    expect((await getEditor()).dom).toHaveTextContent("123");
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ responseType: "text", transformResponse: [] }));
  });

  it("keeps notes dirty when they were edited while a save was in flight", async () => {
    let finishSave: () => void = () => undefined;
    vi.mocked(axios.put).mockImplementationOnce(() => new Promise((resolve) => { finishSave = () => resolve({ data: {} }); }));
    render(<Harness initialNotesContent="hello" />);
    await typeAtEnd(" saved");
    fireEvent.click(screen.getByTestId("notes-save-button"));
    await typeAtEnd(" more");
    act(() => { finishSave(); });
    expect(await screen.findByTestId("notes-message")).toHaveTextContent("Notes saved");
    expect(screen.getByTestId("notes-dirty-indicator")).toBeInTheDocument();
  });

  it("clears the editor on every delete, including a second one", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TestNotes testData={testData} authPermission={AuthPermission.Admin} initialNotesContent="first notes" />);
    await getEditor();
    fireEvent.click(screen.getByTestId("notes-delete-button"));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toHaveTextContent("first notes"));
    // Write and save new notes, then delete again
    await typeAtEnd("second notes");
    fireEvent.click(screen.getByTestId("notes-save-button"));
    const deleteButton = await screen.findByTestId("notes-delete-button");
    fireEvent.click(deleteButton);
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toHaveTextContent("second notes"));
  });

  describe("unsaved-changes link guard", () => {
    // Stands in for next/link's handler: it only runs if the guard let the click through.
    // It also cancels the default so jsdom doesn't try to navigate.
    let linkHandler: ReturnType<typeof vi.fn>;
    const renderWithLinks = () => {
      linkHandler = vi.fn((event: React.MouseEvent) => event.preventDefault());
      render(
        <>
          <a href="/calendar" onClick={linkHandler}>Calendar</a>
          <a href="#findings" onClick={linkHandler}>Same page</a>
          <a href="/calendar" target="_blank" onClick={linkHandler}>New tab</a>
          <Harness initialNotesContent="hello" />
        </>
      );
    };
    const fireBeforeUnload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it("does nothing without unsaved changes", async () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderWithLinks();
      await getEditor();
      fireEvent.click(screen.getByText("Calendar"));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(linkHandler).toHaveBeenCalledTimes(1);
    });

    it("stops the navigation when the user cancels", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWithLinks();
      await typeAtEnd(" world");
      const notPrevented = fireEvent.click(screen.getByText("Calendar"));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(notPrevented).toBe(false);
      expect(linkHandler).not.toHaveBeenCalled();
      expect(screen.getByTestId("notes-dirty-indicator")).toBeInTheDocument();
    });

    it("lets the navigation through when the user confirms, without a second unload prompt", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWithLinks();
      await typeAtEnd(" world");
      fireEvent.click(screen.getByText("Calendar"));
      expect(linkHandler).toHaveBeenCalledTimes(1);
      expect(fireBeforeUnload()).toBe(false);
    });

    it("ignores modifier clicks, new-tab links, and same-page links", async () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderWithLinks();
      await typeAtEnd(" world");
      fireEvent.click(screen.getByText("Calendar"), { ctrlKey: true });
      fireEvent.click(screen.getByText("New tab"));
      fireEvent.click(screen.getByText("Same page"));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(linkHandler).toHaveBeenCalledTimes(3);
    });

    it("stops guarding once the notes are saved", async () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderWithLinks();
      await typeAtEnd(" world");
      fireEvent.click(screen.getByTestId("notes-save-button"));
      await waitFor(() => expect(screen.queryByTestId("notes-dirty-indicator")).not.toBeInTheDocument());
      fireEvent.click(screen.getByText("Calendar"));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(linkHandler).toHaveBeenCalledTimes(1);
    });
  });
});
