import { API_NOTES_FORMAT, API_NOTES_TEMPLATE_FORMAT } from "../../types/pages";
import { LogLevel, log } from "../../src/log";
import { NotesProvider, useNotesContext } from "./NotesContext";
import React, { JSX, useCallback, useEffect, useState } from "react";
import axios, { AxiosResponse } from "axios";
import { AuthPermission } from "../../types";
import ExportMenu from "./ExportMenu";
import StatusBar from "./StatusBar";
import ViewModeToggle from "./ViewModeToggle";
import { colors } from "./editorStyles";
import dynamic from "next/dynamic";
import { formatPageHref } from "../../src/clientutil";
import styled from "styled-components";

// Dynamic import to avoid SSR issues with TipTap
const TipTapEditorInner = dynamic(() => import("./TipTapEditorInner"), { ssr: false });

const NotesSection = styled.div`
  display: flex;
  flex-direction: column;
  padding: 20px;
  background: ${colors.surface};
  border: 1px solid ${colors.borders};
  border-radius: 8px;
  margin-top: 20px;
`;

const NotesHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
`;

const NotesTitle = styled.h2`
  margin: 0;
  color: ${colors.bright};
  font-size: 1.3em;
  font-weight: 600;
`;

const HeaderControls = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const ActionBtn = styled.button<{ $variant?: "primary" | "danger" | "secondary" }>`
  padding: 8px 16px;
  border: 1px solid ${colors.borders};
  border-radius: 6px;
  font-family: "Noto Sans", sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;

  background: ${({ $variant }) => {
    if ($variant === "primary") { return colors.accent; }
    if ($variant === "danger") { return colors.danger; }
    return colors.inputBg;
  }};
  color: ${({ $variant }) =>
    $variant === "primary" || $variant === "danger" ? colors.bg : colors.text};

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const MessageBar = styled.div<{ $type: "success" | "error" }>`
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  background: ${({ $type }) => $type === "success" ? "rgb(23, 54, 30)" : "rgb(64, 11, 16)"};
  color: ${({ $type }) => $type === "success" ? "rgb(168, 234, 183)" : "rgb(230, 155, 162)"};
`;

const DirtyIndicator = styled.span`
  color: ${colors.accent};
  font-size: 20px;
  line-height: 1;
`;

export interface TestNotesTestData {
  s3Folder: string;
}

export interface TestNotesProps {
  testData: TestNotesTestData;
  authPermission?: AuthPermission;
  /** Pre-populated content for Storybook. Skips API fetch when set. */
  initialNotesContent?: string;
  /** Controlled expanded state. Omit to always show (Storybook / uncontrolled). */
  isExpanded?: boolean;
  /** Called when the user clicks the collapse/expand button. Only rendered when provided. */
  onToggle?: () => void;
}

export interface NotesState {
  initialContent: string;
  isLoading: boolean;
  isSaving: boolean;
  message?: string;
  messageType?: "success" | "error";
  hasNotes: boolean;
}

function TestNotesInner ({ testData, authPermission, initialNotesContent, isExpanded, onToggle }: TestNotesProps): JSX.Element {
  const { isDirty, setIsDirty } = useNotesContext();
  const hasInitialContent = initialNotesContent !== undefined;
  const [notesState, setNotesState] = useState<NotesState>({
    initialContent: hasInitialContent ? initialNotesContent : "",
    isLoading: !hasInitialContent,
    isSaving: false,
    hasNotes: hasInitialContent && initialNotesContent.length > 0
  });
  const state = notesState;
  const setState = (newState: Partial<NotesState>) => setNotesState((old) => ({ ...old, ...newState }));

  const canEdit = authPermission !== undefined && authPermission >= AuthPermission.User;
  const canDelete = authPermission !== undefined && authPermission >= AuthPermission.Admin;

  // Ref to get current editor content
  const editorContentRef = React.useRef<(() => string) | null>(null);

  // Load existing notes or template on mount (skip if pre-populated via initialNotesContent)
  useEffect(() => {
    if (hasInitialContent) { return; }
    const loadNotes = async () => {
      try {
        const url = formatPageHref(API_NOTES_FORMAT(testData.s3Folder));
        const response: AxiosResponse = await axios.get(url);
        if (response.status === 204) {
          // No notes yet, try loading a template
          try {
            const templateUrl = formatPageHref(API_NOTES_TEMPLATE_FORMAT(testData.s3Folder));
            const templateResponse: AxiosResponse = await axios.get(templateUrl);
            setState({ initialContent: templateResponse.data.markdown || "", isLoading: false, hasNotes: false });
          } catch {
            setState({ initialContent: "", isLoading: false, hasNotes: false });
          }
        } else {
          setState({ initialContent: response.data, isLoading: false, hasNotes: true });
        }
      } catch (error: unknown) {
        log("Error loading notes", LogLevel.ERROR, error);
        setState({ isLoading: false, message: "Failed to load notes", messageType: "error" });
      }
    };
    loadNotes();
  }, [testData.s3Folder, hasInitialContent]);

  // Clear success messages after 5 seconds
  useEffect(() => {
    if (state.messageType === "success" && state.message) {
      const timer = setTimeout(() => setState({ message: undefined, messageType: undefined }), 5000);
      return () => clearTimeout(timer);
    }
  }, [state.message, state.messageType]);

  const handleSave = useCallback(async () => {
    if (!editorContentRef.current) { return; }
    const content = editorContentRef.current();
    if (!content) { return; }

    setState({ isSaving: true });
    try {
      const url = formatPageHref(API_NOTES_FORMAT(testData.s3Folder));
      await axios.put(url, { content }, { headers: { "Content-Type": "application/json" } });
      setState({ isSaving: false, message: "Notes saved", messageType: "success", hasNotes: true });
      setIsDirty(false);
    } catch (error) {
      log("Error saving notes", LogLevel.ERROR, error);
      setState({ isSaving: false, message: "Failed to save notes", messageType: "error" });
    }
  }, [testData.s3Folder, setIsDirty]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm("Are you sure you want to delete these notes?")) { return; }
    setState({ isSaving: true });
    try {
      const url = formatPageHref(API_NOTES_FORMAT(testData.s3Folder));
      await axios.delete(url);
      setState({ isSaving: false, initialContent: "", message: "Notes deleted", messageType: "success", hasNotes: false });
      setIsDirty(false);
    } catch (error) {
      log("Error deleting notes", LogLevel.ERROR, error);
      setState({ isSaving: false, message: "Failed to delete notes", messageType: "error" });
    }
  }, [testData.s3Folder, setIsDirty]);

  const handleGenerateTemplate = useCallback(async () => {
    const hasContent = editorContentRef.current?.()?.trim();
    if (hasContent && !window.confirm("This will replace your current notes with a fresh template. Continue?")) {
      return;
    }
    try {
      const templateUrl = formatPageHref(API_NOTES_TEMPLATE_FORMAT(testData.s3Folder));
      const response: AxiosResponse = await axios.get(templateUrl);
      if (response.data.markdown) {
        setState({ initialContent: response.data.markdown });
        setIsDirty(true);
      }
    } catch (error) {
      log("Error generating template", LogLevel.ERROR, error);
      setState({ message: "Failed to generate template", messageType: "error" });
    }
  }, [testData.s3Folder, setIsDirty]);

  // When isExpanded is explicitly false the section is collapsed; undefined means uncontrolled (always visible).
  const showContent = isExpanded !== false;

  return (
    <NotesSection data-testid={state.isLoading ? "notes-loading" : "notes-editor"}>
      <NotesHeader>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NotesTitle>Test Notes</NotesTitle>
          {isDirty && <DirtyIndicator data-testid="notes-dirty-indicator" title="Unsaved changes">&#9679;</DirtyIndicator>}
        </div>
        <HeaderControls>
          {showContent && !state.isLoading && <ViewModeToggle />}
          {showContent && !state.isLoading && canEdit && (
            <>
              <ActionBtn data-testid="notes-generate-template-button" onClick={handleGenerateTemplate} $variant="secondary" disabled={state.isSaving}>
                Generate Template
              </ActionBtn>
              <ActionBtn data-testid="notes-save-button" onClick={handleSave} $variant="primary" disabled={state.isSaving || !isDirty}>
                {state.isSaving ? "Saving..." : "Save"}
              </ActionBtn>
            </>
          )}
          {showContent && !state.isLoading && (
            <ExportMenu getContent={editorContentRef} s3Folder={testData.s3Folder} hasNotes={state.hasNotes} />
          )}
          {showContent && !state.isLoading && canDelete && state.hasNotes && (
            <ActionBtn data-testid="notes-delete-button" onClick={handleDelete} $variant="danger" disabled={state.isSaving}>
              Delete
            </ActionBtn>
          )}
          {onToggle && (
            <ActionBtn data-testid="notes-collapse-button" onClick={onToggle} $variant="secondary">
              {isExpanded ? "▲ Collapse" : "▼ Expand"}
            </ActionBtn>
          )}
        </HeaderControls>
      </NotesHeader>

      {showContent && state.isLoading && (
        <div>Loading notes...</div>
      )}

      {showContent && !state.isLoading && state.message && (
        <MessageBar data-testid="notes-message" $type={state.messageType || "success"}>{state.message}</MessageBar>
      )}

      {showContent && !state.isLoading && authPermission === undefined && (
        <MessageBar $type="error">
          You are not logged in. Sign in to edit notes.
        </MessageBar>
      )}

      {showContent && !state.isLoading && (
        <>
          <TipTapEditorInner
            initialContent={state.initialContent}
            editable={canEdit}
            editorContentRef={editorContentRef}
          />
          <StatusBar />
        </>
      )}
    </NotesSection>
  );
}

export function TestNotes (props: TestNotesProps): JSX.Element {
  return (
    <NotesProvider>
      <TestNotesInner {...props} />
    </NotesProvider>
  );
}

export default TestNotes;
