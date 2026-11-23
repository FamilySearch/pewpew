import React from "react";
import { colors } from "./editorStyles";
import styled from "styled-components";
import { useNotesContext } from "./NotesContext";

const StatusBarWrapper = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: ${colors.bg};
  border-top: 1px solid ${colors.borders};
  font-family: "Noto Sans", sans-serif;
  font-size: 12px;
  color: ${colors.muted};
`;

const Stat = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
`;

export default function StatusBar () {
  const { wordCount, charCount } = useNotesContext();

  return (
    <StatusBarWrapper role="status" aria-live="polite">
      <Stat>{wordCount} words</Stat>
      <Stat>{charCount} characters</Stat>
    </StatusBarWrapper>
  );
}
