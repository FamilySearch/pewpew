import { VIEW_MODES, useNotesContext } from "./NotesContext";
import type { Editor } from "@tiptap/react";
import EditorToolbar from "./EditorToolbar";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";
import React from "react";
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

export default function EditorLayout ({ editor, getContent }: { editor: Editor | null; getContent: () => string }) {
  const { viewMode } = useNotesContext();

  const showEditor = viewMode === VIEW_MODES.EDIT || viewMode === VIEW_MODES.SPLIT;
  const showPreview = viewMode === VIEW_MODES.PREVIEW || viewMode === VIEW_MODES.SPLIT;
  const isSplit = viewMode === VIEW_MODES.SPLIT;

  const previewContent = showPreview ? getContent() : "";

  return (
    <LayoutContainer data-testid="notes-editor-layout">
      {showEditor && <EditorToolbar editor={editor} />}
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
