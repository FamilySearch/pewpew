import {
  LogLevel,
  log,
  s3
} from "@fs/ppaas-common";
import {
  deletePewPewNotes,
  generateNotesMarkdown,
  getMonitoringConfig,
  getNotesMetadata,
  getPewPewNotes,
  markdownToConfluence,
  saveNotesMetadata,
  savePewPewNotes,
  searchNotes
} from "../src/notes";
import { NotesMetadata } from "../types";
import { expect } from "chai";

const TEST_YAML_FILE = "integration-notes-test.yaml";
const TEST_DATE_STRING = "20260101T120000000";
const TEST_CONTENT = "# Integration Test Notes\n\n## Objectives\nTest the notes system\n\n## Findings\nAll good!";

describe("Notes Integration", () => {
  before(() => {
    log("Notes Integration tests starting", LogLevel.INFO, {
      bucket: s3.BUCKET_NAME,
      prefix: s3.KEYSPACE_PREFIX
    });
  });

  after(async () => {
    // Cleanup
    try {
      await deletePewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
    } catch (error) {
      log("Notes Integration cleanup failed", LogLevel.WARN, error);
    }
  });

  describe("CRUD Lifecycle", () => {
    it("should return undefined for non-existent notes", async () => {
      const notes = await getPewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(notes).to.equal(undefined);
    });

    it("should save notes to S3", async () => {
      await savePewPewNotes({
        yamlFile: TEST_YAML_FILE,
        dateString: TEST_DATE_STRING,
        content: TEST_CONTENT,
        userId: "integration-test"
      });
    });

    it("should read saved notes from S3", async () => {
      const notes = await getPewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(notes).to.not.equal(undefined);
      expect(notes).to.include("Integration Test Notes");
      expect(notes).to.include("## Objectives");
      expect(notes).to.include("All good!");
    });

    it("should have created metadata alongside notes", async () => {
      const metadata = await getNotesMetadata({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(metadata).to.not.equal(undefined);
      expect(metadata!.version).to.equal(1);
      expect(metadata!.createdAt).to.not.equal(undefined);
      expect(metadata!.updatedAt).to.not.equal(undefined);
      expect(metadata!.updatedBy).to.equal("integration-test");
    });

    it("should overwrite notes on save", async () => {
      const updatedContent = TEST_CONTENT + "\n\n## Conclusion\n- **Result**: Pass";
      await savePewPewNotes({
        yamlFile: TEST_YAML_FILE,
        dateString: TEST_DATE_STRING,
        content: updatedContent,
        userId: "integration-test-2"
      });
      const notes = await getPewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(notes).to.include("## Conclusion");
      expect(notes).to.include("Pass");
    });

    it("should update metadata updatedBy on overwrite", async () => {
      const metadata = await getNotesMetadata({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(metadata).to.not.equal(undefined);
      expect(metadata!.updatedBy).to.equal("integration-test-2");
    });

    it("should delete notes and metadata from S3", async () => {
      await deletePewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      const notes = await getPewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(notes).to.equal(undefined);
      const metadata = await getNotesMetadata({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(metadata).to.equal(undefined);
    });
  });

  describe("Metadata", () => {
    before(async () => {
      await savePewPewNotes({
        yamlFile: TEST_YAML_FILE,
        dateString: TEST_DATE_STRING,
        content: TEST_CONTENT
      });
    });

    after(async () => {
      await deletePewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
    });

    it("should save and retrieve custom metadata", async () => {
      const metadata: NotesMetadata = {
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ["integration", "baseline"],
        testOverview: {
          testName: TEST_YAML_FILE,
          endpoints: ["https://api.example.com/test"],
          loadPatterns: [{ type: "linear", from: "0%", to: "100%", duration: "5m" }]
        }
      };
      await saveNotesMetadata({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING, metadata });

      const retrieved = await getNotesMetadata({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
      expect(retrieved).to.not.equal(undefined);
      expect(retrieved!.tags).to.deep.equal(["integration", "baseline"]);
      expect(retrieved!.testOverview!.testName).to.equal(TEST_YAML_FILE);
      expect(retrieved!.testOverview!.endpoints).to.have.length(1);
      expect(retrieved!.testOverview!.loadPatterns).to.have.length(1);
    });
  });

  describe("Search", () => {
    before(async () => {
      await savePewPewNotes({
        yamlFile: TEST_YAML_FILE,
        dateString: TEST_DATE_STRING,
        content: TEST_CONTENT
      });
    });

    after(async () => {
      await deletePewPewNotes({ yamlFile: TEST_YAML_FILE, dateString: TEST_DATE_STRING });
    });

    it("should find notes by prefix", async () => {
      const results = await searchNotes({ query: "integration-notes" });
      expect(results.length).to.be.greaterThan(0);
      const match = results.find((r) => r.yamlFile === TEST_YAML_FILE);
      expect(match).to.not.equal(undefined);
      expect(match!.dateString).to.equal(TEST_DATE_STRING);
    });

    it("should return empty for non-matching query", async () => {
      const results = await searchNotes({ query: "nonexistent-zzz-xxx" });
      expect(results).to.have.length(0);
    });

    it("should respect limit parameter", async () => {
      const results = await searchNotes({ limit: 1 });
      expect(results.length).to.be.lessThanOrEqual(1);
    });
  });

  describe("Template Generation", () => {
    it("should generate a markdown template", () => {
      const { markdown, testOverview } = generateNotesMarkdown({
        yamlFile: TEST_YAML_FILE,
        dateString: TEST_DATE_STRING
      });
      expect(markdown).to.include(`# Performance Test Notes: ${TEST_YAML_FILE}`);
      expect(markdown).to.include("## Test Overview");
      expect(markdown).to.include("## Objectives");
      expect(markdown).to.include("## Findings");
      expect(markdown).to.include("## Conclusion");
      expect(testOverview.testName).to.equal(TEST_YAML_FILE);
    });

    it("should include YAML data in template when provided", () => {
      const yamlContent = `
endpoints:
  search:
    url: https://api.example.com/search
load_pattern:
  - linear:
      from: 0%
      to: 100%
      over: 5m
providers:
  userFile:
    file:
      path: users.csv
`;
      const { markdown, testOverview } = generateNotesMarkdown({
        yamlFile: TEST_YAML_FILE,
        dateString: TEST_DATE_STRING,
        yamlContent
      });
      expect(markdown).to.include("search");
      expect(markdown).to.include("https://api.example.com/search");
      expect(markdown).to.include("linear");
      expect(testOverview.endpoints).to.have.length(1);
      expect(testOverview.loadPatterns).to.have.length(1);
      expect(testOverview.providers).to.include("userFile");
    });
  });

  describe("Confluence Export", () => {
    it("should convert markdown to Confluence format", () => {
      const confluence = markdownToConfluence(TEST_CONTENT);
      expect(confluence).to.include("<h1>");
      expect(confluence).to.include("<h2>");
      expect(confluence).to.include("Integration Test Notes");
    });
  });

  describe("Monitoring Config", () => {
    it("should return a valid monitoring config", () => {
      const config = getMonitoringConfig();
      expect(config).to.not.equal(undefined);
      expect(config.platform).to.not.equal(undefined);
      expect(config.label).to.not.equal(undefined);
    });
  });
});
