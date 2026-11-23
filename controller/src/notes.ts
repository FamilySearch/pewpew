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

export async function savePewPewNotes ({ yamlFile, dateString, content, userId }: {
  yamlFile: string;
  dateString: string;
  content: string;
  userId?: string;
}): Promise<void> {
  const s3Folder = `${yamlFile}/${dateString}`;
  const localPath = path.join(LOCAL_FILE_LOCATION, `notes-${Date.now()}`);
  try {
    await fs.mkdir(localPath, { recursive: true });
    const localFilePath = path.join(localPath, NOTES_FILENAME);
    await fs.writeFile(localFilePath, content, "utf-8");
    const s3File = new PpaasS3File({
      filename: NOTES_FILENAME,
      s3Folder,
      localDirectory: localPath
    });
    await s3File.upload();

    // Update metadata
    const now = new Date().toISOString();
    let metadata: NotesMetadata;
    try {
      const existing = await getNotesMetadata({ yamlFile, dateString });
      metadata = existing || { version: 1, createdAt: now, updatedAt: now };
      metadata.updatedAt = now;
      if (userId) { metadata.updatedBy = userId; }
    } catch (metadataError) {
      log(`Could not load existing metadata for ${s3Folder}, creating new`, LogLevel.DEBUG, metadataError);
      metadata = {
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId
      };
    }
    await saveNotesMetadata({ yamlFile, dateString, metadata });
  } catch (error) {
    log(`savePewPewNotes failed for ${s3Folder}`, LogLevel.WARN, error);
    throw error;
  } finally {
    try {
      const files = await fs.readdir(localPath);
      for (const file of files) { await fs.unlink(path.join(localPath, file)); }
      await fs.rmdir(localPath);
    } catch (cleanupError) { log("Cleanup of temp notes files failed", LogLevel.DEBUG, cleanupError); }
  }
}

export async function deletePewPewNotes ({ yamlFile, dateString }: { yamlFile: string; dateString: string }): Promise<void> {
  const s3Folder = `${yamlFile}/${dateString}`;
  try {
    const notesKey = `${s3Folder}/${NOTES_FILENAME}`;
    const metaKey = `${s3Folder}/${NOTES_META_FILENAME}`;
    await Promise.all([
      s3.deleteObject(notesKey).catch((err) => log(`Could not delete ${notesKey}`, LogLevel.WARN, err)),
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
      return JSON.parse(jsonString) as NotesMetadata;
    }
    return undefined;
  } catch (error) {
    log(`getNotesMetadata failed for ${s3Folder}`, LogLevel.WARN, error);
    return undefined;
  }
}

export async function saveNotesMetadata ({ yamlFile, dateString, metadata }: {
  yamlFile: string;
  dateString: string;
  metadata: NotesMetadata;
}): Promise<void> {
  const s3Folder = `${yamlFile}/${dateString}`;
  const localPath = path.join(LOCAL_FILE_LOCATION, `notes-meta-${Date.now()}`);
  try {
    await fs.mkdir(localPath, { recursive: true });
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
    try {
      const files = await fs.readdir(localPath);
      for (const file of files) { await fs.unlink(path.join(localPath, file)); }
      await fs.rmdir(localPath);
    } catch (cleanupError) { log("Cleanup of temp notes files failed", LogLevel.DEBUG, cleanupError); }
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

// Custom YAML schema to handle PewPew tags like !linear
const PEWPEW_YAML_TYPES = ["linear", "step", "fixed"].map(
  (tag) => new yaml.Type(`!${tag}`, {
    kind: "mapping",
    construct: (data: Record<string, unknown>) => ({ [tag]: data })
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
  const sectionHeader = SECTION_HEADERS[section];
  if (!sectionHeader) {
    throw new Error(`Unknown section: ${section}. Valid sections: ${Object.keys(SECTION_HEADERS).join(", ")}`);
  }

  const existing = await getPewPewNotes({ yamlFile, dateString });
  if (!existing) {
    throw new Error("No existing notes found. Create notes first before updating sections.");
  }

  // Find the section and the next section
  const sectionIndex = existing.indexOf(sectionHeader);
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
  // HTML comments (strip for Confluence) before escaping so they don't survive as visible text
  let html = markdown.replaceAll(/<!--[\s\S]*?-->/g, "");

  // Code blocks become CDATA macros (raw, unescaped), so pull them out before escaping the rest
  const codeBlocks: string[] = [];
  html = html.replaceAll(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code: string) => {
    const langParam = lang ? `<ac:parameter ac:name="language">${lang}</ac:parameter>` : "";
    const cdata = code.trimEnd().replaceAll("]]>", "]]]]><![CDATA[>");
    codeBlocks.push(`<ac:structured-macro ac:name="code">${langParam}<ac:plain-text-body><![CDATA[${cdata}]]></ac:plain-text-body></ac:structured-macro>`);
    return `\uE000CODE${codeBlocks.length - 1}\uE000`;
  });

  html = escapeHtml(html);

  // Inline code
  html = html.replaceAll(/`([^`]+)`/g, "<code>$1</code>");

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
    const headers = (headerRow as string).split("|").filter((c: string) => c.trim()).map((c: string) => `<th><p>${c.trim()}</p></th>`).join("");
    const rows = (bodyRows as string).trim().split("\n").map((row: string) => {
      const cells = row.split("|").filter((c: string) => c.trim()).map((c: string) => `<td><p>${c.trim()}</p></td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Horizontal rules
  html = html.replaceAll(/^---+$/gm, "<hr />");

  // Unordered lists (simple single-level)
  html = html.replaceAll(/^(\s*)-\s+(.+)$/gm, "<li>$2</li>");
  html = html.replaceAll(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replaceAll(/^(\s*)\d+\.\s+(.+)$/gm, "<li>$2</li>");

  // Blockquotes
  html = html.replaceAll(/^&gt;\s+(.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Paragraphs - wrap lines that aren't already in tags
  html = html.replaceAll(/^(?!<[a-z/]|$)(.+)$/gm, "<p>$1</p>");

  // Clean up empty paragraphs
  html = html.replaceAll(/<p>\s*<\/p>/g, "");

  // Restore code blocks (the paragraph pass may have wrapped their placeholders)
  html = html.replaceAll(/(?:<p>)?\uE000CODE(\d+)\uE000(?:<\/p>)?/g, (_match, index: string) => codeBlocks[Number(index)]);

  return html.trim();
}
