import { VIEW_MODES, ViewMode, useNotesContext } from "./NotesContext";
import React from "react";
import { colors } from "./editorStyles";
import styled from "styled-components";

const ToggleWrapper = styled.div`
  display: inline-flex;
  background: ${colors.inputBg};
  border-radius: 6px;
  padding: 2px;
`;

const ToggleButton = styled.button<{ $isActive: boolean }>`
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  background: ${({ $isActive }) => $isActive ? colors.surface : "transparent"};
  color: ${({ $isActive }) => $isActive ? colors.accent : colors.muted};
  font-family: "Noto Sans", sans-serif;
  font-size: 13px;
  font-weight: ${({ $isActive }) => $isActive ? 600 : 500};
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  box-shadow: ${({ $isActive }) => $isActive ? "0 1px 3px rgba(0, 0, 0, 0.3)" : "none"};

  &:hover {
    color: ${colors.text};
  }
`;

const modes: { key: ViewMode; label: string }[] = [
  { key: VIEW_MODES.EDIT, label: "Edit" },
  { key: VIEW_MODES.SPLIT, label: "Split" },
  { key: VIEW_MODES.PREVIEW, label: "Preview" }
];

export default function ViewModeToggle () {
  const { viewMode, setViewMode } = useNotesContext();

  return (
    <ToggleWrapper role="tablist" aria-label="View mode">
      {modes.map((mode) => (
        <ToggleButton
          key={mode.key}
          type="button"
          role="tab"
          aria-selected={viewMode === mode.key}
          $isActive={viewMode === mode.key}
          onClick={() => setViewMode(mode.key)}
        >
          {mode.label}
        </ToggleButton>
      ))}
    </ToggleWrapper>
  );
}
