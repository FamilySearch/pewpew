// Integration tests with the real TipTap v3 editor (no editor mocks): toolbar commands,
// toolbar active-state updates, editing marks notes dirty, and the read-only preview.
import { NotesProvider, useNotesContext } from "./NotesContext";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import MarkdownPreview from "./MarkdownPreview";
import React from "react";
import TipTapEditorInner from "./TipTapEditorInner";
import ViewModeToggle from "./ViewModeToggle";

type ContentRef = React.RefObject<(() => string) | null>;

function DirtyProbe () {
  const { isDirty } = useNotesContext();
  return <span data-testid="is-dirty">{String(isDirty)}</span>;
}

/** Renders the real editor and returns the live TipTap instance (attached to its DOM node by TipTap). */
async function renderEditor (initialContent: string, editable = true) {
  const ref = React.createRef<(() => string) | null>() as ContentRef;
  render(
    <NotesProvider>
      <TipTapEditorInner initialContent={initialContent} editable={editable} editorContentRef={ref} />
      <DirtyProbe />
    </NotesProvider>
  );
  const dom = await waitFor(() => {
    const el = document.querySelector(".ProseMirror");
    expect(el).not.toBeNull();
    return el as HTMLElement & { editor: Editor };
  });
  return { editor: dom.editor, getMarkdown: () => ref.current!(), dom };
}

describe("editor integration (real TipTap)", () => {
  describe("toolbar commands produce markdown", () => {
    const cases: [string, string, string][] = [
      ["Bold", "hello", "**hello**"],
      ["Italic", "hello", "*hello*"],
      ["Strikethrough", "hello", "~~hello~~"],
      ["Inline code", "hello", "`hello`"],
      ["Heading 2", "hello", "## hello"],
      ["Bullet list", "hello", "- hello"],
      ["Ordered list", "hello", "1. hello"],
      ["Task list", "hello", "- [ ] hello"],
      ["Blockquote", "hello", "> hello"]
    ];

    for (const [title, input, expected] of cases) {
      it(`${title} → ${expected}`, async () => {
        const { editor, getMarkdown } = await renderEditor(input);
        act(() => { editor.commands.selectAll(); });
        fireEvent.click(screen.getByTitle(title));
        expect(getMarkdown()).toBe(expected);
      });
    }

    it("Code block wraps the text in a fence", async () => {
      const { editor, getMarkdown } = await renderEditor("hello");
      act(() => { editor.commands.selectAll(); });
      fireEvent.click(screen.getByTitle("Code block"));
      expect(getMarkdown()).toBe("```\nhello\n```");
    });

    it("Insert table adds a 3x3 pipe table with a header row", async () => {
      const { editor, getMarkdown } = await renderEditor("");
      act(() => { editor.commands.focus("end"); });
      fireEvent.click(screen.getByTitle("Insert table"));
      const lines = getMarkdown().split("\n").filter((line) => line.startsWith("|"));
      expect(lines).toHaveLength(4); // header + separator + 2 body rows
      expect(lines[1]).toMatch(/^\| -+ \| -+ \| -+ \|$/);
    });

    it("Insert link dialog applies the URL to the selection", async () => {
      const { editor, getMarkdown } = await renderEditor("dashboard");
      act(() => { editor.commands.selectAll(); });
      fireEvent.click(screen.getByTitle("Insert link"));
      fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://dt.example.com" } });
      fireEvent.click(screen.getByText("Apply"));
      expect(getMarkdown()).toBe("[dashboard](https://dt.example.com)");
    });

    it("Insert image dialog adds an image", async () => {
      const { editor, getMarkdown } = await renderEditor("");
      act(() => { editor.commands.focus("end"); });
      fireEvent.click(screen.getByTitle("Insert image"));
      fireEvent.change(screen.getByLabelText("Image URL"), { target: { value: "https://example.com/c.png" } });
      fireEvent.click(screen.getByText("Insert"));
      expect(getMarkdown()).toBe("![](https://example.com/c.png)");
    });

    it("Undo reverts the last change and Redo reapplies it", async () => {
      const { editor, getMarkdown } = await renderEditor("hello");
      act(() => { editor.commands.selectAll(); });
      fireEvent.click(screen.getByTitle("Bold"));
      expect(getMarkdown()).toBe("**hello**");
      fireEvent.click(screen.getByTitle("Undo"));
      expect(getMarkdown()).toBe("hello");
      fireEvent.click(screen.getByTitle("Redo"));
      expect(getMarkdown()).toBe("**hello**");
    });
  });

  describe("toolbar state follows the editor (shouldRerenderOnTransaction)", () => {
    it("marks Bold as pressed when the cursor moves into bold text", async () => {
      const { editor } = await renderEditor("plain **bold**");
      expect(screen.getByTitle("Bold")).toHaveAttribute("aria-pressed", "false");
      act(() => { editor.commands.setTextSelection(10); });
      expect(screen.getByTitle("Bold")).toHaveAttribute("aria-pressed", "true");
      act(() => { editor.commands.setTextSelection(2); });
      expect(screen.getByTitle("Bold")).toHaveAttribute("aria-pressed", "false");
    });

    it("enables Undo only after there is something to undo", async () => {
      const { editor } = await renderEditor("hello");
      expect(screen.getByTitle("Undo")).toBeDisabled();
      act(() => { editor.commands.insertContent(" world"); });
      expect(screen.getByTitle("Undo")).toBeEnabled();
    });
  });

  describe("dirty state", () => {
    it("marks notes dirty when the user edits", async () => {
      const { editor } = await renderEditor("hello");
      expect(screen.getByTestId("is-dirty")).toHaveTextContent("false");
      act(() => { editor.commands.insertContent(" world"); });
      expect(screen.getByTestId("is-dirty")).toHaveTextContent("true");
    });
  });

  describe("read-only", () => {
    it("is not editable when editable is false", async () => {
      const { dom } = await renderEditor("hello", false);
      expect(dom).toHaveAttribute("contenteditable", "false");
    });
  });
});

describe("MarkdownPreview (real TipTap)", () => {
  it("renders markdown as formatted, read-only content", async () => {
    render(<MarkdownPreview content={"## Findings\n\n- [x] p95 under **200ms**\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("200ms").tagName).toBe("STRONG");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(document.querySelector(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  });

  it("re-renders when the content changes", async () => {
    const { rerender } = render(<MarkdownPreview content={"## First"} />);
    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
    rerender(<MarkdownPreview content={"## Second"} />);
    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
  });
});

describe("split view preview (real TipTap)", () => {
  it("updates the preview after typing pauses, reusing the same preview editor", async () => {
    const ref = React.createRef<(() => string) | null>() as ContentRef;
    render(
      <NotesProvider>
        <ViewModeToggle />
        <TipTapEditorInner initialContent="hello" editable={true} editorContentRef={ref} />
      </NotesProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Split" }));
    const [editorDom, previewDom] = await waitFor(() => {
      const els = document.querySelectorAll(".ProseMirror");
      expect(els).toHaveLength(2);
      expect(els[1]).toHaveTextContent("hello");
      return Array.from(els) as (HTMLElement & { editor: Editor })[];
    });
    const previewEditor = previewDom.editor;

    act(() => { editorDom.editor.commands.insertContentAt(editorDom.editor.state.doc.content.size - 1, " world"); });
    // Debounced: the preview has not caught up on the same tick as the keystroke
    expect(previewDom).not.toHaveTextContent("hello world");

    await waitFor(() => expect(document.querySelectorAll(".ProseMirror")[1]).toHaveTextContent("hello world"));
    // Same editor instance updated in place, not torn down and rebuilt
    expect((document.querySelectorAll(".ProseMirror")[1] as HTMLElement & { editor: Editor }).editor).toBe(previewEditor);
  });

  it("shows current content immediately when switching to Preview", async () => {
    const ref = React.createRef<(() => string) | null>() as ContentRef;
    render(
      <NotesProvider>
        <ViewModeToggle />
        <TipTapEditorInner initialContent="hello" editable={true} editorContentRef={ref} />
      </NotesProvider>
    );
    const editorDom = await waitFor(() => {
      const el = document.querySelector(".ProseMirror");
      expect(el).not.toBeNull();
      return el as HTMLElement & { editor: Editor };
    });
    act(() => { editorDom.editor.commands.insertContentAt(editorDom.editor.state.doc.content.size - 1, " world"); });

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));

    expect(document.querySelector(".ProseMirror")).toHaveTextContent("hello world");
    expect(document.querySelector(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  });
});
