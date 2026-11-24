import { NotesProvider, useNotesContext } from "./NotesContext";
import getExtensions, { getNotesMarkdown } from "./tiptapExtensions";
import { render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import React from "react";
import TipTapEditorInner from "./TipTapEditorInner";

// Shape of the generated template (src/notes.ts generateNotesMarkdown) plus the formatting the toolbar can produce.
const SAMPLE_NOTES = `# Performance Test Notes: test.yaml

## Test Overview

| Field | Value |
|-------|-------|
| Test Name | test.yaml |
| Status | Finished |

### Endpoints
- https://example.com/api
- https://example.com/other

## Environment
- **Target System**:
- **Dynatrace**: [Dashboard](https://dt.example.com)

## Findings
Some **bold**, *italic*, <u>under</u>, ~~strike~~ and \`code\`.

- [ ] todo item
- [x] done item
  - [ ] nested

1. first
2. second

> a quote

\`\`\`yaml
config:
  key: "value" -- flag
\`\`\`

---

![chart](https://example.com/c.png)

## Conclusion
- **Result**: Pass / Fail / Inconclusive
`;

function createEditor (content: string): Editor {
  return new Editor({ extensions: getExtensions(), content, contentType: "markdown" });
}

describe("tiptapExtensions markdown round-trip", () => {
  let editor: Editor;
  let markdown: string;

  beforeAll(() => {
    editor = createEditor(SAMPLE_NOTES);
    markdown = getNotesMarkdown(editor);
  });

  afterAll(() => editor.destroy());

  it("is stable across repeated saves", () => {
    const reloaded = createEditor(markdown);
    expect(getNotesMarkdown(reloaded)).toBe(markdown);
    reloaded.destroy();
  });

  it("keeps ## section headings that updateNotesSection splits on", () => {
    for (const heading of ["## Test Overview", "## Environment", "## Findings", "## Conclusion"]) {
      expect(markdown).toContain(`\n${heading}\n`);
    }
  });

  it("keeps tables as pipe tables with a separator row", () => {
    expect(markdown).toMatch(/^\| Field +\| Value +\|\n\| -+ \| -+ \|\n\| Test Name \| test\.yaml \|/m);
  });

  it("writes bare URLs back out as bare URLs", () => {
    expect(markdown).toContain("- https://example.com/api\n");
    expect(markdown).not.toContain("[https://example.com/api](https://example.com/api)");
  });

  it("writes bare URLs with markdown punctuation back out as bare URLs", () => {
    const urls = "- https://example.com/foo_bar\n- https://example.com/a~b\n- https://example.com/a*b?x=1&y=2#frag";
    const first = createEditor(urls);
    const saved = getNotesMarkdown(first);
    expect(saved).toBe(urls);
    const reloaded = createEditor(saved);
    expect(getNotesMarkdown(reloaded)).toBe(saved);
    first.destroy();
    reloaded.destroy();
  });

  it("leaves URL links inside code untouched", () => {
    const code = createEditor("Inline `[https://a.example](https://a.example)` code\n\n```\n[https://b.example](https://b.example)\n```");
    const saved = getNotesMarkdown(code);
    expect(saved).toContain("`[https://a.example](https://a.example)`");
    expect(saved).toContain("```\n[https://b.example](https://b.example)\n```");
    code.destroy();
  });

  it("leaves link syntax inside a double-backtick code span untouched", () => {
    const source = createEditor("Inline ``a ` [https://a.example](https://a.example)`` code");
    const before = source.state.doc.textContent;
    const saved = getNotesMarkdown(source);
    expect(saved).toContain("[https://a.example](https://a.example)");
    const reloaded = createEditor(saved);
    expect(reloaded.state.doc.textContent).toBe(before);
    source.destroy();
    reloaded.destroy();
  });

  it("keeps an image whose alt text is its URL as an image", () => {
    const image = createEditor("![https://a.example/c.png](https://a.example/c.png)");
    expect(getNotesMarkdown(image)).toBe("![https://a.example/c.png](https://a.example/c.png)");
    image.destroy();
  });

  it("keeps a URL link glued to surrounding text as a link", () => {
    const glued = createEditor("foo[https://x.example](https://x.example)bar");
    expect(getNotesMarkdown(glued)).toBe("foo[https://x.example](https://x.example)bar");
    glued.destroy();
  });

  it("keeps links whose text differs from the URL", () => {
    expect(markdown).toContain("[Dashboard](https://dt.example.com)");
  });

  it("keeps inline formatting", () => {
    expect(markdown).toContain("Some **bold**, *italic*, <u>under</u>, ~~strike~~ and `code`.");
  });

  it("keeps task lists, including nested and checked items", () => {
    expect(markdown).toContain("- [ ] todo item\n- [x] done item\n  - [ ] nested");
  });

  it("keeps ordered lists, blockquotes, rules and images", () => {
    expect(markdown).toContain("1. first\n2. second");
    expect(markdown).toContain("> a quote");
    expect(markdown).toContain("\n---\n");
    expect(markdown).toContain("![chart](https://example.com/c.png)");
  });

  it("keeps fenced code blocks verbatim, without typography substitution", () => {
    expect(markdown).toContain("```yaml\nconfig:\n  key: \"value\" -- flag\n```");
  });
});

function DirtyProbe () {
  const { isDirty, wordCount } = useNotesContext();
  return (
    <>
      <span data-testid="is-dirty">{String(isDirty)}</span>
      <span data-testid="word-count">{wordCount}</span>
    </>
  );
}

function renderEditor (initialContent: string, editorContentRef: React.RefObject<(() => string) | null>) {
  return render(
    <NotesProvider>
      <TipTapEditorInner initialContent={initialContent} editable={true} editorContentRef={editorContentRef} />
      <DirtyProbe />
    </NotesProvider>
  );
}

describe("TipTapEditorInner", () => {
  it("renders the markdown content in the editor", async () => {
    const ref = React.createRef<(() => string) | null>() as React.RefObject<(() => string) | null>;
    renderEditor("## Findings\n\nLatency was **fine**.", ref);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument());
    expect(screen.getByText("fine").tagName).toBe("STRONG");
  });

  it("exposes the content as markdown through editorContentRef", async () => {
    const ref = React.createRef<(() => string) | null>() as React.RefObject<(() => string) | null>;
    renderEditor("## Findings\n\n- https://example.com", ref);
    await waitFor(() => expect(ref.current).toBeTypeOf("function"));
    expect(ref.current!()).toBe("## Findings\n\n- https://example.com");
  });

  it("does not mark notes dirty when content is loaded or replaced", async () => {
    const ref = React.createRef<(() => string) | null>() as React.RefObject<(() => string) | null>;
    const { rerender } = renderEditor("| a | b |\n|---|---|\n| 1 | 2 |", ref);
    await waitFor(() => expect(screen.getByTestId("word-count").textContent).not.toBe("0"));
    expect(screen.getByTestId("is-dirty").textContent).toBe("false");

    rerender(
      <NotesProvider>
        <TipTapEditorInner initialContent={"## Replaced template"} editable={true} editorContentRef={ref} />
        <DirtyProbe />
      </NotesProvider>
    );
    await waitFor(() => expect(ref.current!()).toBe("## Replaced template"));
    expect(screen.getByTestId("is-dirty").textContent).toBe("false");
  });
});
