import { Button, defaultButtonTheme } from "../LinkButton";
import { Modal, ModalObject } from "../Modal";
import type { Components } from "react-markdown";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIAnalysisModalProps {
  modalRef: React.RefObject<ModalObject | null>;
  // Chat: ask direct questions about the test data and get a direct answer
  isAnalyzing: boolean;
  hasTestData: boolean;
  messages: ChatMessage[];
  chatError?: string;
  aiQuestion: string;
  onQuestionChange: (question: string) => void;
  onSendMessage: () => void;
  // Report: generate/download the full structured breakdown, independent of the chat
  isGeneratingReport: boolean;
  reportContent?: string;
  reportError?: string;
  onGenerateReport: () => void;
  onDownloadReport: () => void;
  // Raw data, shown collapsed for reference
  originalData?: unknown;
  // Changes whenever the parent starts a new session for a different data snapshot, sending the modal back to Chat.
  // A prop rather than something inferred from the others, since an already-empty session is cleared to the same values.
  sessionKey?: number;
  onClose: () => void;
}

type AIView = "chat" | "report";

const VIEWS: { id: AIView; title: string; description: string }[] = [
  { id: "chat", title: "💬 Chat", description: "Ask questions about these performance metrics" },
  { id: "report", title: "📄 Full report", description: "Generate a full report with findings, bottlenecks, and recommendations" }
];

// Announced when a mode fails while the other view is open
const FAILURE_TEXT: Record<AIView, string> = {
  chat: "Chat failed. Switch to Chat to see the error.",
  report: "Report generation failed. Switch to Full report to see the error."
};

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0
};

const actionTheme = (buttonWidth: string) => ({
  ...defaultButtonTheme,
  buttonWidth,
  buttonHeight: "60px",
  buttonFontSize: "15px"
});

// Reports lean on tables and headings, which render unstyled and cramped by default
const cellStyle: React.CSSProperties = {
  border: "1px solid rgba(120, 120, 120, 0.5)",
  padding: "6px 10px",
  textAlign: "left",
  verticalAlign: "top"
};
// Exported for the spec, which mocks react-markdown everywhere else
export const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => (
    <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }} {...props} />
    </div>
  ),
  // Column alignment (:---:, ---:) arrives as style.textAlign; merge it, since a plain spread would replace the cell styling
  th: ({ node: _node, style, ...props }) => <th {...props} style={{ ...cellStyle, background: "rgba(70, 70, 70, 0.8)", ...style }} />,
  td: ({ node: _node, style, ...props }) => <td {...props} style={{ ...cellStyle, ...style }} />,
  pre: ({ node: _node, ...props }) => (
    <pre style={{
      background: "rgba(30, 30, 30, 0.8)",
      padding: "1rem",
      borderRadius: "5px",
      color: "rgb(200, 200, 200)",
      overflow: "auto",
      marginBottom: "1rem"
    }} {...props} />
  )
};

const Markdown: React.FC<{ children: string }> = ({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{children}</ReactMarkdown>
);

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div role="alert" style={{
    background: "rgba(60, 30, 30, 0.8)",
    border: "2px solid #f44336",
    borderRadius: "8px",
    padding: "1rem",
    marginBottom: "0.75rem",
    color: "#ff7777",
    textAlign: "left"
  }}>
    <strong>❌ Error:</strong> {message}
  </div>
);

// One chat bubble. User questions are right-aligned, assistant answers left-aligned, matching common chat UIs.
const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: "0.75rem" }}>
      <div style={{
        maxWidth: "85%",
        background: isUser ? "rgba(33, 150, 243, 0.15)" : "rgba(51, 51, 51, 0.8)",
        border: isUser ? "1px solid #2196f3" : "1px solid rgba(100, 100, 100, 0.4)",
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        color: "rgb(210, 210, 210)",
        textAlign: "left"
      }}>
        <div style={{ fontSize: "12px", fontWeight: "bold", color: "rgb(150, 150, 150)", marginBottom: "0.25rem" }}>
          {isUser ? "You" : "🤖 AI"}
        </div>
        {isUser
          ? <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
          : <Markdown>{message.content}</Markdown>}
      </div>
    </div>
  );
};

const renderChat = (messages: ChatMessage[], chatError: string | undefined, hasTestData: boolean): React.JSX.Element => {
  if (messages.length === 0 && !chatError) {
    return (
      <p style={{ color: "rgb(150, 150, 150)" }}>
        {hasTestData ? "Ask a question below to get started." : "Preparing test data..."}
      </p>
    );
  }
  return (
    <div>
      {messages.map((message, index) => (
        <ChatBubble key={index} message={message} />
      ))}
      {chatError && <ErrorBox message={chatError} />}
    </div>
  );
};

export const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({
  modalRef,
  isAnalyzing,
  hasTestData,
  messages,
  chatError,
  aiQuestion,
  onQuestionChange,
  onSendMessage,
  isGeneratingReport,
  reportContent,
  reportError,
  onGenerateReport,
  onDownloadReport,
  originalData,
  sessionKey = 0,
  onClose
}) => {
  // Both requests hit the same endpoint, so any in-flight one disables the other's trigger. This also keeps
  // isAnalyzing and isGeneratingReport mutually exclusive, which the title and banner below rely on.
  const isBusy = isAnalyzing || isGeneratingReport;
  const sendDisabled = isBusy || !hasTestData || !aiQuestion.trim();
  const reportDisabled = isBusy || !hasTestData;
  const inProgress: Record<AIView, boolean> = { chat: isAnalyzing, report: isGeneratingReport };
  // A mode's error only shows inside its own view, so flag it on the card when the other view is open
  const hasError: Record<AIView, boolean> = { chat: !!chatError, report: !!reportError };

  const [view, setView] = React.useState<AIView>("chat");
  // TestResultsCompare mounts its own modal next to TestResults', so the tab/panel ids have to be unique per instance
  const baseId = React.useId();
  const tabId = (id: AIView) => `${baseId}-tab-${id}`;
  const panelId = (id: AIView) => `${baseId}-panel-${id}`;
  const tabRefs = React.useRef<Record<AIView, HTMLButtonElement | null>>({ chat: null, report: null });
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);
  // The report text last brought into view, so revisiting the same report doesn't jump the scroll again
  const scrolledReportRef = React.useRef("");

  // A new session for different data goes back to Chat, where the default question is waiting, rather than reopening
  // on an empty report. Layout effect so the reopened modal never paints the old view first.
  React.useLayoutEffect(() => {
    setView("chat");
    scrolledReportRef.current = "";
  }, [sessionKey]);

  // Keep the newest message in view; without this an answer can land below the fold and look like nothing happened.
  // Modal unmounts its content while closed, so the callback ref covers a reopen and a tab switch, and the effect
  // covers new messages arriving while it's shown.
  const attachTranscript = React.useCallback((el: HTMLDivElement | null) => {
    transcriptRef.current = el;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, chatError]);

  // Bring a new report into view as soon as it can be seen: right away in the report view, on switching to it, or
  // on reopening the modal. The ref changes with the report, so React re-runs it when a new one arrives.
  const attachReport = React.useCallback((el: HTMLDivElement | null) => {
    if (el && reportContent && scrolledReportRef.current !== reportContent) {
      scrolledReportRef.current = reportContent;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [reportContent]);

  // The error each view has already shown, so switching away from an error you've read doesn't announce it again.
  // Cleared once the error goes away, so the same message failing again on a retry still counts as new.
  const errorText: Record<AIView, string | undefined> = { chat: chatError, report: reportError };
  const [shownErrors, setShownErrors] = React.useState<Record<AIView, string | undefined>>({ chat: undefined, report: undefined });
  React.useEffect(() => {
    setShownErrors((prev) => {
      const next = { ...prev };
      for (const { id } of VIEWS) {
        if (!errorText[id]) {
          next[id] = undefined;
        } else if (id === view) {
          next[id] = errorText[id];
        }
      }
      return VIEWS.every(({ id }) => next[id] === prev[id]) ? prev : next;
    });
  }, [view, chatError, reportError]);

  const inactiveErrors = VIEWS
    .filter(({ id }) => id !== view && !inProgress[id] && hasError[id] && shownErrors[id] !== errorText[id])
    .map(({ id }) => FAILURE_TEXT[id]);

  const selectView = (next: AIView) => {
    setView(next);
    tabRefs.current[next]?.focus();
  };

  let modalTitle = "🤖 AI Performance Analysis";
  if (isAnalyzing) {
    modalTitle = "🤖 AI Analysis in Progress...";
  } else if (isGeneratingReport) {
    modalTitle = "🤖 Generating Report...";
  }

  const chatView = (
    <>
      <div ref={attachTranscript} style={{
        maxHeight: "400px",
        overflowY: "auto",
        padding: "0.5rem",
        marginBottom: "0.75rem",
        border: "1px solid rgba(100, 100, 100, 0.3)",
        borderRadius: "6px"
      }}>
        {renderChat(messages, chatError, hasTestData)}
      </div>
      <textarea
        id="aiQuestion"
        value={aiQuestion}
        onChange={(e) => onQuestionChange(e.target.value)}
        placeholder="What would you like to know about this performance test data?"
        aria-label="AI analysis question"
        style={{
          width: "96%", // slightly less than modal width
          minHeight: "80px",
          padding: "0.75rem",
          border: "2px solid #ddd",
          borderRadius: "4px",
          fontSize: "14px",
          lineHeight: "1.4",
          resize: "vertical",
          fontFamily: "inherit",
          boxSizing: "border-box"
        }}
      />
      <div style={{ marginTop: "0.75rem" }}>
        <Button
          onClick={onSendMessage}
          disabled={sendDisabled}
          theme={actionTheme("150px")}
          style={{ cursor: sendDisabled ? "not-allowed" : "pointer" }}
        >
          {isAnalyzing ? "🔄 Sending..." : "💬 Send"}
        </Button>
      </div>
    </>
  );

  let reportBody: React.ReactNode = null;
  if (isGeneratingReport && !reportContent) {
    reportBody = (
      <div role="status" style={{
        padding: "2.5rem 1rem",
        border: "1px dashed rgba(150, 150, 150, 0.6)",
        borderRadius: "8px",
        color: "rgb(150, 150, 150)",
        textAlign: "center"
      }}>
        Generating report... this can take up to a minute.
      </div>
    );
  } else if (reportContent) {
    reportBody = (
      <section
        aria-label="Generated report"
        style={{
          background: "rgba(51, 51, 51, 0.8)",
          border: "2px solid #4caf50",
          borderRadius: "8px",
          padding: "1.5rem",
          color: "rgb(200, 200, 200)",
          textAlign: "left"
        }}
      >
        <Markdown>{reportContent}</Markdown>
      </section>
    );
  }

  // Scrolling to this wrapper rather than the report keeps Regenerate and Download in view above it
  const reportView = (
    <div ref={attachReport} style={{ scrollMarginTop: "0.75rem" }}>
      {reportContent ? (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <Button
            onClick={onGenerateReport}
            disabled={reportDisabled}
            theme={actionTheme("180px")}
            style={{ cursor: reportDisabled ? "not-allowed" : "pointer" }}
          >
            {isGeneratingReport ? "🔄 Regenerating..." : "🔄 Regenerate"}
          </Button>
          <Button onClick={onDownloadReport} theme={actionTheme("180px")} style={{ cursor: "pointer" }}>
            💾 Download (.md)
          </Button>
        </div>
      ) : (
        <div style={{ marginBottom: "1rem", textAlign: "left" }}>
          <p style={{ color: "rgb(150, 150, 150)", marginBottom: "0.75rem" }}>
            Get a comprehensive breakdown of this test: response times, error rates, bottlenecks, and
            recommendations. It&apos;s separate from the chat, so your conversation isn&apos;t affected.
          </p>
          <Button
            onClick={onGenerateReport}
            disabled={reportDisabled}
            theme={actionTheme("200px")}
            style={{ cursor: reportDisabled ? "not-allowed" : "pointer" }}
          >
            {isGeneratingReport ? "🔄 Generating..." : "📄 Generate report"}
          </Button>
        </div>
      )}
      {reportError && <ErrorBox message={reportError} />}
      {reportContent && isGeneratingReport && (
        <p role="status" style={{ color: "rgb(150, 150, 150)", fontStyle: "italic", textAlign: "left" }}>
          Regenerating... the previous report is shown below until the new one arrives.
        </p>
      )}
      {reportContent && reportError && !isGeneratingReport && (
        <p style={{ color: "rgb(150, 150, 150)", fontStyle: "italic", textAlign: "left" }}>The report below is from the previous run.</p>
      )}
      {reportBody}
    </div>
  );

  return (
    <Modal
      ref={modalRef}
      title={modalTitle}
      closeText={isBusy ? "" : "Close"}
      onClose={onClose}
      // The content scrolls inside the modal, which is what the report's scrollIntoView moves
      scrollable
    >
      <div>
        {isBusy && (
          <div style={{
            background: "rgba(255, 193, 7, 0.1)",
            border: "1px solid #ffc107",
            borderRadius: "6px",
            padding: "1rem",
            marginBottom: "1.5rem",
            color: "#ffc107",
            textAlign: "center"
          }}>
            <strong>⚠️ {isAnalyzing ? "Analysis" : "Report generation"} in Progress</strong>
            <br />
            Please wait for it to complete...
          </div>
        )}

        {/* Mode cards: two tabs, each saying what it does, so choosing between chat and report is explicit */}
        <div role="tablist" aria-label="AI analysis mode" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.25rem" }}>
          {VIEWS.map(({ id, title, description }) => {
            const selected = view === id;
            return (
              <button
                key={id}
                ref={(el) => { tabRefs.current[id] = el; }}
                id={tabId(id)}
                role="tab"
                aria-selected={selected}
                // Only the selected panel is rendered, so only its tab can reference it
                aria-controls={selected ? panelId(id) : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => setView(id)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    selectView(id === "chat" ? "report" : "chat");
                  }
                }}
                style={{
                  flex: "1 1 240px",
                  padding: "0.9rem 1rem",
                  textAlign: "left",
                  borderRadius: "8px",
                  border: selected ? "2px solid #2196f3" : "2px solid rgba(100, 100, 100, 0.5)",
                  background: selected ? "rgba(33, 150, 243, 0.15)" : "rgba(51, 51, 51, 0.6)",
                  color: "rgb(210, 210, 210)",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span style={{ fontSize: "17px", fontWeight: "bold", color: selected ? "#64b5f6" : "rgb(220, 220, 220)" }}>{title}</span>
                  {!inProgress[id] && hasError[id] && !selected && (
                    <span style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      color: "#ff7777",
                      border: "1px solid #f44336",
                      borderRadius: "999px",
                      padding: "2px 8px"
                    }}>
                      ⚠️ error
                    </span>
                  )}
                  {inProgress[id] && (
                    <span style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      color: "#ffc107",
                      border: "1px solid #ffc107",
                      borderRadius: "999px",
                      padding: "2px 8px"
                    }}>
                      🔄 in progress
                    </span>
                  )}
                </span>
                <span style={{ display: "block", marginTop: "0.25rem", fontSize: "14px", color: "rgb(160, 160, 160)" }}>{description}</span>
              </button>
            );
          })}
        </div>

        {/* The error badge only changes an unfocused tab's name, which screen readers don't announce, and the
            ErrorBox isn't mounted until its view is opened. This region stays mounted so a failure in the other
            view is announced when it happens. */}
        <div role="alert" style={visuallyHidden}>{inactiveErrors.join(" ")}</div>

        <div id={panelId(view)} role="tabpanel" aria-labelledby={tabId(view)} style={{ marginBottom: "1.5rem" }}>
          {view === "chat" ? chatView : reportView}
        </div>

        {originalData !== undefined && (
          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: "bold", color: "rgb(150, 150, 150)", textAlign: "left" }}>
              View Raw Test Data
            </summary>
            <div style={{ textAlign: "left", width: "100%" }}>
              <pre style={{
                background: "rgba(51, 51, 51, 0.8)",
                padding: "1.5rem",
                borderRadius: "4px",
                overflow: "auto",
                maxHeight: "400px",
                fontSize: "13px",
                lineHeight: "1.5",
                marginTop: "0.5rem",
                color: "rgb(200, 200, 200)",
                border: "1px solid rgba(100, 100, 100, 0.3)",
                width: "100%",
                whiteSpace: "pre",
                fontFamily: "Monaco, Consolas, 'Lucida Console', monospace"
              }}>
                {JSON.stringify(originalData, null, 2)}
              </pre>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
};

export default AIAnalysisModal;
