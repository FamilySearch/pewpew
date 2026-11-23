import {
  DialogBox,
  DialogButton,
  DialogButtons,
  DialogInput,
  DialogLabel,
  DialogOverlay,
  DialogTitle,
  Toolbar,
  ToolbarBtn,
  ToolbarGroup
} from "./toolbarStyles";
import React, { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";

function LinkDialog ({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const handleOpen = useCallback(() => {
    setUrl(editor.getAttributes("link").href || "");
    setOpen(true);
  }, [editor]);

  const handleApply = useCallback(() => {
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setOpen(false);
  }, [url, editor]);

  const handleRemove = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpen(false);
  }, [editor]);

  const hasExistingLink = editor.isActive("link");

  return (
    <>
      <ToolbarBtn onClick={handleOpen} $isActive={hasExistingLink} title="Insert link">
        &#128279;
      </ToolbarBtn>
      {open && (
        <DialogOverlay onClick={() => setOpen(false)}>
          <DialogBox onClick={(e) => e.stopPropagation()}>
            <DialogTitle>Insert Link</DialogTitle>
            <DialogLabel htmlFor="link-url-input">URL</DialogLabel>
            <DialogInput
              id="link-url-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              onKeyDown={(e) => { if (e.key === "Enter") { handleApply(); } }}
              autoFocus
            />
            <DialogButtons>
              {hasExistingLink && (
                <DialogButton $variant="danger" onClick={handleRemove}>Remove Link</DialogButton>
              )}
              <DialogButton $variant="primary" onClick={handleApply}>Apply</DialogButton>
            </DialogButtons>
          </DialogBox>
        </DialogOverlay>
      )}
    </>
  );
}

function ImageDialog ({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const handleInsert = useCallback(() => {
    if (url.trim()) {
      editor.chain().focus().setImage({ src: url }).run();
    }
    setOpen(false);
  }, [url, editor]);

  return (
    <>
      <ToolbarBtn onClick={() => { setUrl(""); setOpen(true); }} title="Insert image">
        &#128247;
      </ToolbarBtn>
      {open && (
        <DialogOverlay onClick={() => setOpen(false)}>
          <DialogBox onClick={(e) => e.stopPropagation()}>
            <DialogTitle>Insert Image</DialogTitle>
            <DialogLabel htmlFor="image-url-input">Image URL</DialogLabel>
            <DialogInput
              id="image-url-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/image.png"
              onKeyDown={(e) => { if (e.key === "Enter") { handleInsert(); } }}
              autoFocus
            />
            <DialogButtons>
              <DialogButton $variant="primary" onClick={handleInsert}>Insert</DialogButton>
            </DialogButtons>
          </DialogBox>
        </DialogOverlay>
      )}
    </>
  );
}

export default function EditorToolbar ({ editor }: { editor: Editor | null }) {
  const addTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) { return null; }

  return (
    <Toolbar role="toolbar" aria-label="Formatting toolbar">
      {/* Text formatting */}
      <ToolbarGroup>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} $isActive={editor.isActive("bold")} title="Bold">
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} $isActive={editor.isActive("italic")} title="Italic">
          <em>I</em>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} $isActive={editor.isActive("underline")} title="Underline">
          <span style={{ textDecoration: "underline" }}>U</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} $isActive={editor.isActive("strike")} title="Strikethrough">
          <span style={{ textDecoration: "line-through" }}>S</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} $isActive={editor.isActive("code")} title="Inline code">
          {"<>"}
        </ToolbarBtn>
      </ToolbarGroup>

      {/* Headings */}
      <ToolbarGroup>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} $isActive={editor.isActive("heading", { level: 1 })} title="Heading 1">
          H1
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} $isActive={editor.isActive("heading", { level: 2 })} title="Heading 2">
          H2
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} $isActive={editor.isActive("heading", { level: 3 })} title="Heading 3">
          H3
        </ToolbarBtn>
      </ToolbarGroup>

      {/* Lists */}
      <ToolbarGroup>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} $isActive={editor.isActive("bulletList")} title="Bullet list">
          &#8226;
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} $isActive={editor.isActive("orderedList")} title="Ordered list">
          1.
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleTaskList().run()} $isActive={editor.isActive("taskList")} title="Task list">
          &#9745;
        </ToolbarBtn>
      </ToolbarGroup>

      {/* Blocks */}
      <ToolbarGroup>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} $isActive={editor.isActive("blockquote")} title="Blockquote">
          &#8220;
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} $isActive={editor.isActive("codeBlock")} title="Code block">
          {"{ }"}
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
          &#8213;
        </ToolbarBtn>
      </ToolbarGroup>

      {/* Insert */}
      <ToolbarGroup>
        <LinkDialog editor={editor} />
        <ImageDialog editor={editor} />
        <ToolbarBtn onClick={addTable} title="Insert table">
          &#9638;
        </ToolbarBtn>
      </ToolbarGroup>

      {/* Undo/Redo */}
      <ToolbarGroup>
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
          &#8617;
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
          &#8618;
        </ToolbarBtn>
      </ToolbarGroup>
    </Toolbar>
  );
}
