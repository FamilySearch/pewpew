import { EditorContent, useEditor } from "@tiptap/react";
import { EditorWrapper } from "./editorStyles";
import React from "react";
import getExtensions from "./tiptapExtensions";

export default function MarkdownPreview ({ content }: { content: string }) {
  const previewEditor = useEditor({
    extensions: getExtensions(),
    content,
    contentType: "markdown",
    editable: false,
    immediatelyRender: true
  }, [content]);

  if (!previewEditor) { return null; }

  return (
    <EditorWrapper>
      <EditorContent editor={previewEditor} />
    </EditorWrapper>
  );
}
