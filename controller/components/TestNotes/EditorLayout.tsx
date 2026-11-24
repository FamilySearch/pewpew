import React, { useEffect, useRef, useState } from "react";
import { VIEW_MODES, useNotesContext } from "./NotesContext";
import type { Editor } from "@tiptap/react";
import EditorToolbar from "./EditorToolbar";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import styled from "styled-components";

const LayoutContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const SplitPane = styled.div`
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;

  > * {
    flex: 1;
    min-width: 0;
  }
`;

const SinglePane = styled.div`
  flex: 1;
  min-height: 0;
`;

// In split view the preview trails typing by this much, instead of re-serializing and re-rendering on every keystroke.
export const PREVIEW_DEBOUNCE_MS = 300;

export default function EditorLayout ({ editor, getContent, editable = true }: { editor: Editor | null; getContent: () => string; editable?: boolean }) {
  const { viewMode } = useNotesContext();

  const showEditor = viewMode === VIEW_MODES.EDIT || viewMode === VIEW_MODES.SPLIT;
  const showPreview = viewMode === VIEW_MODES.PREVIEW || viewMode === VIEW_MODES.SPLIT;
  const isSplit = viewMode === VIEW_MODES.SPLIT;

  // The editor re-renders on every transaction, so this effect runs per keystroke: debounce while typing in split view,
  // and update right away when the view mode changes so switching to the preview never shows stale content.
  const [previewContent, setPreviewContent] = useState("");
  const lastViewModeRef = useRef<typeof viewMode | undefined>(undefined);
  useEffect(() => {
    if (!showPreview) { return; }
    const viewModeChanged = lastViewModeRef.current !== viewMode;
    lastViewModeRef.current = viewMode;
    if (viewModeChanged || !isSplit) {
      setPreviewContent(getContent());
      return;
    }
    const timer = setTimeout(() => setPreviewContent(getContent()), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  return (
    <LayoutContainer data-testid="notes-editor-layout">
      {/* TipTap commands still run when editable is false, so read-only users get no toolbar */}
      {showEditor && editable && <EditorToolbar editor={editor} />}
      {isSplit ? (
        <SplitPane>
          {showEditor && <MarkdownEditor editor={editor} />}
          {showPreview && <MarkdownPreview content={previewContent} />}
        </SplitPane>
      ) : (
        <SinglePane>
          {showEditor && <MarkdownEditor editor={editor} />}
          {showPreview && <MarkdownPreview content={previewContent} />}
        </SinglePane>
      )}
    </LayoutContainer>
  );
}
