import { fireEvent, render, screen } from "@testing-library/react";
import EditorToolbar from "./EditorToolbar";
import React from "react";

function makeChain () {
  const chain: Record<string, any> = {
    run: vi.fn()
  };
  const chainMethods = [
    "focus", "toggleBold", "toggleItalic", "toggleUnderline", "toggleStrike",
    "toggleCode", "toggleHeading", "toggleBulletList", "toggleOrderedList",
    "toggleTaskList", "toggleBlockquote", "toggleCodeBlock", "setHorizontalRule",
    "extendMarkRange", "setLink", "unsetLink", "setImage", "insertTable", "undo", "redo"
  ];
  for (const method of chainMethods) {
    chain[method] = vi.fn((..._args: any[]) => chain);
  }
  return chain;
}

function makeMockEditor (overrides: Partial<Record<string, any>> = {}) {
  const chain = makeChain();
  const editor = {
    chain: vi.fn(() => chain),
    isActive: vi.fn((_name: string, _attrs?: any) => false),
    getAttributes: vi.fn((_name: string) => ({})),
    can: vi.fn(() => ({ undo: () => true, redo: () => true })),
    ...overrides
  };
  return { editor, chain };
}

describe("EditorToolbar", () => {
  describe("null editor", () => {
    it("renders nothing when editor is null", () => {
      const { container } = render(<EditorToolbar editor={null} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("toolbar structure", () => {
    it("has toolbar role with accessible label", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      expect(screen.getByRole("toolbar", { name: "Formatting toolbar" })).toBeInTheDocument();
    });
  });

  describe("text formatting buttons", () => {
    it("clicking Bold calls toggleBold and run", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Bold"));
      expect(chain.toggleBold).toHaveBeenCalled();
      expect(chain.run).toHaveBeenCalled();
    });

    it("clicking Italic calls toggleItalic", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Italic"));
      expect(chain.toggleItalic).toHaveBeenCalled();
    });

    it("clicking Underline calls toggleUnderline", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Underline"));
      expect(chain.toggleUnderline).toHaveBeenCalled();
    });

    it("clicking Strikethrough calls toggleStrike", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Strikethrough"));
      expect(chain.toggleStrike).toHaveBeenCalled();
    });

    it("clicking Inline code calls toggleCode", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Inline code"));
      expect(chain.toggleCode).toHaveBeenCalled();
    });
  });

  describe("heading buttons", () => {
    it("clicking H1 calls toggleHeading with level 1", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Heading 1"));
      expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 1 });
    });

    it("clicking H2 calls toggleHeading with level 2", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Heading 2"));
      expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    });

    it("clicking H3 calls toggleHeading with level 3", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Heading 3"));
      expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 3 });
    });
  });

  describe("list buttons", () => {
    it("clicking Bullet list calls toggleBulletList", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Bullet list"));
      expect(chain.toggleBulletList).toHaveBeenCalled();
    });

    it("clicking Ordered list calls toggleOrderedList", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Ordered list"));
      expect(chain.toggleOrderedList).toHaveBeenCalled();
    });

    it("clicking Task list calls toggleTaskList", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Task list"));
      expect(chain.toggleTaskList).toHaveBeenCalled();
    });
  });

  describe("block buttons", () => {
    it("clicking Blockquote calls toggleBlockquote", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Blockquote"));
      expect(chain.toggleBlockquote).toHaveBeenCalled();
    });

    it("clicking Code block calls toggleCodeBlock", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Code block"));
      expect(chain.toggleCodeBlock).toHaveBeenCalled();
    });

    it("clicking Horizontal rule calls setHorizontalRule", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Horizontal rule"));
      expect(chain.setHorizontalRule).toHaveBeenCalled();
    });
  });

  describe("insert buttons", () => {
    it("clicking Insert table calls insertTable with 3x3 header config", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert table"));
      expect(chain.insertTable).toHaveBeenCalledWith({ rows: 3, cols: 3, withHeaderRow: true });
    });
  });

  describe("undo / redo buttons", () => {
    it("clicking Undo calls undo chain method", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Undo"));
      expect(chain.undo).toHaveBeenCalled();
    });

    it("clicking Redo calls redo chain method", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Redo"));
      expect(chain.redo).toHaveBeenCalled();
    });

    it("Undo button is disabled when editor.can().undo() returns false", () => {
      const { editor } = makeMockEditor({
        can: vi.fn(() => ({ undo: () => false, redo: () => true }))
      });
      render(<EditorToolbar editor={editor as any} />);
      expect(screen.getByTitle("Undo")).toBeDisabled();
    });

    it("Redo button is disabled when editor.can().redo() returns false", () => {
      const { editor } = makeMockEditor({
        can: vi.fn(() => ({ undo: () => true, redo: () => false }))
      });
      render(<EditorToolbar editor={editor as any} />);
      expect(screen.getByTitle("Redo")).toBeDisabled();
    });

    it("Undo button is enabled when editor.can().undo() returns true", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      expect(screen.getByTitle("Undo")).not.toBeDisabled();
    });
  });

  describe("LinkDialog", () => {
    it("clicking Insert link button opens the link dialog", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      expect(screen.getByText("Insert Link")).toBeInTheDocument();
    });

    it("typing a URL and clicking Apply calls setLink with the URL", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://example.com" } });
      fireEvent.click(screen.getByText("Apply"));
      expect(chain.setLink).toHaveBeenCalledWith({ href: "https://example.com" });
    });

    it("clicking Apply with an empty URL calls unsetLink", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      fireEvent.click(screen.getByText("Apply"));
      expect(chain.unsetLink).toHaveBeenCalled();
    });

    it("shows Remove Link button when a link is active", () => {
      const { editor } = makeMockEditor({
        isActive: vi.fn((name: string) => name === "link")
      });
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      expect(screen.getByText("Remove Link")).toBeInTheDocument();
    });

    it("clicking Remove Link calls unsetLink", () => {
      const { editor, chain } = makeMockEditor({
        isActive: vi.fn((name: string) => name === "link")
      });
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      fireEvent.click(screen.getByText("Remove Link"));
      expect(chain.unsetLink).toHaveBeenCalled();
    });

    it("closes dialog after clicking Apply", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      fireEvent.click(screen.getByText("Apply"));
      expect(screen.queryByText("Insert Link")).not.toBeInTheDocument();
    });

    it("closes dialog after clicking Remove Link", () => {
      const { editor } = makeMockEditor({
        isActive: vi.fn((name: string) => name === "link")
      });
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert link"));
      fireEvent.click(screen.getByText("Remove Link"));
      expect(screen.queryByText("Insert Link")).not.toBeInTheDocument();
    });
  });

  describe("ImageDialog", () => {
    it("clicking Insert image button opens the image dialog", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert image"));
      expect(screen.getByText("Insert Image")).toBeInTheDocument();
    });

    it("typing a URL and clicking Insert calls setImage with src", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert image"));
      fireEvent.change(screen.getByLabelText("Image URL"), { target: { value: "https://example.com/img.png" } });
      fireEvent.click(screen.getByText("Insert"));
      expect(chain.setImage).toHaveBeenCalledWith({ src: "https://example.com/img.png" });
    });

    it("does not call setImage when URL is empty", () => {
      const { editor, chain } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert image"));
      fireEvent.click(screen.getByText("Insert"));
      expect(chain.setImage).not.toHaveBeenCalled();
    });

    it("closes dialog after clicking Insert", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert image"));
      fireEvent.change(screen.getByLabelText("Image URL"), { target: { value: "https://example.com/img.png" } });
      fireEvent.click(screen.getByText("Insert"));
      expect(screen.queryByText("Insert Image")).not.toBeInTheDocument();
    });

    it("closes dialog when URL is empty and Insert is clicked", () => {
      const { editor } = makeMockEditor();
      render(<EditorToolbar editor={editor as any} />);
      fireEvent.click(screen.getByTitle("Insert image"));
      fireEvent.click(screen.getByText("Insert"));
      expect(screen.queryByText("Insert Image")).not.toBeInTheDocument();
    });
  });
});
