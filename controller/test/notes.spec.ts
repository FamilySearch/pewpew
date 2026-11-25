import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, _Object as S3Object } from "@aws-sdk/client-s3";
import {
  NOTES_SECTIONS,
  buildNotesMetadata,
  deletePewPewNotes,
  generateNotesMarkdown,
  getMonitoringConfig,
  getNotesFilename,
  getNotesMetaFilename,
  getNotesMetadata,
  getPewPewNotes,
  isNotesSection,
  makeTempDirectory,
  markdownToConfluence,
  parseYamlTestConfig,
  saveNotesMetadata,
  savePewPewNotes,
  searchNotes,
  updateNotesSection,
  validateNotesParams
} from "../src/notes";
import {
  UNIT_TEST_KEYSPACE_PREFIX,
  mockListObjects,
  mockS3,
  mockUploadObject,
  mockUploadObjectError,
  resetMockS3
} from "./mock";
import { readdir, rm, stat } from "node:fs/promises";
import { LOCAL_FILE_LOCATION } from "../src/util";
import { Readable } from "stream";
import { expect } from "chai";
import path from "node:path";
import { promisify } from "node:util";
import { s3 } from "@fs/ppaas-common";
import { sdkStreamMixin } from "@smithy/util-stream";
import { gzip as zlibGzip } from "node:zlib";

const gzip = promisify(zlibGzip);

describe("Notes", () => {
  describe("getNotesFilename", () => {
    it("should return notes.md", () => {
      expect(getNotesFilename()).to.equal("notes.md");
    });
  });

  describe("getNotesMetaFilename", () => {
    it("should return notes-meta.json", () => {
      expect(getNotesMetaFilename()).to.equal("notes-meta.json");
    });
  });

  describe("validateNotesParams", () => {
    it("should return undefined for valid params", () => {
      expect(validateNotesParams("test.yaml", "20260101T120000000")).to.equal(undefined);
    });

    it("should return undefined for yamlFile with hyphens and underscores", () => {
      expect(validateNotesParams("my-test_file.yaml", "20260101T120000000")).to.equal(undefined);
    });

    it("should reject yamlFile with spaces", () => {
      const result = validateNotesParams("test file.yaml", "20260101T120000000");
      expect(result).to.be.a("string");
      expect(result).to.include("Invalid yamlFile");
    });

    it("should reject yamlFile with path traversal", () => {
      const result = validateNotesParams("../etc/passwd", "20260101T120000000");
      expect(result).to.be.a("string");
      expect(result).to.include("Invalid yamlFile");
    });

    it("should reject invalid dateString format", () => {
      const result = validateNotesParams("test.yaml", "2026-01-01");
      expect(result).to.be.a("string");
      expect(result).to.include("Invalid dateString");
    });

    it("should reject dateString that is too short", () => {
      const result = validateNotesParams("test.yaml", "20260101T12");
      expect(result).to.be.a("string");
      expect(result).to.include("Invalid dateString");
    });
  });

  describe("getMonitoringConfig", () => {
    const originalPlatform = process.env.MONITORING_PLATFORM;

    afterEach(() => {
      if (originalPlatform !== undefined) {
        process.env.MONITORING_PLATFORM = originalPlatform;
      } else {
        delete process.env.MONITORING_PLATFORM;
      }
    });

    it("should return generic config by default", () => {
      delete process.env.MONITORING_PLATFORM;
      const config = getMonitoringConfig();
      expect(config.platform).to.equal("generic");
      expect(config.label).to.equal("Monitoring Dashboard");
    });

    it("should return splunk config", () => {
      process.env.MONITORING_PLATFORM = "splunk";
      const config = getMonitoringConfig();
      expect(config.platform).to.equal("splunk");
      expect(config.label).to.equal("Splunk");
    });

    it("should return dynatrace config", () => {
      process.env.MONITORING_PLATFORM = "dynatrace";
      const config = getMonitoringConfig();
      expect(config.platform).to.equal("dynatrace");
      expect(config.label).to.equal("Dynatrace");
    });
  });

  describe("parseYamlTestConfig", () => {
    it("should parse endpoints from YAML", () => {
      const yaml = `
endpoints:
  search:
    url: https://api.example.com/search
    method: GET
  update:
    url: https://api.example.com/update
    method: POST
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.have.length(2);
      expect(result.endpoints[0]).to.include("search");
      expect(result.endpoints[0]).to.include("https://api.example.com/search");
    });

    it("should parse load patterns from YAML", () => {
      const yaml = `
load_pattern:
  - linear:
      from: 0%
      to: 100%
      over: 5m
  - linear:
      from: 100%
      to: 100%
      over: 15m
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.loadPatterns).to.have.length(2);
      expect(result.loadPatterns[0].type).to.equal("linear");
      expect(result.loadPatterns[0].from).to.equal("0%");
      expect(result.loadPatterns[0].to).to.equal("100%");
    });

    it("should parse providers from YAML", () => {
      const yaml = `
providers:
  userFile:
    file:
      path: users.csv
  sessionData:
    response:
      buffer: 5
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.providers).to.include("userFile");
      expect(result.providers).to.include("sessionData");
    });

    it("should handle empty or invalid YAML", () => {
      const result = parseYamlTestConfig("");
      expect(result.endpoints).to.have.length(0);
      expect(result.loadPatterns).to.have.length(0);
      expect(result.providers).to.have.length(0);
    });

    it("should handle YAML with no relevant sections", () => {
      const yaml = `
config:
  general:
    bucket_size: 1m
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.have.length(0);
      expect(result.loadPatterns).to.have.length(0);
    });

    it("should parse array-format endpoints with method and peak_load", () => {
      const yaml = `
endpoints:
  - url: https://api.example.com/search
    method: POST
    peak_load: 100hpm
  - url: https://api.example.com/health
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.have.length(2);
      expect(result.endpoints[0]).to.equal("POST https://api.example.com/search (100hpm)");
      expect(result.endpoints[1]).to.equal("GET https://api.example.com/health");
    });

    it("should handle array-format endpoints with non-object entries", () => {
      const yaml = `
endpoints:
  - url: https://api.example.com/search
  - not_an_object
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.have.length(1);
    });

    it("should handle object-format endpoints without url", () => {
      const yaml = `
endpoints:
  healthCheck:
    method: GET
  search:
    url: https://api.example.com/search
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.have.length(2);
      expect(result.endpoints[0]).to.equal("healthCheck");
      expect(result.endpoints[1]).to.include("search");
      expect(result.endpoints[1]).to.include("https://api.example.com/search");
    });

    it("should handle endpoints that is not an object", () => {
      const yaml = `
endpoints: "not-an-object"
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.have.length(0);
    });

    it("should return empty results for YAML that throws a parse error", () => {
      const badYaml = ":\n  - :\n    - :\n  {{invalid";
      const result = parseYamlTestConfig(badYaml);
      expect(result.endpoints).to.have.length(0);
      expect(result.loadPatterns).to.have.length(0);
      expect(result.providers).to.have.length(0);
    });

    it("should return empty results when YAML parses to a non-object", () => {
      const result = parseYamlTestConfig("42");
      expect(result.endpoints).to.have.length(0);
    });

    it("should handle load_pattern entries that are empty objects", () => {
      const yaml = `
load_pattern:
  - {}
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.loadPatterns).to.have.length(1);
      expect(result.loadPatterns[0].type).to.equal("unknown");
    });

    it("should handle load_pattern with duration field", () => {
      const yaml = `
load_pattern:
  - linear:
      from: 0%
      to: 100%
      duration: 10m
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.loadPatterns).to.have.length(1);
      expect(result.loadPatterns[0].duration).to.equal("10m");
    });

    it("should handle providers that is an array (not object)", () => {
      const yaml = `
providers:
  - item1
  - item2
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.providers).to.have.length(0);
    });

    it("should parse PewPew custom YAML tags like !linear", () => {
      const yaml = `
load_pattern:
  - !linear
    from: 0%
    to: 100%
    over: 5m
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.loadPatterns).to.have.length(1);
      expect(result.loadPatterns[0].type).to.equal("linear");
    });

    it("should parse scripting configs with provider, logger and body tags", () => {
      const yaml = `
vars:
  rampTime: 1m
load_pattern:
  - !linear
      from: 1%
      to: 100%
      over: \${v:rampTime}
loggers:
  local_logger:
    query:
      select: response.status
    to: !file errors.csv
  console:
    to: !stdout
providers:
  sessionId: !response
    auto_return: force
  localFile: !file
    path: 'text.txt'
    repeat: true
  range: !range
    start: 1
    end: 10
  names: !list
    - a
    - b
endpoints:
  - method: POST
    url: http://127.0.0.1:8080/healthcheck
    body: !str '{"id": "\${p:sessionId}"}'
    peak_load: 30hpm
`;
      const result = parseYamlTestConfig(yaml);
      expect(result.endpoints).to.deep.equal(["POST http://127.0.0.1:8080/healthcheck (30hpm)"]);
      expect(result.loadPatterns).to.deep.equal([{ type: "linear", from: "1%", to: "100%", duration: "${v:rampTime}" }]);
      expect(result.providers).to.deep.equal(["sessionId", "localFile", "range", "names"]);
    });
  });

  describe("generateNotesMarkdown", () => {
    it("should generate markdown with test overview", () => {
      const { markdown, testOverview } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000"
      });
      expect(markdown).to.include("# Performance Test Notes: test.yaml");
      expect(markdown).to.include("## Test Overview");
      expect(markdown).to.include("## Objectives");
      expect(markdown).to.include("## Environment");
      expect(markdown).to.include("## Findings");
      expect(markdown).to.include("## Conclusion");
      expect(testOverview.testName).to.equal("test.yaml");
    });

    it("should include test data when provided", () => {
      const { markdown, testOverview } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000",
        testData: {
          testId: "test.yaml20260101T120000000",
          s3Folder: "test.yaml/20260101T120000000",
          startTime: 1735725600000,
          endTime: 1735729200000,
          status: 2, // Finished
          version: "0.6.5"
        } as any
      });
      expect(markdown).to.include("0.6.5");
      expect(testOverview.pewpewVersion).to.equal("0.6.5");
      expect(testOverview.duration).to.not.equal(undefined);
    });

    it("should include YAML content when provided", () => {
      const yamlContent = `
endpoints:
  search:
    url: https://api.example.com/search
load_pattern:
  - linear:
      from: 0%
      to: 100%
      over: 5m
`;
      const { markdown } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000",
        yamlContent
      });
      expect(markdown).to.include("search");
      expect(markdown).to.include("https://api.example.com/search");
      expect(markdown).to.include("linear");
    });

    it("should support multiple yamlContents", () => {
      const yaml1 = `
endpoints:
  search:
    url: https://api.example.com/search
`;
      const yaml2 = `
endpoints:
  update:
    url: https://api.example.com/update
`;
      const { testOverview } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000",
        yamlContents: [yaml1, yaml2]
      });
      expect(testOverview.endpoints).to.have.length(2);
    });

    it("should calculate seconds-only duration for short tests", () => {
      const { testOverview } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000",
        testData: {
          testId: "test.yaml20260101T120000000",
          s3Folder: "test.yaml/20260101T120000000",
          startTime: 1735725600000,
          endTime: 1735725630000, // 30 seconds
          status: 2,
          version: "0.6.5"
        } as any
      });
      expect(testOverview.duration).to.equal("30s");
    });

    it("should include providers section when providers exist", () => {
      const yamlContent = `
endpoints:
  search:
    url: https://api.example.com/search
providers:
  userFile:
    file:
      path: users.csv
`;
      const { markdown } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000",
        yamlContent
      });
      expect(markdown).to.include("### Providers");
      expect(markdown).to.include("userFile");
    });

    it("should handle no testData gracefully", () => {
      const { markdown, testOverview } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000"
      });
      expect(markdown).to.include("Unknown");
      expect(markdown).to.include("N/A");
      expect(testOverview.duration).to.equal(undefined);
      expect(testOverview.testStatus).to.equal(undefined);
    });

    it("should use dateString when startTime is not available", () => {
      const { markdown } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000"
      });
      expect(markdown).to.include("20260101T120000000");
    });

    it("should show no load patterns message when none defined", () => {
      const { markdown } = generateNotesMarkdown({
        yamlFile: "test.yaml",
        dateString: "20260101T120000000"
      });
      expect(markdown).to.include("No load patterns defined");
    });

    it("should include monitoring dashboard link when configured", () => {
      const origUrl = process.env.MONITORING_DASHBOARD_URL;
      process.env.MONITORING_DASHBOARD_URL = "https://monitoring.example.com";
      try {
        const { markdown } = generateNotesMarkdown({
          yamlFile: "test.yaml",
          dateString: "20260101T120000000"
        });
        expect(markdown).to.include("[Dashboard](https://monitoring.example.com)");
      } finally {
        if (origUrl !== undefined) {
          process.env.MONITORING_DASHBOARD_URL = origUrl;
        } else {
          delete process.env.MONITORING_DASHBOARD_URL;
        }
      }
    });
  });

  describe("isNotesSection", () => {
    it("should accept the four sections", () => {
      expect(NOTES_SECTIONS).to.deep.equal(["objectives", "environment", "findings", "conclusion"]);
      for (const section of NOTES_SECTIONS) { expect(isNotesSection(section), section).to.equal(true); }
    });

    it("should reject unknown and inherited names", () => {
      for (const section of ["bogus", "constructor", "toString", "hasOwnProperty", "__proto__", ""]) {
        expect(isNotesSection(section), section).to.equal(false);
      }
    });
  });

  describe("buildNotesMetadata", () => {
    const now = "2026-11-23T00:00:00.000Z";

    it("should record createdBy and updatedBy on a first save", () => {
      expect(buildNotesMetadata({ userId: "alice", now })).to.deep.equal({
        version: 1, createdAt: now, updatedAt: now, createdBy: "alice", updatedBy: "alice"
      });
    });

    it("should keep createdBy and createdAt when updating existing metadata", () => {
      const existing = { version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", createdBy: "alice" };
      expect(buildNotesMetadata({ existing, userId: "bob", now })).to.deep.equal({ ...existing, updatedAt: now, updatedBy: "bob" });
    });

    it("should leave the user fields unset without a userId", () => {
      const metadata = buildNotesMetadata({ now });
      expect(metadata.createdBy).to.equal(undefined);
      expect(metadata.updatedBy).to.equal(undefined);
    });
  });

  describe("markdownToConfluence", () => {
    it("should convert headings", () => {
      expect(markdownToConfluence("# Heading 1")).to.include("<h1>Heading 1</h1>");
      expect(markdownToConfluence("## Heading 2")).to.include("<h2>Heading 2</h2>");
      expect(markdownToConfluence("### Heading 3")).to.include("<h3>Heading 3</h3>");
    });

    it("should convert bold and italic", () => {
      expect(markdownToConfluence("**bold**")).to.include("<strong>bold</strong>");
      expect(markdownToConfluence("*italic*")).to.include("<em>italic</em>");
    });

    it("should convert links", () => {
      const result = markdownToConfluence("[link](https://example.com)");
      expect(result).to.include("<a href=\"https://example.com\">link</a>");
    });

    it("should convert code blocks to Confluence macros", () => {
      const result = markdownToConfluence("```javascript\nconsole.log('test');\n```");
      expect(result).to.include("ac:structured-macro");
      expect(result).to.include("javascript");
      expect(result).to.include("console.log");
    });

    it("should convert inline code", () => {
      expect(markdownToConfluence("`code`")).to.include("<code>code</code>");
    });

    it("should convert tables", () => {
      const md = "| Header | Value |\n|--------|-------|\n| test | 123 |";
      const result = markdownToConfluence(md);
      expect(result).to.include("<table>");
      expect(result).to.include("<th>");
      expect(result).to.include("<td>");
    });

    it("should strip HTML comments", () => {
      const result = markdownToConfluence("<!-- comment -->\nVisible text");
      expect(result).to.not.include("comment");
      expect(result).to.include("Visible text");
    });

    it("should convert horizontal rules", () => {
      expect(markdownToConfluence("---")).to.include("<hr />");
    });

    it("should convert images to Confluence image macros", () => {
      const result = markdownToConfluence("![alt text](https://example.com/image.png)");
      expect(result).to.include("<ac:image><ri:url ri:value=\"https://example.com/image.png\" /></ac:image>");
      expect(result).to.not.include("<a href");
    });

    it("should escape raw HTML in notes", () => {
      const result = markdownToConfluence("Hello <script>alert(1)</script> & <img src=x onerror=alert(1)>");
      expect(result).to.not.include("<script>");
      expect(result).to.not.include("<img");
      expect(result).to.include("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;");
    });

    it("should escape quotes in link URLs so they cannot break out of the attribute", () => {
      const result = markdownToConfluence("[x](https://example.com/\" onmouseover=\"alert(1))");
      expect(result).to.not.include("\" onmouseover");
      expect(result).to.include("<a href=\"https://example.com/&quot; onmouseover=&quot;alert(1\">");
    });

    it("should drop unsafe link and image schemes but keep the text", () => {
      const link = markdownToConfluence("[click me](javascript:alert)");
      expect(link).to.not.include("javascript:");
      expect(link).to.not.include("<a ");
      expect(link).to.include("click me");
      const image = markdownToConfluence("![pic](data:image/svg+xml;base64,AAAA)");
      expect(image).to.not.include("data:");
      expect(image).to.not.include("ac:image");
    });

    it("should keep relative and mailto links", () => {
      expect(markdownToConfluence("[status](/teststatus?testId=abc)")).to.include("<a href=\"/teststatus?testId=abc\">status</a>");
      expect(markdownToConfluence("[mail](mailto:team@example.com)")).to.include("<a href=\"mailto:team@example.com\">mail</a>");
    });

    it("should leave code block content raw inside CDATA and not wrap it in a paragraph", () => {
      const result = markdownToConfluence("Before\n\n```\nif (a < b && c > d) { return \"x\"; }\n```\n\nAfter");
      expect(result).to.include("<![CDATA[if (a < b && c > d) { return \"x\"; }]]>");
      expect(result).to.not.include("<p><ac:structured-macro");
      expect(result).to.include("<p>Before</p>");
      expect(result).to.include("<p>After</p>");
    });

    it("should split a CDATA terminator inside a code block", () => {
      const result = markdownToConfluence("```\na]]>b\n```");
      expect(result).to.include("<![CDATA[a]]]]><![CDATA[>b]]>");
    });

    it("should escape HTML inside inline code", () => {
      expect(markdownToConfluence("`<div>`")).to.include("<code>&lt;div&gt;</code>");
    });

    it("should keep HTML comments inside fenced code blocks", () => {
      const result = markdownToConfluence("```html\n<!-- keep me -->\n<div></div>\n```\n\n<!-- strip me -->\nText");
      expect(result).to.include("<![CDATA[<!-- keep me -->\n<div></div>]]>");
      expect(result).to.not.include("strip me");
      expect(result).to.include("<p>Text</p>");
    });

    it("should not apply markdown formatting inside inline code", () => {
      expect(markdownToConfluence("Match `**/*.yaml` files")).to.include("<code>**/*.yaml</code>");
      const link = markdownToConfluence("Use `[name](url)` syntax");
      expect(link).to.include("<code>[name](url)</code>");
      expect(link).to.not.include("<a ");
    });

    it("should keep empty table cells in their column", () => {
      const result = markdownToConfluence("| Metric | Before | After |\n|---|---|---|\n| p95 | | 200ms |");
      expect(result).to.include("<tr><td><p>p95</p></td><td></td><td><p>200ms</p></td></tr>");
      expect(result).to.include("<th><p>Metric</p></th><th><p>Before</p></th><th><p>After</p></th>");
    });

    it("should wrap ordered list items in <ol>", () => {
      const result = markdownToConfluence("1. First\n2. Second\n3. Third");
      expect(result).to.include("<ol><li>First</li>\n<li>Second</li>\n<li>Third</li></ol>");
      expect(result).to.not.include("<ul>");
    });

    it("should keep formatting on the line right after a list", () => {
      expect(markdownToConfluence("1. a\n2. b\n- c\n- d")).to.equal("<ol><li>a</li>\n<li>b</li></ol>\n<ul><li>c</li>\n<li>d</li></ul>");
      expect(markdownToConfluence("1. a\n2. b\n> quote")).to.include("</ol>\n<blockquote><p>quote</p></blockquote>");
      expect(markdownToConfluence("- a\n- b\nplain text after")).to.include("</ul>\n<p>plain text after</p>");
    });

    it("should not let a list item match reach across a blank line", () => {
      const result = markdownToConfluence("Intro\n\n1. a");
      expect(result).to.include("<p>Intro</p>\n\n<ol><li>a</li></ol>");
    });

    it("should keep HTML comments inside inline code", () => {
      expect(markdownToConfluence("Use `<!-- x -->` here")).to.equal("<p>Use <code>&lt;!-- x --&gt;</code> here</p>");
    });

    it("should not let a stray backtick swallow later lines into inline code", () => {
      const result = markdownToConfluence("text with `code\n\n# heading` end");
      expect(result).to.include("<h1>heading` end</h1>");
      expect(result).to.not.include("<code>");
    });

    it("should ignore placeholder characters pasted into the notes", () => {
      const result = markdownToConfluence("before \uE001CODE5\uE001 and \uE000CODE3\uE000 after `x`");
      expect(result).to.not.include("undefined");
      expect(result).to.not.match(/[\uE000\uE001]/);
      expect(result).to.include("<code>x</code>");
    });

    it("should keep ordered and unordered lists separate", () => {
      const result = markdownToConfluence("- a\n- b\n\n1. one\n2. two");
      expect(result).to.include("<ul><li>a</li>\n<li>b</li></ul>");
      expect(result).to.include("<ol><li>one</li>\n<li>two</li></ol>");
    });

    it("should convert strikethrough", () => {
      expect(markdownToConfluence("~~deleted~~")).to.include("<del>deleted</del>");
    });

    it("should convert bold italic combo", () => {
      expect(markdownToConfluence("***bold italic***")).to.include("<strong><em>bold italic</em></strong>");
    });

    it("should convert h4, h5, h6 headings", () => {
      expect(markdownToConfluence("#### H4")).to.include("<h4>H4</h4>");
      expect(markdownToConfluence("##### H5")).to.include("<h5>H5</h5>");
      expect(markdownToConfluence("###### H6")).to.include("<h6>H6</h6>");
    });

    it("should convert blockquotes", () => {
      const result = markdownToConfluence("> This is a quote");
      expect(result).to.include("<blockquote>");
      expect(result).to.include("This is a quote");
    });

    it("should convert ordered lists", () => {
      const result = markdownToConfluence("1. First item\n2. Second item");
      expect(result).to.include("<li>First item</li>");
      expect(result).to.include("<li>Second item</li>");
    });

    it("should convert code blocks without language", () => {
      const result = markdownToConfluence("```\nsome code\n```");
      expect(result).to.include("ac:structured-macro");
      expect(result).to.include("some code");
    });

    it("should wrap plain text in paragraph tags", () => {
      const result = markdownToConfluence("Just some text");
      expect(result).to.include("<p>Just some text</p>");
    });

    it("should remove empty paragraphs", () => {
      const result = markdownToConfluence("# Heading\n\nContent");
      expect(result).to.not.include("<p></p>");
    });

    it("should convert unordered lists", () => {
      const result = markdownToConfluence("- Item A\n- Item B");
      expect(result).to.include("<ul>");
      expect(result).to.include("<li>Item A</li>");
      expect(result).to.include("<li>Item B</li>");
    });
  });

  // S3-mocked tests for async notes functions
  describe("S3 operations", () => {
    const testYamlFile = "test.yaml";
    const testDateString = "20260101T120000000";
    const testS3Folder = `${testYamlFile}/${testDateString}`;
    const notesKey = `${testS3Folder}/notes.md`;
    const metaKey = `${testS3Folder}/notes-meta.json`;
    let mockedS3: ReturnType<typeof mockS3>;

    // Helper to create a mock S3 GetObject response with optional gzip encoding
    function mockGetObjectWithEncoding (body: string, contentEncoding?: string) {
      const stream = new Readable();
      stream.push(body);
      stream.push(null);
      const sdkStream = sdkStreamMixin(stream);
      mockedS3.on(GetObjectCommand).resolves({
        Body: sdkStream,
        ContentEncoding: contentEncoding,
        ContentLength: body.length,
        ContentType: "text/plain"
      });
    }

    async function mockGetObjectGzip (body: string) {
      const compressed = await gzip(Buffer.from(body));
      const stream = new Readable();
      stream.push(compressed);
      stream.push(null);
      const sdkStream = sdkStreamMixin(stream);
      mockedS3.on(GetObjectCommand).resolves({
        Body: sdkStream,
        ContentEncoding: "gzip",
        ContentLength: compressed.length,
        ContentType: "text/plain"
      });
    }

    before(() => {
      mockedS3 = mockS3();
    });

    beforeEach(() => {
      mockedS3.reset();
    });

    after(() => {
      resetMockS3();
    });

    describe("getPewPewNotes", () => {
      it("should return undefined when no files found", async () => {
        mockListObjects([]);
        const result = await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });

      it("should return undefined when listFiles returns undefined-like", async () => {
        mockListObjects(undefined);
        const result = await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });

      it("should return undefined when file key does not match", async () => {
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${testS3Folder}/other-file.txt`,
          LastModified: new Date(),
          Size: 1
        };
        mockListObjects([s3Object]);
        const result = await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });

      it("should return plain text notes from S3", async () => {
        const notesContent = "# Test Notes\nSome content";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: notesContent.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(notesContent);
        const result = await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(notesContent);
      });

      it("should decompress gzip-encoded notes from S3", async () => {
        const notesContent = "# Gzipped Notes\nCompressed content";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: 100
        };
        mockListObjects([s3Object]);
        await mockGetObjectGzip(notesContent);
        const result = await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(notesContent);
      });

      it("should return undefined when S3 object has no Body", async () => {
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: 0
        };
        mockListObjects([s3Object]);
        mockedS3.on(GetObjectCommand).resolves({
          ContentType: "text/plain"
        });
        const result = await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });

      it("should throw when S3 getObject fails", async () => {
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: 1
        };
        mockListObjects([s3Object]);
        mockedS3.on(GetObjectCommand).rejects(new Error("S3 access denied"));
        try {
          await getPewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("S3 access denied");
        }
      });
    });

    describe("savePewPewNotes", () => {
      it("should save notes to S3", async () => {
        mockUploadObject();
        mockListObjects([]);
        await savePewPewNotes({
          yamlFile: testYamlFile,
          dateString: testDateString,
          content: "# Notes",
          userId: "testuser"
        });
      });

      it("should save notes without userId", async () => {
        mockUploadObject();
        mockListObjects([]);
        await savePewPewNotes({
          yamlFile: testYamlFile,
          dateString: testDateString,
          content: "# Notes"
        });
      });

      it("should update existing metadata when present", async () => {
        const existingMeta = JSON.stringify({
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          createdBy: "original"
        });
        mockUploadObject();
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: existingMeta.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(existingMeta);
        await savePewPewNotes({
          yamlFile: testYamlFile,
          dateString: testDateString,
          content: "# Updated",
          userId: "updater"
        });
      });

      it("should fail instead of replacing metadata it could not read", async () => {
        mockUploadObject();
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: 1
        };
        mockListObjects([s3Object]);
        mockedS3.on(GetObjectCommand).rejects(new Error("Access denied"));
        try {
          await savePewPewNotes({
            yamlFile: testYamlFile,
            dateString: testDateString,
            content: "# Notes",
            userId: "testuser"
          });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("Access denied");
        }
      });

      it("should throw when S3 upload fails", async () => {
        mockUploadObjectError("Upload failed");
        try {
          await savePewPewNotes({
            yamlFile: testYamlFile,
            dateString: testDateString,
            content: "# Notes"
          });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("Upload failed");
        }
      });
    });

    describe("deletePewPewNotes", () => {
      afterEach(() => {
        mockedS3.on(DeleteObjectCommand).resolves({});
      });

      it("should delete both notes and metadata files", async () => {
        await deletePewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
      });

      it("should throw when notes.md cannot be deleted", async () => {
        mockedS3.on(DeleteObjectCommand, { Key: `${s3.KEYSPACE_PREFIX}${notesKey}` }).rejects(new Error("Access denied"));
        try {
          await deletePewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("Access denied");
        }
      });

      it("should still succeed when only the metadata delete fails", async () => {
        mockedS3.on(DeleteObjectCommand, { Key: `${s3.KEYSPACE_PREFIX}${metaKey}` }).rejects(new Error("Access denied"));
        await deletePewPewNotes({ yamlFile: testYamlFile, dateString: testDateString });
      });
    });

    describe("save temp directories", () => {
      const notesDirs = async () => (await readdir(LOCAL_FILE_LOCATION)).filter((name: string) => name.startsWith("notes-"));

      it("should give concurrent saves of the same test their own directories and clean them up", async () => {
        const before = await notesDirs();
        mockUploadObject();
        mockListObjects([]);
        await Promise.all([1, 2, 3].map((index: number) => savePewPewNotes({
          yamlFile: testYamlFile,
          dateString: testDateString,
          content: `# Notes ${index}`
        })));
        expect(await notesDirs()).to.deep.equal(before);
      });

      it("makeTempDirectory should create a unique directory under LOCAL_FILE_LOCATION with a short prefix", async () => {
        const [first, second] = await Promise.all([makeTempDirectory("notes-"), makeTempDirectory("notes-")]);
        try {
          expect(first).to.not.equal(second);
          for (const dir of [first, second]) {
            expect(path.dirname(dir)).to.equal(path.resolve(LOCAL_FILE_LOCATION));
            expect(path.basename(dir)).to.match(/^notes-\w{6}$/);
            expect((await stat(dir)).isDirectory()).to.equal(true);
          }
        } finally {
          await Promise.all([first, second].map((dir: string) => rm(dir, { recursive: true, force: true })));
        }
      });
    });

    describe("getNotesMetadata", () => {
      it("should return undefined when no metadata file exists", async () => {
        mockListObjects([]);
        const result = await getNotesMetadata({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });

      it("should return parsed metadata from S3", async () => {
        const metadata = {
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
        const metaJson = JSON.stringify(metadata);
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: metaJson.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(metaJson);
        const result = await getNotesMetadata({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.not.equal(undefined);
        expect(result!.version).to.equal(1);
        expect(result!.createdAt).to.equal("2026-01-01T00:00:00.000Z");
      });

      it("should decompress gzip-encoded metadata", async () => {
        const metadata = {
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z"
        };
        const metaJson = JSON.stringify(metadata);
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: 100
        };
        mockListObjects([s3Object]);
        await mockGetObjectGzip(metaJson);
        const result = await getNotesMetadata({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.not.equal(undefined);
        expect(result!.updatedAt).to.equal("2026-01-02T00:00:00.000Z");
      });

      it("should return undefined when S3 object has no Body", async () => {
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: 0
        };
        mockListObjects([s3Object]);
        mockedS3.on(GetObjectCommand).resolves({ ContentType: "application/json" });
        const result = await getNotesMetadata({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });

      it("should throw on S3 read error", async () => {
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: 1
        };
        mockListObjects([s3Object]);
        mockedS3.on(GetObjectCommand).rejects(new Error("Access denied"));
        try {
          await getNotesMetadata({ yamlFile: testYamlFile, dateString: testDateString });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("Access denied");
        }
      });

      it("should return undefined when the metadata is not valid JSON", async () => {
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${metaKey}`,
          LastModified: new Date(),
          Size: 8
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding("{corrupt");
        const result = await getNotesMetadata({ yamlFile: testYamlFile, dateString: testDateString });
        expect(result).to.equal(undefined);
      });
    });

    describe("saveNotesMetadata", () => {
      it("should save metadata to S3", async () => {
        mockUploadObject();
        await saveNotesMetadata({
          yamlFile: testYamlFile,
          dateString: testDateString,
          metadata: {
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        });
      });

      it("should throw when S3 upload fails", async () => {
        mockUploadObjectError("Metadata upload failed");
        try {
          await saveNotesMetadata({
            yamlFile: testYamlFile,
            dateString: testDateString,
            metadata: {
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("Metadata upload failed");
        }
      });
    });

    describe("updateNotesSection", () => {
      it("should throw for unknown section", async () => {
        try {
          await updateNotesSection({
            yamlFile: testYamlFile,
            dateString: testDateString,
            section: "nonexistent",
            content: "new content"
          });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.include("Unknown section");
          expect(error.message).to.include("nonexistent");
        }
      });

      it("should treat inherited object properties as unknown sections", async () => {
        for (const section of ["constructor", "toString", "__proto__"]) {
          try {
            await updateNotesSection({ yamlFile: testYamlFile, dateString: testDateString, section, content: "x" });
            expect.fail(`Should have thrown for ${section}`);
          } catch (error: any) {
            expect(error.message, section).to.include("Unknown section");
          }
        }
      });

      it("should throw when no existing notes found", async () => {
        mockListObjects([]);
        try {
          await updateNotesSection({
            yamlFile: testYamlFile,
            dateString: testDateString,
            section: "findings",
            content: "new findings"
          });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.include("No existing notes");
        }
      });

      it("should append content to an existing section", async () => {
        const existingNotes = "# Notes\n\n## Findings\nOld findings\n\n## Conclusion\nDone";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: existingNotes.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(existingNotes);
        const result = await updateNotesSection({
          yamlFile: testYamlFile,
          dateString: testDateString,
          section: "findings",
          content: "New findings appended"
        });
        expect(result).to.include("Old findings");
        expect(result).to.include("New findings appended");
        expect(result).to.include("Updated:");
        expect(result).to.include("## Conclusion");
      });

      it("should replace section content when append is false", async () => {
        const existingNotes = "# Notes\n\n## Findings\nOld findings\n\n## Conclusion\nDone";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: existingNotes.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(existingNotes);
        const result = await updateNotesSection({
          yamlFile: testYamlFile,
          dateString: testDateString,
          section: "findings",
          content: "Replacement findings",
          append: false
        });
        expect(result).to.not.include("Old findings");
        expect(result).to.include("Replacement findings");
        expect(result).to.include("## Conclusion");
      });

      it("should append section at end when section header not found", async () => {
        const existingNotes = "# Notes\n\n## Findings\nSome findings";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: existingNotes.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(existingNotes);
        const result = await updateNotesSection({
          yamlFile: testYamlFile,
          dateString: testDateString,
          section: "conclusion",
          content: "Final conclusion"
        });
        expect(result).to.include("## Conclusion");
        expect(result).to.include("Final conclusion");
      });

      it("should not match a sub-heading or a longer heading that starts with the section name", async () => {
        const existingNotes = "# Notes\n\n## Objectives\n### Findings\nSub-heading text\n\n"
          + "## Findings Summary\nSummary text\n\n## Findings\r\nReal findings\n\n## Conclusion\nDone";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: existingNotes.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(existingNotes);
        const result = await updateNotesSection({
          yamlFile: testYamlFile,
          dateString: testDateString,
          section: "findings",
          content: "Replacement findings",
          append: false
        });
        expect(result).to.include("### Findings\nSub-heading text");
        expect(result).to.include("## Findings Summary\nSummary text");
        expect(result).to.not.include("Real findings");
        expect(result).to.include("## Findings\nReplacement findings\n\n## Conclusion");
      });

      it("should handle section at end of file (no following section)", async () => {
        const existingNotes = "# Notes\n\n## Conclusion\nOld conclusion";
        const s3Object: S3Object = {
          Key: `${UNIT_TEST_KEYSPACE_PREFIX}${notesKey}`,
          LastModified: new Date(),
          Size: existingNotes.length
        };
        mockListObjects([s3Object]);
        mockGetObjectWithEncoding(existingNotes);
        const result = await updateNotesSection({
          yamlFile: testYamlFile,
          dateString: testDateString,
          section: "conclusion",
          content: "Additional conclusion"
        });
        expect(result).to.include("Old conclusion");
        expect(result).to.include("Additional conclusion");
      });
    });

    describe("searchNotes", () => {
      it("should allow empty query", async () => {
        mockListObjects([]);
        const results = await searchNotes({ query: "" });
        expect(results).to.have.length(0);
      });

      it("should allow undefined query", async () => {
        mockListObjects([]);
        const results = await searchNotes({ query: undefined });
        expect(results).to.have.length(0);
      });

      it("should throw for query exceeding max length", async () => {
        try {
          await searchNotes({ query: "a".repeat(1025) });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.include("must not exceed");
        }
      });

      it("should throw for query with invalid characters", async () => {
        try {
          await searchNotes({ query: "test file name" });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.include("invalid characters");
        }
      });

      it("should return empty results when no files found", async () => {
        mockListObjects([]);
        const results = await searchNotes({ query: "test.yaml" });
        expect(results).to.have.length(0);
      });

      it("should return search results with parsed yamlFile and dateString", async () => {
        // Use the actual KEYSPACE_PREFIX set by mockS3() so key parsing works
        const prefix = s3.KEYSPACE_PREFIX;
        const s3Objects: S3Object[] = [
          {
            Key: `${prefix}test.yaml/20260101T120000000/notes.md`,
            LastModified: new Date(),
            Size: 100
          },
          {
            Key: `${prefix}test.yaml/20260102T120000000/notes.md`,
            LastModified: new Date(),
            Size: 200
          }
        ];
        mockListObjects(s3Objects);
        const results = await searchNotes({ query: "test.yaml" });
        expect(results).to.have.length(2);
        expect(results[0].yamlFile).to.equal("test.yaml");
        expect(results[0].dateString).to.equal("20260101T120000000");
        expect(results[0].s3Folder).to.equal("test.yaml/20260101T120000000");
        expect(results[1].dateString).to.equal("20260102T120000000");
      });

      it("should skip files that are not notes.md", async () => {
        const prefix = s3.KEYSPACE_PREFIX;
        const s3Objects: S3Object[] = [
          {
            Key: `${prefix}test.yaml/20260101T120000000/results.json`,
            LastModified: new Date(),
            Size: 100
          },
          {
            Key: `${prefix}test.yaml/20260101T120000000/notes.md`,
            LastModified: new Date(),
            Size: 100
          }
        ];
        mockListObjects(s3Objects);
        const results = await searchNotes({ query: "test.yaml" });
        expect(results).to.have.length(1);
        expect(results[0].yamlFile).to.equal("test.yaml");
      });

      it("should respect the limit parameter", async () => {
        const prefix = s3.KEYSPACE_PREFIX;
        const s3Objects: S3Object[] = Array.from({ length: 5 }, (_, i) => ({
          Key: `${prefix}test.yaml/2026010${i + 1}T120000000/notes.md`,
          LastModified: new Date(),
          Size: 100
        }));
        mockListObjects(s3Objects);
        const results = await searchNotes({ query: "test.yaml", limit: 2 });
        expect(results).to.have.length(2);
      });

      it("should throw when S3 listFiles fails", async () => {
        mockedS3.on(ListObjectsV2Command).rejects(new Error("S3 list error"));
        try {
          await searchNotes({ query: "test.yaml" });
          expect.fail("Should have thrown");
        } catch (error: any) {
          expect(error.message).to.equal("S3 list error");
        }
      });

      it("should skip keys with too few path segments", async () => {
        const prefix = s3.KEYSPACE_PREFIX;
        const s3Objects: S3Object[] = [
          {
            Key: `${prefix}notes.md`,
            LastModified: new Date(),
            Size: 100
          }
        ];
        mockListObjects(s3Objects);
        const results = await searchNotes({ query: "notes.md" });
        expect(results).to.have.length(0);
      });
    });
  });
});
