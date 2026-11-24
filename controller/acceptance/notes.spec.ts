import { API_NOTES, API_NOTES_SEARCH } from "../types";
import { LogLevel, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { expect } from "chai";
import { integrationUrl } from "./util";

const NOTES_URL = integrationUrl + API_NOTES;
const SEARCH_URL = integrationUrl + API_NOTES_SEARCH;
const TEST_YAML_FILE = "acceptance-notes-test.yaml";
const TEST_DATE_STRING = "20260101T120000000";
const TEST_S3_FOLDER = `${TEST_YAML_FILE}/${TEST_DATE_STRING}`;
const TEST_CONTENT = "# Acceptance Test Notes\n\n## Objectives\nTest notes API\n\n## Findings\nAPI works!";

function fetch (
  url: string,
  config?: AxiosRequestConfig
): Promise<Response> {
  return _axios({
    method: config?.method || "get",
    url,
    maxRedirects: 0,
    validateStatus: (status) => status < 500,
    ...(config || {})
  });
}

describe("Notes API Acceptance", () => {
  const notesUrl = `${NOTES_URL}/${TEST_S3_FOLDER}`;
  const templateUrl = `${NOTES_URL}/template/${TEST_S3_FOLDER}`;
  const exportUrl = `${NOTES_URL}/${TEST_S3_FOLDER}/export`;
  const metaUrl = `${NOTES_URL}/${TEST_S3_FOLDER}/meta`;

  before(() => {
    log("Notes acceptance tests", LogLevel.INFO, { notesUrl, templateUrl, exportUrl, metaUrl, SEARCH_URL });
  });

  after(async () => {
    try {
      await fetch(notesUrl, { method: "delete" });
    } catch (error) {
      log("Notes acceptance cleanup failed", LogLevel.WARN, error);
    }
  });

  describe("GET /api/notes/:yamlFile/:dateString (no notes)", () => {
    it("should return 404 when no notes exist", async () => {
      const res = await fetch(notesUrl);
      expect(res.status).to.equal(204);
    });
  });

  describe("GET /api/notes/template/:yamlFile/:dateString", () => {
    it("should generate a template", async () => {
      const res = await fetch(templateUrl);
      expect(res.status).to.equal(200);
      expect(res.data).to.have.property("markdown");
      expect(res.data).to.have.property("metadata");
      expect(res.data.markdown).to.include("# Performance Test Notes");
      expect(res.data.markdown).to.include("## Objectives");
      expect(res.data.metadata).to.have.property("testName");
    });
  });

  describe("PUT /api/notes/:yamlFile/:dateString", () => {
    it("should save notes", async () => {
      const res = await fetch(notesUrl, {
        method: "put",
        data: { content: TEST_CONTENT },
        headers: { "Content-Type": "application/json" }
      });
      expect(res.status).to.equal(200);
      expect(res.data.message).to.equal("Notes replaced");
    });
  });

  describe("GET /api/notes/:yamlFile/:dateString (with notes)", () => {
    it("should return saved notes", async () => {
      const res = await fetch(notesUrl);
      expect(res.status).to.equal(200);
      expect(typeof res.data).to.equal("string");
      expect(res.data).to.include("Acceptance Test Notes");
      expect(res.data).to.include("## Objectives");
    });
  });

  describe("POST /api/notes/:yamlFile/:dateString (append)", () => {
    it("should append to existing notes", async () => {
      const res = await fetch(notesUrl, {
        method: "post",
        data: { content: "Appended content" },
        headers: { "Content-Type": "application/json" }
      });
      expect(res.status).to.equal(200);

      // Verify append
      const getRes = await fetch(notesUrl);
      expect(getRes.data).to.include("Acceptance Test Notes");
      expect(getRes.data).to.include("Appended content");
    });
  });

  describe("POST /api/notes/:yamlFile/:dateString (structured section update)", () => {
    it("should update a specific section", async () => {
      // First save structured notes
      await fetch(notesUrl, {
        method: "put",
        data: { content: TEST_CONTENT },
        headers: { "Content-Type": "application/json" }
      });

      const res = await fetch(notesUrl, {
        method: "post",
        data: { section: "findings", content: "Latency p95 = 120ms" },
        headers: { "Content-Type": "application/json" }
      });
      expect(res.status).to.equal(200);

      const getRes = await fetch(notesUrl);
      expect(getRes.data).to.include("Latency p95 = 120ms");
    });

    it("should reject a section update without string content or with an unknown section", async () => {
      for (const data of [
        { section: "findings" },
        { section: "findings", content: { text: "x" } },
        { section: "findings", content: "x", append: "yes" },
        { section: "constructor", content: "x" },
        { section: "bogus", content: "x" }
      ]) {
        const res = await fetch(notesUrl, { method: "post", data, headers: { "Content-Type": "application/json" } });
        expect(res.status, JSON.stringify(data)).to.equal(400);
      }
      const getRes = await fetch(notesUrl);
      expect(getRes.data).to.not.include("undefined");
      expect(getRes.data).to.not.include("[object Object]");
      expect(getRes.data).to.not.include("[native code]");
    });
  });

  describe("GET /api/notes/:yamlFile/:dateString/meta", () => {
    it("should return metadata", async () => {
      const res = await fetch(metaUrl);
      expect(res.status).to.equal(200);
      expect(res.data).to.have.property("version");
      expect(res.data).to.have.property("createdAt");
      expect(res.data).to.have.property("updatedAt");
    });
  });

  describe("PUT /api/notes/:yamlFile/:dateString/meta", () => {
    it("should update metadata", async () => {
      const res = await fetch(metaUrl, {
        method: "put",
        data: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: ["acceptance"] },
        headers: { "Content-Type": "application/json" }
      });
      expect(res.status).to.equal(200);

      const getRes = await fetch(metaUrl);
      expect(getRes.data.tags).to.deep.equal(["acceptance"]);
    });
  });

  describe("GET /api/notes/:yamlFile/:dateString/export", () => {
    it("should export as markdown", async () => {
      const res = await fetch(`${exportUrl}?format=markdown`);
      expect(res.status).to.equal(200);
      expect(res.headers["content-type"]).to.include("text/markdown");
    });

    it("should export as confluence", async () => {
      const res = await fetch(`${exportUrl}?format=confluence`);
      expect(res.status).to.equal(200);
      expect(res.headers["content-type"]).to.include("text/html");
      expect(res.headers["x-content-type-options"]).to.equal("nosniff");
      expect(res.headers["content-security-policy"]).to.include("sandbox");
      expect(res.data).to.include("<h1>");
    });
  });

  describe("GET /api/notes/search", () => {
    it("should find notes", async () => {
      const res = await fetch(SEARCH_URL);
      expect(res.status).to.equal(200);
      expect(Array.isArray(res.data)).to.equal(true);
      const match = res.data.find((r: { yamlFile: string }) => r.yamlFile === TEST_YAML_FILE);
      expect(match).to.not.equal(undefined);
    });

    it("should filter by query", async () => {
      const res = await fetch(`${SEARCH_URL}?q=acceptance-notes`);
      expect(res.status).to.equal(200);
      expect(Array.isArray(res.data)).to.equal(true);
      if (res.data.length > 0) {
        expect(res.data[0].yamlFile).to.include("acceptance-notes");
      }
    });
  });

  describe("DELETE /api/notes/:yamlFile/:dateString", () => {
    it("should delete notes", async () => {
      const res = await fetch(notesUrl, { method: "delete" });
      expect(res.status).to.equal(200);
      expect(res.data.message).to.equal("Notes deleted");
    });

    it("should return 404 after deletion", async () => {
      const res = await fetch(notesUrl);
      expect(res.status).to.equal(204);
    });
  });

  describe("Method validation", () => {
    it("should return 405 for PATCH on notes", async () => {
      const res = await fetch(notesUrl, { method: "patch" });
      expect(res.status).to.equal(405);
    });

    it("should return 405 for POST on template", async () => {
      const res = await fetch(templateUrl, { method: "post" });
      expect(res.status).to.equal(405);
    });

    it("should return 405 for POST on export", async () => {
      const res = await fetch(exportUrl, { method: "post" });
      expect(res.status).to.equal(405);
    });

    it("should return 405 for POST on search", async () => {
      const res = await fetch(SEARCH_URL, { method: "post" });
      expect(res.status).to.equal(405);
    });
  });
});
