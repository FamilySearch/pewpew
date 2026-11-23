import styled, { css } from "styled-components";
import { colors } from "./editorStyles";

export const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 12px;
  background: ${colors.bg};
  border-bottom: 1px solid ${colors.borders};
  position: sticky;
  top: 0;
  z-index: 10;
`;

export const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;

  &:not(:last-child) {
    padding-right: 8px;
    margin-right: 8px;
    border-right: 1px solid ${colors.borders};
  }
`;

const activeButtonStyles = css`
  background: ${colors.accentDim};
  color: ${colors.accent};

  &:hover {
    background: ${colors.accentDim};
    color: ${colors.accent};
  }
`;

// Toggle buttons (those passed $isActive) expose their state to assistive tech via aria-pressed.
export const ToolbarBtn = styled.button.attrs<{ $isActive?: boolean }>(({ $isActive }) => ({
  "aria-pressed": $isActive
}))<{ $isActive?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: ${colors.muted};
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  font-family: "Noto Sans", sans-serif;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: ${colors.inputBg};
    color: ${colors.text};
  }

  &:active {
    background: ${colors.borders};
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  ${({ $isActive }) => $isActive && activeButtonStyles}
`;

// Dialog styles for link/image insertion
export const DialogOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`;

export const DialogBox = styled.div`
  background: ${colors.surface};
  border: 1px solid ${colors.borders};
  border-radius: 8px;
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
`;

export const DialogTitle = styled.h3`
  margin: 0 0 16px 0;
  color: ${colors.bright};
  font-size: 16px;
  font-weight: 600;
`;

export const DialogLabel = styled.label`
  display: block;
  font-family: "Noto Sans", sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: ${colors.muted};
  margin-bottom: 6px;
`;

export const DialogInput = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid ${colors.borders};
  border-radius: 6px;
  font-family: "Noto Sans", sans-serif;
  font-size: 14px;
  background: ${colors.inputBg};
  color: ${colors.text};
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${colors.accent};
    box-shadow: 0 0 0 2px ${colors.accentDim};
  }
`;

export const DialogButtons = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
`;

export const DialogButton = styled.button<{ $variant?: "primary" | "danger" }>`
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
`;
