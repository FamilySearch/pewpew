import React, { useCallback, useEffect } from "react";
import getExtensions, { getNotesMarkdown } from "./tiptapExtensions";
import EditorLayout from "./EditorLayout";
import { useEditor } from "@tiptap/react";
import { useNotesContext } from "./NotesContext";

interface TipTapEditorInnerProps {
  initialContent: string;
  editable: boolean;
  editorContentRef: React.RefObject<(() => string) | null>;
}

export default function TipTapEditorInner ({ initialContent, editable, editorContentRef }: TipTapEditorInnerProps) {
  const { setIsDirty, updateStats } = useNotesContext();

  const editor = useEditor({
    extensions: getExtensions(),
    content: initialContent,
    contentType: "markdown",
    editable,
    // Rendered client-side only (dynamic import with ssr: false), so render on mount.
    immediatelyRender: true,
    // v3 stopped re-rendering on every transaction by default. The toolbar reads
    // editor.isActive()/can() during render, so opt back in to keep its state current.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => {
      setIsDirty(true);
      updateStats(ed);
    },
    onCreate: ({ editor: ed }) => {
      updateStats(ed);
    }
  });

  const getContent = useCallback((): string => (editor ? getNotesMarkdown(editor) : ""), [editor]);

  // Expose content getter to parent
  useEffect(() => {
    if (editor) {
      editorContentRef.current = () => getNotesMarkdown(editor);
    }
    return () => { editorContentRef.current = null; };
  }, [editor, editorContentRef]);

  // Update content when initialContent changes (template generation, reload)
  useEffect(() => {
    if (editor && initialContent !== undefined) {
      if (getNotesMarkdown(editor) !== initialContent) {
        // emitUpdate: false (v3 defaults to true) so loading content does not mark notes dirty;
        // callers that need dirty (Generate Template) set it themselves.
        editor.commands.setContent(initialContent, { contentType: "markdown", emitUpdate: false });
        updateStats(editor);
      }
    }
  }, [initialContent, editor, updateStats]);

  return <EditorLayout editor={editor} getContent={getContent} />;
}
