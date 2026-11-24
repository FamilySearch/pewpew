import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";

export type ViewMode = "edit" | "split" | "preview";

export interface NotesContextValue {
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  isDirty: boolean;
  setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  wordCount: number;
  charCount: number;
  updateStats: (editor: Editor | null) => void;
}

const NotesContext = createContext<NotesContextValue | undefined>(undefined);

export const VIEW_MODES: Record<string, ViewMode> = {
  EDIT: "edit",
  SPLIT: "split",
  PREVIEW: "preview"
};

export function NotesProvider ({ children }: { children: React.ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>(VIEW_MODES.EDIT);
  const [isDirty, setIsDirty] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  const updateStats = useCallback((editor: Editor | null) => {
    if (!editor) { return; }
    const text = editor.getText();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setWordCount(words);
    setCharCount(text.length);
  }, []);

  const value = useMemo(
    () => ({ viewMode, setViewMode, isDirty, setIsDirty, wordCount, charCount, updateStats }),
    [viewMode, isDirty, wordCount, charCount, updateStats]
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotesContext () {
  const ctx = useContext(NotesContext);
  if (!ctx) {
    throw new Error("useNotesContext must be used within a NotesProvider");
  }
  return ctx;
}

export default NotesContext;
