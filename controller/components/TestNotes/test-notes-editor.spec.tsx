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
  await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeNull());
  fireEvent.click(screen.getByTestId("notes-collapse-button"));
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
});
