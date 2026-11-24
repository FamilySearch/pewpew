import { AuthPermission, AuthPermissions } from "../../../types";
import { LogLevel, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { getAIApiKeyName, getKey, isAIAnalysisEnabled } from "../../../src/secrets";
import { authApi } from "../../../src/authserver";
import { createErrorResponse } from "../../../src/util";

type AIMode = "chat" | "report";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AIRequest {
  testData: unknown; // The performance test data to analyze
  question?: string; // The user's question. Required for "chat" mode, optional focus for "report" mode
  // "report" (default): generate the full breakdown report -- the pre-existing behavior callers of this endpoint
  // already depend on. "chat": answer the question directly, and must be requested explicitly.
  mode?: AIMode;
  history?: ChatMessage[]; // Prior turns in the conversation. Only used in "chat" mode
}

interface AIResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX: RegExp = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_LENGTH = 40; // 20 back-and-forth turns

// This endpoint is consumed by multiple apps, each of which may pass a differently-shaped payload -- raw load
// test results, a curated Lighthouse/Core Web Vitals dashboard summary, synthetic monitoring output, etc. The
// prompts below are intentionally source-agnostic: they never assume a fixed schema, and instead instruct the
// model to read whatever JSON it's given and work out what it represents.
const CHAT_SYSTEM_PROMPT = "You are a helpful Performance Analysis Assistant. You will be given JSON performance " +
  "data whose source and shape can vary widely -- it might be load/stress test results, a Lighthouse or Core Web " +
  "Vitals summary, a synthetic monitoring report, or some other custom performance snapshot. Read the JSON as " +
  "given and work out what metrics it actually contains; don't assume a fixed schema (e.g. don't assume there's " +
  "a response-time or error-rate field just because that's common in load tests -- there might instead be " +
  "category scores, flagged issues, or something else entirely). Answer the user's question directly and " +
  "specifically, grounding your answer in whatever the data actually contains. Keep your response focused on " +
  "what was actually asked -- do not produce a full generic performance report unless the user explicitly asks " +
  "for one. If earlier turns are included, use them as context for follow-up questions. If the data doesn't " +
  "contain enough information to answer confidently, say so plainly rather than guessing.";

const REPORT_SYSTEM_PROMPT = "You are a Performance Analysis Engineer. You analyze performance-related JSON data " +
  "from a wide variety of sources -- load/stress test results, Lighthouse/Core Web Vitals audits, synthetic " +
  "monitoring summaries, or other custom performance snapshots -- and produce concise, data-driven reports " +
  "focused on system or page health and efficiency. You always adapt your analysis to whatever metrics are " +
  "actually present in the data rather than assuming a fixed schema.";

// Prepare data preview (limit to avoid token limits)
function truncateTestData (testData: unknown): string {
  const dataPreview = JSON.stringify(testData, null, 2);
  const maxLength = 8000; // Limit data size to avoid token issues
  return dataPreview.length > maxLength
    ? dataPreview.substring(0, maxLength) + "\n... (data truncated due to size)"
    : dataPreview;
}

function buildChatMessages (truncatedData: string, question: string, history: ChatMessage[]) {
  return [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    {
      role: "user",
      content: "Here is the performance data to analyze. Its shape may vary depending on where it came from (a "
        + "load test, a Lighthouse/Core Web Vitals audit, a monitoring dashboard, or something else) -- read the "
        + `JSON structure itself to determine what it represents:\n${truncatedData}\n\nAnswer questions about `
        + "this data as they come. Be direct and concise, and cite specific values from the data when relevant."
    },
    ...history,
    { role: "user", content: question }
  ];
}

function buildReportMessages (truncatedData: string, focus?: string) {
  const focusSection = focus
    ? `\nThe user has asked you to pay particular attention to the following when writing the report:\n${focus}\n`
    : "";
  const prompt = `
Here is the performance data to analyze. Its shape may vary depending on where it came from (a load test, a
Lighthouse/Core Web Vitals audit, a monitoring dashboard, or some other performance snapshot) -- read the JSON
structure itself to determine what it represents and which metrics it actually contains:
${truncatedData}
${focusSection}
Objective:
  Provide a comprehensive performance analysis report based on the data above.

  Please provide a detailed analysis that includes:
  1. Briefly identify what kind of performance data this is, based on its structure.
  2. Key findings — trends, spikes, regressions, low scores, or anomalies in whichever metrics are present.
  3. Identification of any performance issues, bottlenecks, or flagged problems.
  4. A summary of overall health, grounded only in the metrics the data actually provides (for example: response
     times, error rates, and bottlenecks for a load test; or category scores and flagged issues for a
     Lighthouse-style report).
  5. Suggest what should be investigated next to improve performance or quality.
  6. Provide recommendations for improvement.
  7. Present your results as an executive-style summary followed by a technical deep dive.
  8. Format your response in clear, readable markdown with sections and bullet points where appropriate.
  9. An overall assessment.

  Begin with a technical summary highlighting the top 3–5 insights.
  Use tables or bullet points for metrics if helpful.
  Suggest what would be useful to visualize or monitor going forward, appropriate to the kind of data provided.
  Base your analysis purely on the data I provide; do not assume a metric exists just because it's common for
  other kinds of performance data -- only reference what's actually present.
  If the data seems incomplete or inconsistent, note where and why.
`;

  return [
    { role: "system", content: REPORT_SYSTEM_PROMPT },
    { role: "user", content: prompt }
  ];
}

// Function to analyze arbitrary performance data using OpenAI. In "chat" mode it answers the specific question conversationally
// (optionally continuing a prior conversation). In "report" mode it produces the full structured breakdown report.
async function analyzeLoadTestData (
  testData: unknown,
  mode: AIMode,
  question: string | undefined,
  history: ChatMessage[]
): Promise<AIResponse> {
  try {
    // Dynamically import OpenAI and initialize client inside the function
    const OpenAI = (await import("openai")).default;
    // Try to get API key from AWS Secrets Manager first (for deployed instances)
    // Fall back to environment variable for local development
    const apiKeyName = getAIApiKeyName();
    if (!apiKeyName) {
      throw new Error("PEWPEW_AI_API_KEY is not set"); // The handler returns 404 before reaching here
    }
    const apiKey = await getKey(apiKeyName);
    if (!apiKey) {
      throw new Error("OpenAI API key not found. Check your Secret Manager provider configuration.");
    }
    const openai = new OpenAI({
      apiKey
    });
    const truncatedData = truncateTestData(testData);

    const messages = mode === "report"
      ? buildReportMessages(truncatedData, question)
      : buildChatMessages(truncatedData, question as string, history);

    log(`Sending ${mode} request to OpenAI`, LogLevel.DEBUG, {
      mode,
      messageCount: messages.length,
      dataSize: truncatedData.length
    });

    const completion = await openai.chat.completions.create({
      // gpt-4o-mini retires on 2027-01-14; gpt-6-luna is OpenAI's listed replacement
      model: "gpt-6-luna",
      // gpt-6-luna reasons by default (medium), and reasoning tokens count against max_completion_tokens. Disabling
      // it keeps the full token budget for the visible reply, matching the old non-reasoning gpt-4o-mini behavior.
      // eslint-disable-next-line camelcase
      reasoning_effort: "none",
      // The OpenAI SDK's message param type is a per-role discriminated union; since we build this array
      // dynamically (mixing system/user prompt text with stored conversation history) rather than as inline
      // literals, TS can't narrow each entry's role, so it's cast here rather than fought at the call site.
      messages: messages as any,
      // A reply here can exceed MAX_HISTORY_MESSAGE_LENGTH, and the client resends it verbatim as history on the
      // next turn. That's why oversized history messages are truncated rather than rejected -- see the handler.
      // eslint-disable-next-line camelcase
      max_completion_tokens: 2000
    });

    log("OpenAI response received", LogLevel.DEBUG, {
      tokensUsed: completion.usage?.total_tokens
    });

    return completion as AIResponse;
  } catch (error) {
    log("Error in analyzeLoadTestData", LogLevel.ERROR, error);
    throw error;
  }
}

// Validates a free-text field (question, or a single history message). Returns an error string, or undefined if ok.
// Omit maxLength to skip the length check -- history messages are truncated instead of rejected, see below.
function validateText (label: string, text: string, maxLength?: number): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return `${label} cannot be empty`;
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    return `${label} too long (max ${maxLength} characters)`;
  }
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    return `${label} contains invalid control characters`;
  }
  return undefined;
}

// max_completion_tokens allows a reply roughly twice MAX_HISTORY_MESSAGE_LENGTH, and the client resends it verbatim on the
// next turn. Rejecting it would permanently dead-end the conversation, since the client can't edit what it stored.
function truncateHistoryMessage (content: string): string {
  return content.length > MAX_HISTORY_MESSAGE_LENGTH
    ? content.substring(0, MAX_HISTORY_MESSAGE_LENGTH) + "\n... (truncated)"
    : content;
}

export default async function handler (req: NextApiRequest, res: NextApiResponse) {
  try {
    // Off unless PEWPEW_AI_API_KEY is configured. 404 rather than 403, so a deployment without it has no AI endpoint
    if (!isAIAnalysisEnabled()) {
      return res.status(404).json({ error: "AI Analysis is not enabled" });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Check authentication
    const authPermissions: AuthPermissions | undefined = await authApi(req, res, AuthPermission.ReadOnly);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }

    const { testData, question, mode: requestedMode, history: requestedHistory }: AIRequest = req.body ?? {};
    const ipAddress = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    log(`${req.method} ${req.url} received`, LogLevel.INFO, {
      userId: authPermissions.userId,
      ipAddress,
      userAgent: req.headers["user-agent"],
      referer: req.headers["referer"],
      mode: requestedMode,
      question: typeof question === "string" ? question.slice(0, 100) : undefined
    });

    if (!testData) {
      return res.status(400).json({ error: "Missing test data" });
    }

    if (requestedMode !== undefined && requestedMode !== "chat" && requestedMode !== "report") {
      return res.status(400).json({ error: "Invalid mode. Must be \"chat\" or \"report\"" });
    }
    // Default to "report" rather than "chat": this endpoint is consumed by other apps that predate chat mode and
    // send { testData, question } expecting the full breakdown. Chat callers opt in with an explicit mode.
    const mode: AIMode = requestedMode ?? "report";

    // The question is required for chat mode. For report mode it's optional (an extra focus area for the report)
    if (mode === "chat" && (!question || typeof question !== "string")) {
      return res.status(400).json({ error: "Missing or invalid question" });
    }
    if (question !== undefined) {
      if (typeof question !== "string") {
        return res.status(400).json({ error: "Missing or invalid question" });
      }
      const questionError = validateText("Question", question, MAX_QUESTION_LENGTH);
      if (questionError) {
        return res.status(400).json({ error: questionError });
      }
    }

    let history: ChatMessage[] = [];
    if (mode === "chat" && requestedHistory !== undefined) {
      if (!Array.isArray(requestedHistory)) {
        return res.status(400).json({ error: "History must be an array" });
      }
      // A conversation outgrowing the cap is a normal state, not a client error. Drop the oldest turns instead of
      // rejecting, which would dead-end a chat the client has no way to trim on its own.
      let boundedHistory: ChatMessage[] = requestedHistory;
      if (boundedHistory.length > MAX_HISTORY_LENGTH) {
        boundedHistory = boundedHistory.slice(-MAX_HISTORY_LENGTH);
        // Keep the user-first boundary the alternation check below requires
        if (boundedHistory[0]?.role === "assistant") {
          boundedHistory = boundedHistory.slice(1);
        }
        log("Conversation history exceeded the cap and was trimmed", LogLevel.DEBUG, {
          requestedLength: requestedHistory.length,
          trimmedLength: boundedHistory.length
        });
      }
      for (const message of boundedHistory) {
        if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") {
          return res.status(400).json({ error: "Invalid history entry" });
        }
        // Length is handled by truncation below; an empty or control-character message is still a malformed client
        const historyError = validateText("History message", message.content);
        if (historyError) {
          return res.status(400).json({ error: historyError });
        }
      }
      // The transcript must start with a user turn and alternate. Anything else is malformed -- and since history
      // arrives from the client, it's also how a caller could fabricate assistant turns to steer the model.
      for (let index = 0; index < boundedHistory.length; index++) {
        const expectedRole = index % 2 === 0 ? "user" : "assistant";
        if (boundedHistory[index].role !== expectedRole) {
          return res.status(400).json({ error: "History must start with a user message and alternate roles" });
        }
      }
      // Drop a dangling user turn -- a question whose answer never arrived. Applies to every history, not just a
      // trimmed one, since buildChatMessages appends the new question right after this array and would otherwise
      // hand the model two consecutive user turns. The alternation check can't catch that on its own: an
      // odd-length history ends on an even index, where a user turn is exactly what it expects.
      // Must run *after* that check, or a malformed [user, user] would be sliced down to a passing [user].
      if (boundedHistory[boundedHistory.length - 1]?.role === "user") {
        boundedHistory = boundedHistory.slice(0, -1);
      }
      history = boundedHistory.map(({ role, content }) => ({ role, content: truncateHistoryMessage(content.trim()) }));
    }

    const trimmedQuestion = typeof question === "string" ? question.trim() : undefined;
    log("Processing AI analysis request", LogLevel.DEBUG, {
      mode,
      questionLength: trimmedQuestion?.length,
      historyLength: history.length,
      hasTestData: !!testData
    });
    const aiResponse = await analyzeLoadTestData(testData, mode, trimmedQuestion, history);
    log("AI analysis completed successfully", LogLevel.DEBUG, aiResponse);
    log(`${req.method} ${req.url} completed`, LogLevel.INFO, {
      userId: authPermissions.userId,
      ipAddress,
      status: 200,
      mode,
      model: aiResponse.model,
      tokensUsed: aiResponse.usage?.total_tokens
    });
    res.status(200).json(aiResponse);
  } catch (error) {
    const errorResponse = createErrorResponse(req, error, LogLevel.ERROR);
    res.status(500).json(errorResponse);
  }
}
