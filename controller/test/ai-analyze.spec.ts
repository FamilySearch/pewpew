import type { NextApiRequest, NextApiResponse } from "next";
import analyze, { MAX_TEST_DATA_LENGTH, truncateTestData } from "../pages/api/ai/analyze";
import { expect } from "chai";

describe("AI Analyze API", () => {
  const originalKeyName = process.env.PEWPEW_AI_API_KEY;
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;
  let responseData: any;
  let statusCode: number;

  beforeEach(() => {
    responseData = null;
    statusCode = 200;
    req = {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    };

    res = {
      status: (code: number) => {
        statusCode = code;
        return res as NextApiResponse;
      },
      json: (data: any) => {
        responseData = data;
        return res as NextApiResponse;
      },
      setHeader: () => res as NextApiResponse
    };
  });

  after(() => {
    if (originalKeyName === undefined) {
      delete process.env.PEWPEW_AI_API_KEY;
    } else {
      process.env.PEWPEW_AI_API_KEY = originalKeyName;
    }
  });

  describe("with PEWPEW_AI_API_KEY unset", () => {
    beforeEach(() => {
      delete process.env.PEWPEW_AI_API_KEY;
    });

    for (const method of ["POST", "GET"]) {
      it(`should return 404 for ${method} requests`, async () => {
        req.method = method;
        req.body = { testData: { some: "data" }, question: "What happened?" };
        await analyze(req as NextApiRequest, res as NextApiResponse);
        expect(statusCode).to.equal(404);
        expect(responseData).to.deep.equal({ error: "AI Analysis is not enabled" });
      });
    }
  });

  describe("with PEWPEW_AI_API_KEY set", () => {
    beforeEach(() => {
      process.env.PEWPEW_AI_API_KEY = "pewpew-ai-api-key";
    });

    it("should return 405 for non-POST requests", async () => {
      req.method = "GET";
      await analyze(req as NextApiRequest, res as NextApiResponse);
      expect(statusCode).to.equal(405);
      expect(responseData).to.deep.equal({
        error: "Method not allowed"
      });
    });

    it("should return 400 for missing test data", async () => {
      req.body = {};
      await analyze(req as NextApiRequest, res as NextApiResponse);
      expect(statusCode).to.equal(400);
      expect(responseData).to.deep.equal({
        error: "Missing test data"
      });
    });

    it("should return 400 for missing question in chat mode", async () => {
      req.body = {
        testData: { some: "data" },
        mode: "chat"
      };
      await analyze(req as NextApiRequest, res as NextApiResponse);
      expect(statusCode).to.equal(400);
      expect(responseData).to.deep.equal({
        error: "Missing or invalid question"
      });
    });

    it("should return 400 for an unrecognized mode", async () => {
      req.body = {
        testData: { some: "data" },
        mode: "bogus"
      };
      await analyze(req as NextApiRequest, res as NextApiResponse);
      expect(statusCode).to.equal(400);
      expect(responseData).to.deep.equal({
        error: "Invalid mode. Must be \"chat\" or \"report\""
      });
    });

    describe("chat history validation", () => {
      // Each case short-circuits before the OpenAI call, so these assert the 400 without needing a stubbed client
      const invalidHistories: [string, unknown, string][] = [
        ["a non-array history", "not an array", "History must be an array"],
        ["an unrecognized role", [{ role: "system", content: "hi" }], "Invalid history entry"],
        ["non-string content", [{ role: "user", content: 42 }], "Invalid history entry"],
        ["a null entry", [null], "Invalid history entry"],
        ["empty content", [{ role: "user", content: "   " }], "History message cannot be empty"],
        // Control characters are stripped rather than rejected, so a message of nothing else ends up empty
        ["content of only control characters", [{ role: "user", content: "\x1B\x0C" }], "History message cannot be empty"],
        [
          "a history starting with an assistant turn",
          [{ role: "assistant", content: "unprompted" }],
          "History must start with a user message and alternate roles"
        ],
        [
          "consecutive turns from the same role",
          [
            { role: "user", content: "first" },
            { role: "user", content: "second" }
          ],
          "History must start with a user message and alternate roles"
        ]
      ];

      for (const [label, history, expectedError] of invalidHistories) {
        it(`should return 400 for ${label}`, async () => {
          req.body = {
            testData: { some: "data" },
            mode: "chat",
            question: "What happened?",
            history
          };
          await analyze(req as NextApiRequest, res as NextApiResponse);
          expect(statusCode).to.equal(400);
          expect(responseData).to.deep.equal({ error: expectedError });
        });
      }
    });
  });

  describe("truncateTestData", () => {
    it("should return compact JSON unchanged when under the cap", () => {
      const data = { endpoints: [{ url: "/api/test", avg: 250 }], summary: { totalMatched: 1 } };
      expect(truncateTestData(data)).to.equal(JSON.stringify(data));
    });

    it("should cut an oversized payload at the cap and say how much was kept", () => {
      const data = { summary: { totalMatched: 1 }, endpoints: "x".repeat(2 * MAX_TEST_DATA_LENGTH) };
      const json = JSON.stringify(data);
      const result = truncateTestData(data);
      expect(result.startsWith(json.substring(0, MAX_TEST_DATA_LENGTH))).to.equal(true);
      expect(result.indexOf("\n... (data truncated")).to.equal(MAX_TEST_DATA_LENGTH);
      const keptPercent = Math.floor((MAX_TEST_DATA_LENGTH / json.length) * 100);
      expect(result).to.include(`only the first ${keptPercent}% of ${json.length} characters`);
    });
  });
});
