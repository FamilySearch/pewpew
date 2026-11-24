import { type Editor, EditorContent } from "@tiptap/react";
import { EditorWrapper } from "./editorStyles";
import React from "react";

export default function MarkdownEditor ({ editor }: { editor: Editor | null }) {
  if (!editor) { return null; }

  return (
    <EditorWrapper>
      <EditorContent editor={editor} />
    </EditorWrapper>
  );
}
