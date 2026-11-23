import styled from "styled-components";

// Dark mode color palette matching ppaas-controller theme
const colors = {
  bg: "rgb(24, 26, 27)",
  surface: "rgb(30, 30, 30)",
  inputBg: "rgb(40, 40, 40)",
  borders: "rgb(67, 67, 67)",
  muted: "rgb(140, 140, 140)",
  text: "rgb(200, 200, 200)",
  bright: "rgb(232, 230, 227)",
  accent: "#4caf50",
  accentDim: "rgba(76, 175, 80, 0.15)",
  link: "lightblue",
  danger: "rgb(230, 155, 162)"
};

export { colors };

export const EditorWrapper = styled.div`
  flex: 1;
  overflow-y: auto;
  background: ${colors.surface};
  border: 1px solid ${colors.borders};
  border-radius: 8px;
  text-align: left;

  .ProseMirror {
    font-family: "Noto Sans", sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: ${colors.text};
    padding: 24px;
    min-height: 400px;
    outline: none;

    > * + * {
      margin-top: 0.75em;
    }

    h1 {
      font-size: 2em;
      font-weight: 700;
      color: ${colors.bright};
      margin-top: 1em;
      margin-bottom: 0.5em;
    }

    h2 {
      font-size: 1.5em;
      font-weight: 600;
      color: ${colors.bright};
      margin-top: 1em;
      margin-bottom: 0.5em;
    }

    h3 {
      font-size: 1.17em;
      font-weight: 600;
      color: ${colors.bright};
      margin-top: 1em;
      margin-bottom: 0.5em;
    }

    p {
      margin: 0.5em 0;
    }

    strong {
      font-weight: 700;
    }

    em {
      font-style: italic;
    }

    u {
      text-decoration: underline;
    }

    s {
      text-decoration: line-through;
    }

    code {
      background: ${colors.inputBg};
      color: ${colors.text};
      font-family: "Roboto Mono", monospace;
      font-size: 0.9em;
      padding: 2px 6px;
      border-radius: 4px;
    }

    pre {
      background: ${colors.bg};
      border: 1px solid ${colors.borders};
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;

      code {
        background: none;
        padding: 0;
        font-size: 0.85em;
        color: inherit;
      }
    }

    blockquote {
      border-left: 4px solid ${colors.accent};
      padding-left: 16px;
      margin-left: 0;
      color: ${colors.muted};
      font-style: italic;
    }

    ul,
    ol {
      padding-left: 24px;
    }

    ul {
      list-style: disc;
    }

    ol {
      list-style: decimal;
    }

    li {
      margin: 4px 0;

      p {
        margin: 0;
      }
    }

    ul[data-type="taskList"] {
      list-style: none;
      padding-left: 0;

      li {
        display: flex;
        align-items: flex-start;
        gap: 8px;

        > label {
          flex-shrink: 0;
          margin-top: 3px;

          input[type="checkbox"] {
            accent-color: ${colors.accent};
            width: 16px;
            height: 16px;
            cursor: pointer;
          }
        }

        > div {
          flex: 1;
        }
      }
    }

    hr {
      border: none;
      border-top: 2px solid ${colors.borders};
      margin: 1.5em 0;
    }

    a {
      color: ${colors.link};
      text-decoration: underline;
      cursor: pointer;
    }

    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      overflow: hidden;

      td,
      th {
        border: 1px solid ${colors.borders};
        padding: 8px 12px;
        text-align: left;
        vertical-align: top;
        min-width: 80px;
      }

      th {
        background: ${colors.bg};
        font-weight: 600;
      }

      .selectedCell {
        background: ${colors.accentDim};
      }
    }

    p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left;
      color: ${colors.muted};
      pointer-events: none;
      height: 0;
    }
  }
`;

export const PreviewWrapper = styled.div`
  flex: 1;
  overflow-y: auto;
  background: ${colors.surface};
  border: 1px solid ${colors.borders};
  border-radius: 8px;
`;

export const PreviewContent = styled.div`
  padding: 24px;
  font-family: "Noto Sans", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: ${colors.text};
`;
