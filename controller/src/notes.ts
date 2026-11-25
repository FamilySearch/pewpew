import * as path from "node:path";
import {
  LoadPatternSummary,
  MonitoringConfig,
  NotesMetadata,
  NotesSearchResult,
  TestData,
  TestOverviewData
} from "../types";
import {
  LogLevel,
  PpaasS3File,
  log,
  s3
} from "@fs/ppaas-common";
import { LOCAL_FILE_LOCATION } from "./util";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { gunzip as zlibGunzip } from "node:zlib";

const gunzip = promisify(zlibGunzip);

const NOTES_FILENAME = "notes.md";
const NOTES_META_FILENAME = "notes-meta.json";

// Validation patterns for S3 path components
const YAML_FILE_PATTERN = /^[\w\-.]+$/;
const DATE_STRING_PATTERN = /^\d{8}T\d{9}$/;

export function validateNotesParams (yamlFile: string, dateString: string): string | undefined {
  if (!YAML_FILE_PATTERN.test(yamlFile)) {
    return "Invalid yamlFile format. Must contain only alphanumeric, hyphen, underscore, or dot characters.";
  }
  if (!DATE_STRING_PATTERN.test(dateString)) {
    return "Invalid dateString format. Expected format: YYYYMMDDTHHMMSSMMM";
  }
  return undefined;
}

// Section headers used in structured notes
const SECTION_HEADERS: Record<string, string> = {
  objectives: "## Objectives",
  environment: "## Environment",
  findings: "## Findings",
  conclusion: "## Conclusion"
};

export const NOTES_SECTIONS: string[] = Object.keys(SECTION_HEADERS);

/** Own keys only, so inherited names like "constructor" or "toString" aren't sections */
export function isNotesSection (section: string): boolean {
  return Object.hasOwn(SECTION_HEADERS, section);
}

export function getNotesFilename (): string {
  return NOTES_FILENAME;
}

export function getNotesMetaFilename (): string {
  return NOTES_META_FILENAME;
}

// Monitoring platform abstraction
export function getMonitoringConfig (): MonitoringConfig {
  const platform = process.env.MONITORING_PLATFORM || "generic";
  switch (platform) {
    case "splunk":
      return {
        platform: "splunk",
        dashboardBaseUrl: process.env.MONITORING_DASHBOARD_URL,
        searchBaseUrl: process.env.MONITORING_SEARCH_URL,
        label: "Splunk"
      };
    case "dynatrace":
      return {
        platform: "dynatrace",
        dashboardBaseUrl: process.env.MONITORING_DASHBOARD_URL,
        searchBaseUrl: process.env.MONITORING_SEARCH_URL,
        label: "Dynatrace"
      };
    default:
      return {
        platform: "generic",
        dashboardBaseUrl: process.env.MONITORING_DASHBOARD_URL,
        label: "Monitoring Dashboard"
      };
  }
}

export async function getPewPewNotes ({ yamlFile, dateString }: { yamlFile: string; dateString: string }): Promise<string | undefined> {
  const s3Folder = `${yamlFile}/${dateString}`;
  const key = `${s3Folder}/${NOTES_FILENAME}`;
  try {
    const files = await s3.listFiles(key);
    if (!files || files.length === 0 || !files.some((file) => file.Key?.endsWith(key))) {
      return undefined;
    }
    const s3Object = await s3.getObject(key);
    if (s3Object?.Body) {
      if (s3Object.ContentEncoding === "gzip") {
        const compressed = Buffer.from(await s3Object.Body.transformToByteArray());
        const decompressed = await gunzip(compressed);
        return decompressed.toString("utf-8");
      }
      return await s3Object.Body.transformToString("utf-8");
    }
    return undefined;
  } catch (error) {
    log(`getPewPewNotes failed for ${s3Folder}`, LogLevel.WARN, error);
    throw error;
  }
}

/**
 * A new, uniquely named directory under LOCAL_FILE_LOCATION. mkdtemp doesn't create parents (the old mkdir -p did),
 * and a short fixed prefix keeps long test names from exceeding the filename length limit.
 */
export async function makeTempDirectory (prefix: string): Promise<string> {
  await fs.mkdir(LOCAL_FILE_LOCATION, { recursive: true });
  return fs.mkdtemp(path.join(LOCAL_FILE_LOCATION, prefix));
}

/** Metadata for a save: the existing record with updatedAt/updatedBy bumped, or a new one that records createdBy. */
export function buildNotesMetadata ({ existing, userId, now }: { existing?: NotesMetadata; userId?: string; now: string }): NotesMetadata {
  const metadata: NotesMetadata = existing
    ? { ...existing, updatedAt: now }
    : { version: 1, createdAt: now, updatedAt: now, createdBy: userId };
  if (userId) { metadata.updatedBy = userId; }
  return metadata;
}

export async function savePewPewNotes ({ yamlFile, dateString, content, userId }: {
  yamlFile: string;
  dateString: string;
  content: string;
  userId?: string;
}): Promise<void> {
  const s3Folder = `${yamlFile}/${dateString}`;
  // mkdtemp adds a random suffix, so concurrent saves (even of the same test) never share a directory
  let localPath: string | undefined;
  try {
    localPath = await makeTempDirectory("notes-");
    const localFilePath = path.join(localPath, NOTES_FILENAME);
    await fs.writeFile(localFilePath, content, "utf-8");
    const s3File = new PpaasS3File({
      filename: NOTES_FILENAME,
      s3Folder,
      localDirectory: localPath
    });
    await s3File.upload();

    // undefined only when no metadata exists yet; a read error throws so we never overwrite createdAt/createdBy
    const existing = await getNotesMetadata({ yamlFile, dateString });
    const metadata = buildNotesMetadata({ existing, userId, now: new Date().toISOString() });
    await saveNotesMetadata({ yamlFile, dateString, metadata });
  } catch (error) {
    log(`savePewPewNotes failed for ${s3Folder}`, LogLevel.WARN, error);
    throw error;
  } finally {
    if (localPath) {
      await fs.rm(localPath, { recursive: true, force: true })
        .catch((cleanupError: unknown) => log("Cleanup of temp notes files failed", LogLevel.DEBUG, cleanupError));
    }
  }
}

export async function deletePewPewNotes ({ yamlFile, dateString }: { yamlFile: string; dateString: string }): Promise<void> {
  const s3Folder = `${yamlFile}/${dateString}`;
  try {
    const notesKey = `${s3Folder}/${NOTES_FILENAME}`;
    const metaKey = `${s3Folder}/${NOTES_META_FILENAME}`;
    await Promise.all([
      // A notes.md that couldn't be deleted must fail the request; stray metadata is harmless, so that stays best-effort
      s3.deleteObject(notesKey),
      s3.deleteObject(metaKey).catch((err) => log(`Could not delete ${metaKey}`, LogLevel.WARN, err))
    ]);
  } catch (error) {
    log(`deletePewPewNotes failed for ${s3Folder}`, LogLevel.WARN, error);
    throw error;
  }
}

export async function getNotesMetadata ({ yamlFile, dateString }: { yamlFile: string; dateString: string }): Promise<NotesMetadata | undefined> {
  const s3Folder = `${yamlFile}/${dateString}`;
  const key = `${s3Folder}/${NOTES_META_FILENAME}`;
  try {
    const files = await s3.listFiles(key);
    if (!files || files.length === 0 || !files.some((file) => file.Key?.endsWith(key))) {
      return undefined;
    }
    const s3Object = await s3.getObject(key);
    if (s3Object?.Body) {
      let jsonString: string;
      if (s3Object.ContentEncoding === "gzip") {
        const compressed = Buffer.from(await s3Object.Body.transformToByteArray());
        const decompressed = await gunzip(compressed);
        jsonString = decompressed.toString("utf-8");
      } else {
        jsonString = await s3Object.Body.transformToString("utf-8");
      }
      try {
        return JSON.parse(jsonString) as NotesMetadata;
      } catch (parseError) {
        // A corrupt file has nothing to preserve, and throwing would block every later save
        log(`getNotesMetadata could not parse ${key}`, LogLevel.WARN, parseError);
        return undefined;
      }
    }
    return undefined;
  } catch (error) {
    log(`getNotesMetadata failed for ${s3Folder}`, LogLevel.WARN, error);
    throw error;
  }
}

export async function saveNotesMetadata ({ yamlFile, dateString, metadata }: {
  yamlFile: string;
  dateString: string;
  metadata: NotesMetadata;
}): Promise<void> {
  const s3Folder = `${yamlFile}/${dateString}`;
  let localPath: string | undefined;
  try {
    localPath = await makeTempDirectory("notes-meta-");
    const localFilePath = path.join(localPath, NOTES_META_FILENAME);
    await fs.writeFile(localFilePath, JSON.stringify(metadata, null, 2), "utf-8");
    const s3File = new PpaasS3File({
      filename: NOTES_META_FILENAME,
      s3Folder,
      localDirectory: localPath
    });
    await s3File.upload();
  } catch (error) {
    log(`saveNotesMetadata failed for ${s3Folder}`, LogLevel.WARN, error);
    throw error;
  } finally {
    if (localPath) {
      await fs.rm(localPath, { recursive: true, force: true })
        .catch((cleanupError: unknown) => log("Cleanup of temp notes files failed", LogLevel.DEBUG, cleanupError));
    }
  }
}

// Helper: Extract endpoints from parsed YAML config
function extractEndpoints (parsed: Record<string, unknown>): string[] {
  const endpoints: string[] = [];
  const endpointsObj = parsed.endpoints;
  if (!endpointsObj || typeof endpointsObj !== "object") {
    return endpoints;
  }
  if (Array.isArray(endpointsObj)) {
    // Array format: [{method: "GET", url: "...", peak_load: "..."}, ...]
    for (const entry of endpointsObj) {
      if (entry && typeof entry === "object") {
        const config = entry as Record<string, unknown>;
        if (typeof config.url === "string") {
          const method = typeof config.method === "string" ? config.method : "GET";
          const peakLoad = typeof config.peak_load === "string" ? ` (${config.peak_load})` : "";
          endpoints.push(`${method} ${config.url}${peakLoad}`);
        }
      }
    }
  } else {
    // Object format: {endpointName: {url: "..."}, ...}
    for (const [name, config] of Object.entries(endpointsObj as Record<string, unknown>)) {
      const endpointConfig = config as Record<string, unknown> | undefined;
      if (endpointConfig && typeof endpointConfig === "object" && typeof endpointConfig.url === "string") {
        endpoints.push(`${name}: ${endpointConfig.url}`);
      } else {
        endpoints.push(name);
      }
    }
  }
  return endpoints;
}

// Helper: Extract load patterns from parsed YAML config
function extractLoadPatterns (parsed: Record<string, unknown>): LoadPatternSummary[] {
  const loadPatterns: LoadPatternSummary[] = [];
  if (parsed.load_pattern && Array.isArray(parsed.load_pattern)) {
    for (const pattern of parsed.load_pattern as Record<string, unknown>[]) {
      if (pattern && typeof pattern === "object") {
        const type = Object.keys(pattern)[0] || "unknown";
        const config = (pattern[type] || {}) as Record<string, unknown>;
        loadPatterns.push({
          type,
          from: config.from as string | undefined,
          to: config.to as string | undefined,
          duration: (config.duration || config.over) as string | undefined
        });
      }
    }
  }
  return loadPatterns;
}

// Helper: Extract providers from parsed YAML config
function extractProviders (parsed: Record<string, unknown>): string[] {
  if (parsed.providers && typeof parsed.providers === "object" && !Array.isArray(parsed.providers)) {
    return Object.keys(parsed.providers as Record<string, unknown>);
  }
  return [];
}

// Custom YAML schema to handle PewPew tags. Scripting configs tag load patterns (!linear),
// providers (!file, !response, !list, !range), logger targets (!stdout, !stderr, !file),
// bodies (!str, !file, !multipart) and declares (!x, !c), so accept any "!tag" on a
// scalar, sequence or mapping and turn it into { tag: value } instead of failing the parse.
const PEWPEW_YAML_TYPES = (["scalar", "sequence", "mapping"] as const).map(
  (kind) => new yaml.Type("!", {
    kind,
    multi: true,
    construct: (data: unknown, tag?: string) => ({ [(tag || "!").slice(1)]: data ?? {} })
  })
);
const PEWPEW_SCHEMA = yaml.DEFAULT_SCHEMA.extend(PEWPEW_YAML_TYPES);

// Parse YAML test config to extract load test details
export function parseYamlTestConfig (yamlContent: string): { endpoints: string[]; loadPatterns: LoadPatternSummary[]; providers: string[] } {
  try {
    const parsed = yaml.load(yamlContent, { schema: PEWPEW_SCHEMA }) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return { endpoints: [], loadPatterns: [], providers: [] };
    }

    return {
      endpoints: extractEndpoints(parsed),
      loadPatterns: extractLoadPatterns(parsed),
      providers: extractProviders(parsed)
    };
  } catch (error) {
    log("Error parsing YAML for notes template", LogLevel.WARN, error);
    return { endpoints: [], loadPatterns: [], providers: [] };
  }
}

function formatLoadPatterns (loadPatterns: LoadPatternSummary[]): string {
  if (loadPatterns.length === 0) { return "- No load patterns defined"; }
  return loadPatterns.map((p) => {
    const parts = [`- **${p.type}**`];
    if (p.from) { parts.push(`from ${p.from}`); }
    if (p.to) { parts.push(`to ${p.to}`); }
    if (p.duration) { parts.push(`over ${p.duration}`); }
    return parts.join(" ");
  }).join("\n");
}

export function generateNotesMarkdown ({
  yamlFile,
  dateString,
  testData,
  yamlContent,
  yamlContents
}: {
  yamlFile: string;
  dateString: string;
  testData?: TestData;
  yamlContent?: string;
  yamlContents?: string[];
}): { markdown: string; testOverview: TestOverviewData } {
  const monitoring = getMonitoringConfig();
  let endpoints: string[] = [];
  let loadPatterns: LoadPatternSummary[] = [];
  let providers: string[] = [];

  // Support both single yamlContent and multiple yamlContents
  const contentsToParse = yamlContents || (yamlContent ? [yamlContent] : []);
  for (const content of contentsToParse) {
    const parsed = parseYamlTestConfig(content);
    endpoints = endpoints.concat(parsed.endpoints);
    loadPatterns = loadPatterns.concat(parsed.loadPatterns);
    providers = providers.concat(parsed.providers);
  }

  const testOverview: TestOverviewData = {
    testName: yamlFile,
    endpoints,
    loadPatterns,
    providers: providers.length > 0 ? providers : undefined,
    testStatus: testData?.status === undefined ? undefined : String(testData.status),
    startTime: testData?.startTime,
    endTime: testData?.endTime,
    pewpewVersion: testData?.version
  };

  // Calculate duration if both times available
  if (testData?.startTime && testData?.endTime) {
    const durationMs = testData.endTime - testData.startTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    testOverview.duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  const startTimeStr = testData?.startTime ? new Date(testData.startTime).toISOString() : dateString;
  const endpointsList = endpoints.length > 0 ? endpoints.map((e) => `- ${e}`).join("\n") : "- No endpoints extracted";
  const providersList = providers.map((p) => "- " + p).join("\n");
  const providersSection = providers.length > 0 ? "### Providers\n" + providersList + "\n" : "";
  const markdown = `# Performance Test Notes: ${yamlFile}

## Test Overview

| Field | Value |
|-------|-------|
| Test Name | ${yamlFile} |
| Date | ${startTimeStr} |
| Status | ${testData?.status === undefined ? "Unknown" : String(testData.status)} |
| Duration | ${testOverview.duration || "N/A"} |
| PewPew Version | ${testData?.version || "N/A"} |

### Endpoints
${endpointsList}

### Load Patterns
${formatLoadPatterns(loadPatterns)}

${providersSection}
## Objectives
<!-- Document the goals and objectives for this test run -->

## Environment
- **Target System**:
- **${monitoring.label}**: ${monitoring.dashboardBaseUrl ? `[Dashboard](${monitoring.dashboardBaseUrl})` : "Configure MONITORING_DASHBOARD_URL"}

## Findings
<!-- Document observations and results -->

## Conclusion
- **Result**: Pass / Fail / Inconclusive
- **Recommendations**:
`;

  return { markdown, testOverview };
}

export async function updateNotesSection ({ yamlFile, dateString, section, content, append = true }: {
  yamlFile: string;
  dateString: string;
  section: string;
  content: string;
  append?: boolean;
}): Promise<string> {
  if (!isNotesSection(section)) {
    throw new Error(`Unknown section: ${section}. Valid sections: ${NOTES_SECTIONS.join(", ")}`);
  }
  const sectionHeader = SECTION_HEADERS[section];

  const existing = await getPewPewNotes({ yamlFile, dateString });
  if (!existing) {
    throw new Error("No existing notes found. Create notes first before updating sections.");
  }

  // Find the section and the next section
  // The header must fill its own line, so "### Findings" or "## Findings Summary" don't match
  const sectionIndex = new RegExp(`^${sectionHeader}[ \\t\\r]*$`, "m").exec(existing)?.index ?? -1;
  if (sectionIndex === -1) {
    // Section not found, append it
    return existing + `\n${sectionHeader}\n${content}\n`;
  }

  // Find the end of the section (next ## heading or end of file)
  const afterSection = existing.substring(sectionIndex + sectionHeader.length);
  const nextSectionIdx = afterSection.indexOf("\n## ");
  const sectionEnd = nextSectionIdx >= 0
    ? sectionIndex + sectionHeader.length + nextSectionIdx
    : existing.length;

  const beforeSection = existing.substring(0, sectionIndex);
  const afterSectionContent = existing.substring(sectionEnd);
  const existingSectionContent = existing.substring(sectionIndex + sectionHeader.length, sectionEnd);

  if (append) {
    const timestamp = new Date().toISOString();
    return `${beforeSection}${sectionHeader}${existingSectionContent}\n*Updated: ${timestamp}*\n${content}\n${afterSectionContent}`;
  } else {
    return `${beforeSection}${sectionHeader}\n${content}\n${afterSectionContent}`;
  }
}

const MAX_NOTES_SEARCH_LENGTH = 1024;
const MAX_NOTES_SEARCH_RESULTS = 100;

export async function searchNotes ({ query = "", limit = 20 }: { query?: string; limit?: number }): Promise<NotesSearchResult[]> {
  if (query.length > MAX_NOTES_SEARCH_LENGTH) {
    throw new Error(`Search query must not exceed ${MAX_NOTES_SEARCH_LENGTH} characters.`);
  }
  // Sanitize: only allow alphanumeric, hyphen, underscore, dot, slash (empty string is valid)
  if (query.length > 0 && !/^[\w\-./]+$/.test(query)) {
    throw new Error("Search query contains invalid characters. Use only letters, numbers, hyphens, underscores, dots, and slashes.");
  }

  const cappedLimit = Math.min(Math.max(limit, 1), MAX_NOTES_SEARCH_RESULTS);
  const results: NotesSearchResult[] = [];
  try {
    // Use query as an S3 prefix filter to narrow results
    const files = await s3.listFiles({ s3Folder: query, extension: NOTES_FILENAME, maxKeys: 1000 });
    if (!files || files.length === 0) {
      return results;
    }

    for (const file of files) {
      if (results.length >= cappedLimit) { break; }
      if (!file.Key?.endsWith(NOTES_FILENAME)) { continue; }

      // Extract yamlFile and dateString from key: {prefix}{yamlFile}/{dateString}/notes.md
      const keyWithoutPrefix = file.Key.replace(s3.KEYSPACE_PREFIX, "");
      const keyParts = keyWithoutPrefix.split("/");
      if (keyParts.length < 3) { continue; }

      // Remove the filename (notes.md) from the end
      keyParts.pop();
      const dateString = keyParts.pop()!;
      const yamlFile = keyParts.join("/");
      const s3Folder = `${yamlFile}/${dateString}`;

      // Return only the file listing — metadata is loaded on-demand when viewing
      results.push({ yamlFile, dateString, s3Folder });
    }
  } catch (error) {
    log("searchNotes failed", LogLevel.WARN, error);
    throw error;
  }

  return results;
}

const escapeHtml = (text: string): string => text
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

// Only http(s), mailto, and relative URLs are emitted as links/images; anything else (javascript:, data:, ...) is dropped.
const isSafeUrl = (url: string): boolean => /^(?:https?:|mailto:|[/#?]|[^:]*$)/i.test(url.trim());

// Convert markdown to Confluence Storage Format.
// The output is served as HTML, so all user text is HTML-escaped and only safe URL schemes are linked.
export function markdownToConfluence (markdown: string): string {
  // The placeholder characters can't come from the notes themselves, or a pasted placeholder could pull in another snippet
  let html = markdown.replaceAll(/[\uE000\uE001]/g, "");

  // Code blocks become CDATA macros (raw, unescaped), so pull them out before escaping the rest
  const codeBlocks: string[] = [];
  html = html.replaceAll(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code: string) => {
    const langParam = lang ? `<ac:parameter ac:name="language">${lang}</ac:parameter>` : "";
    const cdata = code.trimEnd().replaceAll("]]>", "]]]]><![CDATA[>");
    codeBlocks.push(`<ac:structured-macro ac:name="code">${langParam}<ac:plain-text-body><![CDATA[${cdata}]]></ac:plain-text-body></ac:structured-macro>`);
    return `\uE000CODE${codeBlocks.length - 1}\uE000`;
  });

  html = escapeHtml(html);

  // Inline code (already escaped) is held out like code blocks so the comment strip and formatting passes below
  // don't touch it. Single line only, so one stray backtick can't swallow the paragraphs after it.
  const inlineCode: string[] = [];
  html = html.replaceAll(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCode.push(`<code>${code}</code>`);
    return `\uE001CODE${inlineCode.length - 1}\uE001`;
  });

  // HTML comments (strip for Confluence). Matched in escaped form, after code is out, so comments inside code
  // survive and raw HTML never goes through a sanitizing regex.
  html = html.replaceAll(/&lt;!--[\s\S]*?--&gt;/g, "");

  // Headings
  html = html.replaceAll(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replaceAll(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replaceAll(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replaceAll(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replaceAll(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replaceAll(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replaceAll(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replaceAll(/\*(.+?)\*/g, "<em>$1</em>");

  // Strikethrough
  html = html.replaceAll(/~~(.+?)~~/g, "<del>$1</del>");

  // Images (before links, or the link pattern would consume them)
  html = html.replaceAll(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, url: string) =>
    isSafeUrl(url) ? `<ac:image><ri:url ri:value="${url}" /></ac:image>` : alt);

  // Links
  html = html.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) =>
    isSafeUrl(url) ? `<a href="${url}">${text}</a>` : text);

  // Tables
  html = html.replaceAll(/^(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)*)/gm, (_match, headerRow, _separator, bodyRows) => {
    // Drop only the outer pipes' empty entries so blank interior cells keep their column
    const splitRow = (row: string): string[] => row.trim().split("|").slice(1, -1);
    const headers = splitRow(headerRow as string).map((c: string) => `<th><p>${c.trim()}</p></th>`).join("");
    const rows = (bodyRows as string).trim().split("\n").map((row: string) => {
      const cells = splitRow(row).map((c: string) => `<td><p>${c.trim()}</p></td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Horizontal rules
  html = html.replaceAll(/^---+$/gm, "<hr />");

  // Ordered lists (simple single-level). A temporary tag keeps the <ul> pass below from grabbing these items.
  // [ \t] rather than \s so a match can't reach across a blank line. The wrappers leave the newline after the last
  // item outside, so the next line still starts at ^ for the passes below.
  html = html.replaceAll(/^[ \t]*\d+\.[ \t]+(.+)$/gm, "<oli>$1</oli>");
  html = html.replaceAll(/((?:<oli>.*<\/oli>\n)*<oli>.*<\/oli>)/g, "<ol>$1</ol>");

  // Unordered lists (simple single-level)
  html = html.replaceAll(/^[ \t]*-[ \t]+(.+)$/gm, "<li>$1</li>");
  html = html.replaceAll(/((?:<li>.*<\/li>\n)*<li>.*<\/li>)/g, "<ul>$1</ul>");
  html = html.replaceAll("<oli>", "<li>").replaceAll("</oli>", "</li>");

  // Blockquotes
  html = html.replaceAll(/^&gt;\s+(.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Paragraphs - wrap lines that aren't already in tags
  html = html.replaceAll(/^(?!<[a-z/]|$)(.+)$/gm, "<p>$1</p>");

  // Clean up empty paragraphs
  html = html.replaceAll(/<p>\s*<\/p>/g, "");

  // Restore inline code
  html = html.replaceAll(/\uE001CODE(\d+)\uE001/g, (match, index: string) => inlineCode[Number(index)] ?? match);

  // Restore code blocks (the paragraph pass may have wrapped their placeholders)
  html = html.replaceAll(/(?:<p>)?\uE000CODE(\d+)\uE000(?:<\/p>)?/g, (match, index: string) => codeBlocks[Number(index)] ?? match);

  return html.trim();
}
