import React, { useCallback, useRef, useState } from "react";
import { API_NOTES_EXPORT_FORMAT } from "../../types/pages";
import { colors } from "./editorStyles";
import { formatPageHref } from "../../src/clientutil";
import styled from "styled-components";

const ExportContainer = styled.div`
  position: relative;
  display: inline-block;
`;

const ExportBtn = styled.button`
  padding: 6px 14px;
  border: 1px solid ${colors.borders};
  border-radius: 6px;
  background: ${colors.inputBg};
  color: ${colors.text};
  font-family: "Noto Sans", sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: ${colors.borders};
  }
`;

const DropdownMenu = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: ${colors.surface};
  border: 1px solid ${colors.borders};
  border-radius: 6px;
  min-width: 200px;
  z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
`;

const MenuItem = styled.button`
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: ${colors.text};
  font-family: "Noto Sans", sans-serif;
  font-size: 13px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${colors.inputBg};
  }

  &:first-child {
    border-radius: 6px 6px 0 0;
  }
  &:last-child {
    border-radius: 0 0 6px 6px;
  }
`;

export interface ExportMenuProps {
  getContent: React.RefObject<(() => string) | null>;
  s3Folder: string;
  hasNotes?: boolean;
}

export default function ExportMenu ({ getContent, s3Folder, hasNotes }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleExportMarkdown = useCallback(() => {
    const markdown = getContent.current?.();
    if (!markdown) { return; }
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notes-${s3Folder.replace("/", "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }, [getContent, s3Folder]);

  const handleExportConfluence = useCallback(() => {
    if (!hasNotes) { return; }
    const url = formatPageHref(API_NOTES_EXPORT_FORMAT(s3Folder)) + "?format=confluence";
    window.open(url, "_blank");
    setOpen(false);
  }, [s3Folder, hasNotes]);

  const handleCopyMarkdown = useCallback(async () => {
    const markdown = getContent.current?.();
    if (!markdown) { return; }
    await navigator.clipboard.writeText(markdown);
    setOpen(false);
  }, [getContent]);

  return (
    <ExportContainer ref={containerRef}>
      <ExportBtn data-testid="export-menu-toggle" onClick={() => setOpen(!open)}>Export &#9662;</ExportBtn>
      {open && (
        <DropdownMenu>
          <MenuItem onClick={handleExportMarkdown}>Download Markdown</MenuItem>
          <MenuItem onClick={handleExportConfluence} disabled={!hasNotes} style={!hasNotes ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>Export to Confluence</MenuItem>
          <MenuItem onClick={handleCopyMarkdown}>Copy to Clipboard</MenuItem>
        </DropdownMenu>
      )}
    </ExportContainer>
  );
}
