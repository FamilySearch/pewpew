import { LogLevel, log } from "../../src/log";
import type { Meta, StoryFn } from "@storybook/react";
import { ModalObject, useEffectModal } from "../Modal";
import React, { useRef, useState } from "react";
import { AIAnalysisModal } from ".";
import { Button } from "../LinkButton";
import type { ChatMessage } from ".";
import { Div } from "../Div";
import { GlobalStyle } from "../Layout";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the AIAnalysisModal component.
 * Source: https://storybook.js.org
 */

// Mock test data for the AI analysis
const mockTestData = {
  testId: "test123",
  metrics: {
    averageLatency: 250,
    p95Latency: 500,
    p99Latency: 750,
    throughput: 1000,
    errorRate: 0.5
  },
  timestamp: Date.now()
};

const mockAnswer = (question: string) =>
  `Based on the test data, here's the answer to "${question}":\n\n`
  + "- **Average latency**: 250ms\n- **P95 latency**: 500ms\n- **Error rate**: 0.5%";

const mockReport = `# Performance Analysis Report

## Key Findings

### Latency Metrics
- **Average Latency**: 250ms - Within acceptable range
- **P95 Latency**: 500ms - Good performance
- **P99 Latency**: 750ms - Could be optimized

### Throughput
The system is handling **1000 requests/second**, which indicates good scalability.

### Error Rate
Current error rate of **0.5%** is acceptable but could be improved.

## Recommendations

1. **Optimize P99 latency** - Investigate the slowest 1% of requests
2. **Monitor error patterns** - Set up alerts for error rate spikes
3. **Load testing** - Consider testing at higher loads to find breaking points
`;

const mockChatError = "API key not configured or invalid. Please check your OpenAI API key in the environment variables.";

const AIAnalysisModalInitialDemo = () => {
  const modalRef = useRef<ModalObject | null>(null);
  useEffectModal(modalRef, LogLevel.INFO);
  const [aiQuestion, setAiQuestion] = useState("What are the key performance insights from this test data?");

  const handleClose = () => log("Closing modal", LogLevel.INFO);

  return (
    <div id="root">
      <GlobalStyle />
      <Div>
        <Button onClick={() => modalRef.current?.openModal()}>Open AI Analysis</Button>
        <AIAnalysisModal
          modalRef={modalRef}
          isAnalyzing={false}
          hasTestData
          messages={[]}
          aiQuestion={aiQuestion}
          onQuestionChange={setAiQuestion}
          onSendMessage={() => log("send", LogLevel.INFO)}
          isGeneratingReport={false}
          onGenerateReport={() => log("generate report", LogLevel.INFO)}
          onDownloadReport={() => log("download report", LogLevel.INFO)}
          originalData={mockTestData}
          onClose={handleClose}
        />
      </Div>
    </div>
  );
};

const AIAnalysisModalInteractiveDemo = () => {
  const modalRef = useRef<ModalObject | null>(null);
  useEffectModal(modalRef, LogLevel.INFO);
  const [aiQuestion, setAiQuestion] = useState("What are the key performance insights from this test data?");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | undefined>(undefined);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [reportContent, setReportContent] = useState<string | undefined>(undefined);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const handleSendMessage = () => {
    const question = aiQuestion.trim();
    if (!question) {
      return;
    }
    log("Sending question: " + question, LogLevel.INFO);
    setChatError(undefined);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setAiQuestion("");
    setIsAnalyzing(true);
    // Simulate API call
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: mockAnswer(question) }]);
      setIsAnalyzing(false);
    }, 1000);
  };

  const handleGenerateReport = () => {
    log("Generating report", LogLevel.INFO);
    setIsGeneratingReport(true);
    setTimeout(() => {
      setReportContent(mockReport);
      setIsGeneratingReport(false);
    }, 1500);
  };

  const handleDownloadReport = () => {
    log("Downloading report", LogLevel.INFO);
    const blob = new Blob([reportContent ?? ""], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-analysis.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => log("Closing modal", LogLevel.INFO);

  return (
    <div id="root">
      <GlobalStyle />
      <Div>
        <Button onClick={() => modalRef.current?.openModal()}>Open AI Analysis (Interactive)</Button>
        <AIAnalysisModal
          modalRef={modalRef}
          isAnalyzing={isAnalyzing}
          hasTestData
          messages={messages}
          chatError={chatError}
          aiQuestion={aiQuestion}
          onQuestionChange={setAiQuestion}
          onSendMessage={handleSendMessage}
          isGeneratingReport={isGeneratingReport}
          reportContent={reportContent}
          onGenerateReport={handleGenerateReport}
          onDownloadReport={handleDownloadReport}
          originalData={mockTestData}
          onClose={handleClose}
        />
      </Div>
    </div>
  );
};

const AIAnalysisModalWithConversationDemo = () => {
  const modalRef = useRef<ModalObject | null>(null);
  useEffectModal(modalRef, LogLevel.INFO);
  const [aiQuestion, setAiQuestion] = useState("What about the p99 latency?");
  const [messages] = useState<ChatMessage[]>([
    { role: "user", content: "Can you summarize the key performance insights from this test data?" },
    { role: "assistant", content: mockAnswer("Can you summarize the key performance insights from this test data?") }
  ]);

  const handleClose = () => log("Closing modal", LogLevel.INFO);

  return (
    <div id="root">
      <GlobalStyle />
      <Div>
        <Button onClick={() => modalRef.current?.openModal()}>Open AI Analysis (With Conversation)</Button>
        <AIAnalysisModal
          modalRef={modalRef}
          isAnalyzing={false}
          hasTestData
          messages={messages}
          aiQuestion={aiQuestion}
          onQuestionChange={setAiQuestion}
          onSendMessage={() => log("send", LogLevel.INFO)}
          isGeneratingReport={false}
          reportContent={mockReport}
          onGenerateReport={() => log("generate report", LogLevel.INFO)}
          onDownloadReport={() => log("download report", LogLevel.INFO)}
          originalData={mockTestData}
          onClose={handleClose}
        />
      </Div>
    </div>
  );
};

const AIAnalysisModalErrorDemo = () => {
  const modalRef = useRef<ModalObject | null>(null);
  useEffectModal(modalRef, LogLevel.INFO);
  const [aiQuestion, setAiQuestion] = useState("What are the key performance insights from this test data?");

  const handleClose = () => log("Closing modal", LogLevel.INFO);

  return (
    <div id="root">
      <GlobalStyle />
      <Div>
        <Button onClick={() => modalRef.current?.openModal()}>Open AI Analysis (With Error)</Button>
        <AIAnalysisModal
          modalRef={modalRef}
          isAnalyzing={false}
          hasTestData
          messages={[]}
          chatError={mockChatError}
          aiQuestion={aiQuestion}
          onQuestionChange={setAiQuestion}
          onSendMessage={() => log("send", LogLevel.INFO)}
          isGeneratingReport={false}
          reportError={mockChatError}
          onGenerateReport={() => log("generate report", LogLevel.INFO)}
          onDownloadReport={() => log("download report", LogLevel.INFO)}
          originalData={mockTestData}
          onClose={handleClose}
        />
      </Div>
    </div>
  );
};

export default {
  title: "AIAnalysisModal"
} as Meta<typeof AIAnalysisModal>;

export const InitialState: StoryFn = () => (
  <AIAnalysisModalInitialDemo/>
);

export const Interactive: StoryFn = () => (
  <AIAnalysisModalInteractiveDemo/>
);

export const WithConversation: StoryFn = () => (
  <AIAnalysisModalWithConversationDemo/>
);

export const WithError: StoryFn = () => (
  <AIAnalysisModalErrorDemo/>
);
