import type { Editor, Extensions } from "@tiptap/react";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";

// StarterKit (v3) already includes Link and Underline. Code blocks are plain (no syntax
// highlighting) to avoid pulling in lowlight/highlight.js (~60 KB gzip).
const getExtensions = (): Extensions => [
  StarterKit.configure({
    link: {
      openOnClick: false
    }
  }),
  Placeholder.configure({
    placeholder: "Start writing your performance test notes..."
  }),
  TaskList,
  TaskItem.configure({
    nested: true
  }),
  TableKit.configure({
    table: {
      resizable: true
    }
  }),
  Image.configure({
    inline: true
  }),
  Markdown
];

// @tiptap/markdown parses bare URLs as links (GFM autolinks) but always serializes links
// as [text](href), so a bare URL would come back as [https://x](https://x) on save.
// Write autolinks back out as bare URLs to keep saved notes readable.
// StarterKit's trailing node also keeps an empty paragraph after a final heading/table/code
// block (so you can click below it); trim the blank lines it serializes to.
// One pass, code first so it wins: group 1 is a fenced block or an inline code span (kept verbatim),
// where an inline span closes on a backtick run the same length as the one that opened it (TipTap
// uses `` `` `` when the code contains a backtick). Otherwise groups 3 and 4 are a link's text and
// href; when the text is its URL the link is rewritten to the bare URL. getMarkdown() escapes markdown
// punctuation (`_`, `*`, `~`) and `&` in link text but not in the href, so the text is compared after
// undoing that. Only a link that stands alone is rewritten: glued to a word it would no longer parse
// as an autolink, and after `!` it is image syntax.
const CODE_OR_AUTOLINK = /(```[\s\S]*?```|(?<!`)(`+)(?!`)[^\n]*?(?<!`)\2(?!`))|(?<![\w/!])\[(https?:\/\/[^\s\]]+)\]\((https?:\/\/[^\s)]+)\)(?!\w)/g;

const unescapeLinkText = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, "$1").replaceAll("&amp;", "&");

export function getNotesMarkdown (editor: Editor): string {
  return editor.getMarkdown()
    .replace(CODE_OR_AUTOLINK, (match: string, code?: string, _ticks?: string, text?: string, href?: string) =>
      code ?? (text !== undefined && unescapeLinkText(text) === href ? href : match))
    .trimEnd();
}

export default getExtensions;
