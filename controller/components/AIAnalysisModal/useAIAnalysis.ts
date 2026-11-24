import type { AIAnalysisModalProps, ChatMessage } from ".";
import { LogLevel, log } from "../../src/log";
import { ModalObject, useEffectModal } from "../Modal";
import { formatError, formatPageHref } from "../../src/clientutil";
import { useRef, useState } from "react";
import { API_AI_ANALYZE } from "../../types";
import axios from "axios";

// This file must not import the modal itself (only its types): callers load the modal with next/dynamic so
// deployments without AI Analysis never download react-markdown.

/**
 * Whether this build shows the AI Analysis UI. Set at build time from PEWPEW_AI_API_KEY via next.config.ts `env`.
 * Read as a literal `process.env.AI_ANALYSIS_ENABLED` so Next inlines it into the client bundle.
 */
export const isAIAnalysisEnabled = (): boolean => process.env.AI_ANALYSIS_ENABLED === "true";

export interface AIReportDownload {
  /** First line of the downloaded file */
  title: string;
  /** Lines after "Generated: ...", e.g. "Test: ..." */
  details: string[];
  /** File name before the timestamp, already safe for a file name */
  fileNamePrefix: string;
}

export interface UseAIAnalysisOptions {
  /** Builds the payload sent to the AI from what's on screen, or null when there's nothing to analyze. May throw. */
  buildPayload: () => unknown;
  /** Question pre-filled in the chat box */
  defaultQuestion: string;
  /** Optional focus sent with every report request */
  reportQuestion?: string;
  /** Header and file name for the downloaded report */
  getReportDownload: () => AIReportDownload;
}

export interface UseAIAnalysisResult {
  /** Snapshots the payload and opens the modal */
  openAnalysis: () => void;
  /** Why the last openAnalysis didn't open the modal, for the caller to show next to its button */
  openError: string | undefined;
  /** Spread onto AIAnalysisModal */
  modalProps: AIAnalysisModalProps;
}

const extractErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : `${error || "Unknown error"}`;

/** The chat/report state and requests behind one AI Analysis button and its modal */
export function useAIAnalysis ({
  buildPayload,
  defaultQuestion,
  reportQuestion,
  getReportDownload
}: UseAIAnalysisOptions): UseAIAnalysisResult {
  // The data snapshot the chat/report are analyzing. Preserved across modal re-opens only while the payload is
  // identical; when it changes (different results, filter, or merge) the chat/report are cleared, since they describe
  // numbers that are no longer on screen. Enforced in openAnalysis via dataKeyRef.
  const [originalData, setOriginalData] = useState<unknown>(null);
  const [aiQuestion, setAiQuestion] = useState(defaultQuestion);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | undefined>(undefined);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [reportContent, setReportContent] = useState<string | undefined>(undefined);
  const [reportError, setReportError] = useState<string | undefined>(undefined);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [openError, setOpenError] = useState<string | undefined>(undefined);
  // Identity of the payload the current chat/report were built on, so a changed snapshot can be detected
  const dataKeyRef = useRef<string | undefined>(undefined);
  // Bumped when a changed snapshot starts a new session, so the modal can reset its view even if nothing was cleared
  const [sessionKey, setSessionKey] = useState(0);
  const modalRef = useRef<ModalObject | null>(null);
  // Tracks an in-flight request for onClose. Written at the request boundaries rather than during render, so it's
  // already true before the state update commits and still true when the setTimeout callback runs.
  const isBusyRef = useRef(false);
  useEffectModal(modalRef);

  const openAnalysis = () => {
    let payload: unknown;
    try {
      payload = buildPayload();
    } catch (error) {
      log("Error generating AI payload", LogLevel.ERROR, error);
      setOpenError(`Could not prepare the data for AI Analysis: ${formatError(error)}`);
      return;
    }
    if (!payload) {
      log("No AI payload generated", LogLevel.INFO);
      setOpenError("There is no data to analyze yet.");
      return;
    }
    if (!modalRef.current) {
      // The modal is loaded with next/dynamic, so its ref is null until that chunk arrives (or if it failed to load)
      log("AI Analysis modal is not loaded yet", LogLevel.WARN);
      setOpenError("AI Analysis is still loading. Please try again in a moment.");
      return;
    }
    setOpenError(undefined);
    if (!aiQuestion.trim()) {
      setAiQuestion(defaultQuestion);
    }
    // The timestamp is excluded because it changes on every generation and says nothing about the data
    const dataKey = JSON.stringify({ ...(payload as object), timestamp: undefined });
    if (dataKeyRef.current !== undefined && dataKeyRef.current !== dataKey) {
      log("AI payload changed, clearing prior chat and report", LogLevel.INFO);
      setMessages([]);
      setChatError(undefined);
      setReportContent(undefined);
      setReportError(undefined);
      setSessionKey((key) => key + 1);
    }
    dataKeyRef.current = dataKey;
    setOriginalData(payload);
    modalRef.current.openModal();
  };

  // Prevents closing while a request is in flight by reopening on the next tick
  const onClose = () => {
    if (isBusyRef.current) {
      setTimeout(() => {
        if (modalRef.current && isBusyRef.current) {
          modalRef.current.openModal();
        }
      }, 0);
    }
  };

  // Posts to the endpoint and returns the reply text, or undefined when the snapshot changed while it was in flight
  const requestAnalysis = async (body: Record<string, unknown>, keyAtSend: string | undefined): Promise<string | undefined> => {
    const response = await axios.post(formatPageHref(API_AI_ANALYZE), { testData: originalData, ...body }, {
      headers: { "Content-Type": "application/json" }
    });
    if (dataKeyRef.current !== keyAtSend) {
      // Appending now would attach the answer to data it isn't about, and would land on a transcript the reset
      // already cleared -- leaving it assistant-first, which the endpoint rejects on every later turn
      log("Discarding AI response for a superseded data snapshot", LogLevel.INFO);
      return undefined;
    }
    return response.data?.choices?.[0]?.message?.content ?? "";
  };

  // Send the current question to the chat, continuing the existing conversation with prior turns as context
  const onSendMessage = async () => {
    const question = aiQuestion.trim();
    if (!originalData || !question) {
      return;
    }
    const historyForRequest = messages; // history up to (not including) this new question
    const keyAtSend = dataKeyRef.current; // the snapshot this turn belongs to
    // Drop the optimistic user turn so the transcript keeps alternating, and give the question back unless the user
    // has already typed something new into the box
    const rollBack = (error: string) => {
      setMessages(historyForRequest);
      setAiQuestion((current) => current.trim() ? current : question);
      setChatError(error);
    };
    isBusyRef.current = true;
    setIsAnalyzing(true);
    setChatError(undefined);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setAiQuestion("");
    try {
      const content = await requestAnalysis({ question, mode: "chat", history: historyForRequest }, keyAtSend);
      if (content === undefined) {
        return;
      }
      if (!content.trim()) {
        // Storing an empty turn would render a blank bubble and then fail validation on every later request,
        // since the transcript is resent as history
        log("AI analysis returned an empty completion", LogLevel.WARN);
        rollBack("The AI returned an empty response. Please try again.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    } catch (aiError) {
      log("Error calling AI analysis API", LogLevel.ERROR, aiError);
      if (dataKeyRef.current !== keyAtSend) {
        return; // superseded snapshot -- rolling back would resurrect a transcript for data that's gone
      }
      rollBack(`Failed to get AI analysis: ${extractErrorMessage(aiError)}`);
    } finally {
      isBusyRef.current = false;
      setIsAnalyzing(false);
    }
  };

  // Generate the full structured report. Independent of the chat -- not affected by the question in the chat box.
  const onGenerateReport = async () => {
    if (!originalData) {
      return;
    }
    const keyAtSend = dataKeyRef.current; // the snapshot this report belongs to
    isBusyRef.current = true;
    setIsGeneratingReport(true);
    setReportError(undefined);
    try {
      const content = await requestAnalysis({ mode: "report", question: reportQuestion }, keyAtSend);
      if (content === undefined) {
        return;
      }
      if (!content.trim()) {
        // An empty report would leave the panel unchanged and the download disabled, with nothing explaining why
        log("AI report generation returned empty content", LogLevel.WARN);
        setReportError("The AI returned an empty report. Please try again.");
        return;
      }
      setReportContent(content);
    } catch (aiError) {
      log("Error calling AI analysis API", LogLevel.ERROR, aiError);
      if (dataKeyRef.current !== keyAtSend) {
        return; // superseded snapshot
      }
      setReportError(`Failed to generate report: ${extractErrorMessage(aiError)}`);
    } finally {
      isBusyRef.current = false;
      setIsGeneratingReport(false);
    }
  };

  // Download the generated report as a markdown file
  const onDownloadReport = () => {
    if (!reportContent) {
      log("No report content to download", LogLevel.INFO);
      return;
    }
    const { title, details, fileNamePrefix } = getReportDownload();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileContent = [
      title,
      `Generated: ${new Date().toLocaleString()}`,
      ...details,
      "",
      reportContent,
      "",
      "---",
      "Generated by PaaS Performance Testing Controller",
      ""
    ].join("\n");

    const blob = new Blob([fileContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileNamePrefix}-${timestamp}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return {
    openAnalysis,
    openError,
    modalProps: {
      modalRef,
      isAnalyzing,
      hasTestData: originalData !== null,
      messages,
      chatError,
      aiQuestion,
      onQuestionChange: setAiQuestion,
      onSendMessage,
      isGeneratingReport,
      reportContent,
      reportError,
      onGenerateReport,
      onDownloadReport,
      originalData: originalData ?? undefined,
      sessionKey,
      onClose
    }
  };
}
