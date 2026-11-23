import { EditorContent, useEditor } from "@tiptap/react";
import React, { useEffect } from "react";
import { EditorWrapper } from "./editorStyles";
import getExtensions from "./tiptapExtensions";

export default function MarkdownPreview ({ content }: { content: string }) {
  const previewEditor = useEditor({
    extensions: getExtensions(),
    content,
    contentType: "markdown",
    editable: false,
    immediatelyRender: true
  });

  // Update the one preview editor in place rather than destroying and recreating it for every content change
  useEffect(() => {
    if (previewEditor && !previewEditor.isDestroyed) {
      previewEditor.commands.setContent(content, { contentType: "markdown", emitUpdate: false });
    }
  }, [content, previewEditor]);

  if (!previewEditor) { return null; }

  return (
    <EditorWrapper>
      <EditorContent editor={previewEditor} />
    </EditorWrapper>
  );
}
