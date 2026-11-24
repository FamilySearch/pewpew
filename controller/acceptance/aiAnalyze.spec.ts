import { LogLevel, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { API_AI_ANALYZE } from "../types";
import { expect } from "chai";
import { integrationUrl } from "./util";

// The acceptance run loads the same .env files as the server (dotenv-flow), so this matches whether the server has
// AI Analysis on. Unset, only the 404 checks run and nothing calls OpenAI.
const aiAnalysisEnabled = !!process.env.PEWPEW_AI_API_KEY;

interface AIRequest {
  testData: unknown;
  question: string;
  mode?: string;
  history?: unknown;
}

const mockTestData = {
  summaryData: {
    bucketId: { method: "GET", url: "/api/test" },
    dataPointsCount: 100,
    summaryStats: {
      stats: [
        ["Avg", 250],
        ["Min", 100],
        ["Max", 500],
        ["90th PCTL", 350],
        ["95th PCTL", 400],
        ["99th PCTL", 480]
      ],
      statusCounts: [
        ["200", 95, 0.95],
        ["500", 5, 0.05]
      ],
      otherErrors: []
    }
  },
  endpoints: [
    {
      bucketId: { method: "GET", url: "/api/endpoint1" },
      totalResults: {
        stats: [["Avg", 200], ["Max", 400]],
        statusCounts: [["200", 50]],
        otherErrors: []
      },
      metadata: { dataPointsCount: 50, hasErrors: false }
    }
  ],
  testMetadata: {
    testId: "test-123",
    s3Folder: "test/folder",
    status: "Finished",
    totalEndpoints: 1,
    hasFilterApplied: false
  }
};

function fetch (url: string, config?: AxiosRequestConfig): Promise<Response> {
  return _axios({
    method: "get",
    maxRedirects: 0,
    validateStatus: (status) => status < 500, // Resolve only if the status code is less than 500
    url,
    ...config
  });
}

(aiAnalysisEnabled ? describe.skip : describe)("AI Analysis API Disabled", () => {
  for (const method of ["get", "post"]) {
    it(`${method.toUpperCase()} /api/ai/analyze → 404 Not Found when PEWPEW_AI_API_KEY is unset`, async () => {
      const res = await fetch(integrationUrl + API_AI_ANALYZE, {
        method,
        headers: { "Content-Type": "application/json" },
        data: method === "post" ? { testData: mockTestData, question: "What happened?" } : undefined
      });
      expect(res.status).to.equal(404);
      expect(res.data).to.deep.equal({ error: "AI Analysis is not enabled" });
    });
  }
});

(aiAnalysisEnabled ? describe : describe.skip)("AI Analysis API Acceptance", function () {
  let url: string;

  before(() => {
    url = integrationUrl + API_AI_ANALYZE;
    log("AI API acceptance tests url=" + url, LogLevel.DEBUG);
  });

  it("GET /api/ai/analyze → 405 Method Not Allowed", async () => {
    const res = await fetch(url);
    expect(res.status).to.equal(405);
    expect(res.data).to.deep.equal({ error: "Method not allowed" });
  });

  const invalidRequests: [string, Partial<AIRequest>][] = [
    ["empty body", {}],
    ["missing testData", { question: "What are the insights?" }],
    ["missing question in chat mode", { testData: mockTestData, mode: "chat" }],
    ["invalid question type", { testData: mockTestData, question: 123 as any }],
    ["empty question", { testData: mockTestData, question: "   " }],
    ["too long question", { testData: mockTestData, question: "A".repeat(1001) }],
    ["control characters", { testData: mockTestData, question: "What are the insights?\x00" }],
    ["unrecognized mode", { testData: mockTestData, question: "What are the insights?", mode: "bogus" }],
    ["non-array history", { testData: mockTestData, question: "And now?", mode: "chat", history: "nope" }],
    [
      "invalid history entry",
      { testData: mockTestData, question: "And now?", mode: "chat", history: [{ role: "system", content: "hi" }] }
    ],
    [
      "history starting with an assistant turn",
      { testData: mockTestData, question: "And now?", mode: "chat", history: [{ role: "assistant", content: "hi" }] }
    ],
    [
      "history with consecutive same-role turns",
      {
        testData: mockTestData,
        question: "And now?",
        mode: "chat",
        history: [{ role: "user", content: "one" }, { role: "user", content: "two" }]
      }
    ]
  ];

  for (const [label, data] of invalidRequests) {
    it(`POST /api/ai/analyze with ${label} → 400 Bad Request`, async () => {
      const res = await fetch(url, {
        method: "post",
        headers: { "Content-Type": "application/json" },
        data
      });
      expect(res.status).to.equal(400);
    });
  }

  it("POST /api/ai/analyze with valid data → 200 OK", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        question:
          "Can you summarize the key performance insights for response times and error rates?"
      }
    });

    expect(res.status).to.equal(200);
    expect(res.data).to.have.property("choices").that.is.an("array").with.length.greaterThan(0);

    const content = res.data.choices[0].message.content.toLowerCase();
    const hasPerformanceKeywords =
      ["response", "time", "error", "average", "performance"].some((w) => content.includes(w));

    expect(hasPerformanceKeywords).to.equal(true, "Response should mention performance metrics");
    log(`AI Analysis Response: ${content.substring(0, 200)}...`, LogLevel.INFO);
  });

  // Callers that predate chat mode send { testData, question } and expect the full report back. This is the
  // regression guard for that contract -- a chat-shaped answer here means the mode default drifted.
  it("POST /api/ai/analyze with no mode → 200 OK with a report", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        question: "Focus on response times and error rates."
      }
    });

    expect(res.status).to.equal(200);
    expect(res.data).to.have.property("choices").that.is.an("array").with.length.greaterThan(0);
    const content: string = res.data.choices[0].message.content;
    expect(content).to.match(/^#{1,3}\s/m, "Report should contain markdown section headings");
    expect(content.split("\n").length).to.be.greaterThan(10, "Report should be a multi-section document");
    log(`AI default-mode Response: ${content.substring(0, 200)}...`, LogLevel.INFO);
  });

  it("POST /api/ai/analyze with mode report and no question → 200 OK", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        mode: "report"
      }
    });

    expect(res.status).to.equal(200);
    expect(res.data).to.have.property("choices").that.is.an("array").with.length.greaterThan(0);
    log("AI report mode handled a missing question successfully", LogLevel.INFO);
  });

  it("POST /api/ai/analyze in chat mode with valid history → 200 OK", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        mode: "chat",
        question: "And what about the error rate?",
        history: [
          { role: "user", content: "What was the average response time?" },
          { role: "assistant", content: "The average response time was 250ms." }
        ]
      }
    });

    expect(res.status).to.equal(200);
    expect(res.data).to.have.property("choices").that.is.an("array").with.length.greaterThan(0);
    log("AI chat mode handled conversation history successfully", LogLevel.INFO);
  });

  // Over-cap history is trimmed rather than rejected -- a client can't shorten what it already stored
  it("POST /api/ai/analyze in chat mode with over-cap history → 200 OK", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const history = Array.from({ length: 60 }, (_unused, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Turn ${index} of the conversation.`
    }));

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        mode: "chat",
        question: "Summarize what we discussed.",
        history
      }
    });

    expect(res.status).to.equal(200);
    log("AI chat mode trimmed over-cap history instead of rejecting it", LogLevel.INFO);
  });

  // An under-cap history ending on a user turn never enters the trim branch, so the dangling-turn drop has to
  // run for every history -- otherwise buildChatMessages appends the question and the model gets two user turns
  it("POST /api/ai/analyze in chat mode with an under-cap history ending on a user turn → 200 OK", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        mode: "chat",
        question: "What about the error rate?",
        history: [
          { role: "user", content: "What was the average response time?" },
          { role: "assistant", content: "The average response time was 250ms." },
          { role: "user", content: "This turn never got an answer." }
        ]
      }
    });

    expect(res.status).to.equal(200);
    log("AI chat mode dropped a dangling user turn from an under-cap history", LogLevel.INFO);
  });

  // An oversized assistant turn is truncated rather than rejected, since max_completion_tokens allows replies longer
  // than MAX_HISTORY_MESSAGE_LENGTH and the client resends them verbatim
  it("POST /api/ai/analyze in chat mode with an oversized history message → 200 OK", async function () {
    this.timeout(45000); // Allow extra time for AI processing

    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        mode: "chat",
        question: "Can you shorten that?",
        history: [
          { role: "user", content: "Give me a very long answer." },
          { role: "assistant", content: "A".repeat(5000) }
        ]
      }
    });

    expect(res.status).to.equal(200);
    log("AI chat mode truncated an oversized history message instead of rejecting it", LogLevel.INFO);
  });

  it("POST /api/ai/analyze should handle OpenAI API errors gracefully", async function () {
    this.timeout(45000); // Allow extra time for AI processing
    const res = await fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json" },
      data: {
        testData: mockTestData,
        question: "Please analyze this data in extreme detail. " + "Repeat this analysis many times. ".repeat(15)
      }
    });

    expect(res.status, "status").to.equal(200);
    log("AI API handled large request successfully", LogLevel.INFO);
  });
});
