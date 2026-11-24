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
  /** Bumped to remount the editor with initialContent even when the string is unchanged (Generate Template). */
  editorKey: number;
}

function TestNotesInner ({ testData, authPermission, initialNotesContent, isExpanded, onToggle }: TestNotesProps): JSX.Element {
  const { isDirty, setIsDirty } = useNotesContext();
  const hasInitialContent = initialNotesContent !== undefined;
  const [notesState, setNotesState] = useState<NotesState>({
    initialContent: hasInitialContent ? initialNotesContent : "",
    isLoading: !hasInitialContent,
    isSaving: false,
    hasNotes: hasInitialContent && initialNotesContent.length > 0,
    editorKey: 0
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
        // Raw text: axios would otherwise JSON-parse notes that happen to look like JSON (e.g. "123" or "null")
        const response: AxiosResponse<string> = await axios.get(url, { responseType: "text", transformResponse: [] });
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

  // Warn before leaving with unsaved changes. A capture-phase click listener catches in-app links (the nav bar's
  // next/link LinkButtons and plain anchors) before next/link handles them, so a cancelled click simply never
  // navigates. beforeunload covers reload, closing the tab, and typed URLs. Browser Back/Forward to another page
  // isn't guarded: cancelling a popstate means rewinding history, which fights the router.
  const leaveConfirmedRef = React.useRef(false);
  useEffect(() => {
    if (!isDirty) { return; }
    leaveConfirmedRef.current = false;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Already confirmed through the link guard below; don't ask twice for a plain <a> page load
      if (leaveConfirmedRef.current) { return; }
      event.preventDefault();
      event.returnValue = ""; // Required by some browsers to show the prompt
    };
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) { return; }
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      destination.hash = "";
      current.hash = "";
      // Other sites open with their own unload prompt; links to this same URL don't leave the page
      if (destination.origin !== current.origin || destination.href === current.href) { return; }
      if (window.confirm("You have unsaved notes. Leave this page and discard them?")) {
        leaveConfirmedRef.current = true;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [isDirty]);

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
    if (!content.trim()) {
      setState({ message: "Notes are empty. Use Delete to remove saved notes.", messageType: "error" });
      return;
    }

    setState({ isSaving: true });
    try {
      const url = formatPageHref(API_NOTES_FORMAT(testData.s3Folder));
      await axios.put(url, { content }, { headers: { "Content-Type": "application/json" } });
      setState({ isSaving: false, message: "Notes saved", messageType: "success", hasNotes: true });
      // Anything typed while the PUT was in flight wasn't saved, so it stays dirty
      if (editorContentRef.current?.() === content) { setIsDirty(false); }
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
      // Bump editorKey so the editor clears even when initialContent was already "" (an earlier delete)
      setNotesState((old) => ({ ...old, isSaving: false, initialContent: "", message: "Notes deleted", messageType: "success", hasNotes: false, editorKey: old.editorKey + 1 }));
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
        // Bump editorKey so the editor remounts even when the template equals the last loaded content
        setNotesState((old) => ({ ...old, initialContent: response.data.markdown, editorKey: old.editorKey + 1 }));
        setIsDirty(true);
      }
    } catch (error) {
      log("Error generating template", LogLevel.ERROR, error);
      setState({ message: "Failed to generate template", messageType: "error" });
    }
  }, [testData.s3Folder, setIsDirty]);

  // When isExpanded is explicitly false the section is collapsed; undefined means uncontrolled (always visible).
  const showContent = isExpanded !== false;
  // The editor mounts on first expand and then stays mounted (hidden while collapsed), so a draft survives every way
  // the section can collapse, including browser Back removing ?notes=1. Never-expanded panels don't pay for TipTap.
  const [hasExpanded, setHasExpanded] = useState(showContent);
  if (showContent && !hasExpanded) { setHasExpanded(true); }

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

      {hasExpanded && !state.isLoading && (
        <div hidden={!showContent} data-testid="notes-editor-container">
          <TipTapEditorInner
            key={state.editorKey}
            initialContent={state.initialContent}
            editable={canEdit}
            editorContentRef={editorContentRef}
          />
          <StatusBar />
        </div>
      )}
    </NotesSection>
  );
}

export function TestNotes (props: TestNotesProps): JSX.Element {
  return (
    // Keyed on the folder so a different test always starts with a clean editor and dirty state
    <NotesProvider key={props.testData.s3Folder}>
      <TestNotesInner {...props} />
    </NotesProvider>
  );
}

export default TestNotes;
