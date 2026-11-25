// Like the real Modal, the content is unmounted while closed
const modalState = vi.hoisted(() => ({ open: true }));
vi.mock("../Modal", () => ({
  Modal: ({ children, title, closeText, onClose, scrollable }: any) => (
    <div data-testid="mock-modal" data-scrollable={String(!!scrollable)}>
      <h2>{title}</h2>
      {closeText && <button onClick={onClose}>{closeText}</button>}
      {modalState.open && children}
    </div>
  )
}));
vi.mock("react-markdown", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("remark-gfm", () => ({ default: () => ({}) }));

import { AIAnalysisModal, AIAnalysisModalProps, markdownComponents } from ".";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const makeProps = (overrides: Partial<AIAnalysisModalProps> = {}): AIAnalysisModalProps => ({
  modalRef: { current: null } as React.RefObject<any>,
  isAnalyzing: false,
  hasTestData: false,
  messages: [],
  chatError: undefined,
  aiQuestion: "",
  onQuestionChange: vi.fn(),
  onSendMessage: vi.fn(),
  isGeneratingReport: false,
  reportContent: undefined,
  reportError: undefined,
  onGenerateReport: vi.fn(),
  onDownloadReport: vi.fn(),
  originalData: undefined,
  onClose: vi.fn(),
  ...overrides
});

const chatTab = () => screen.getByRole("tab", { name: /Chat/ });
const reportTab = () => screen.getByRole("tab", { name: /Full report/ });

describe("AIAnalysisModal", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    modalState.open = true;
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  describe("title and header", () => {
    it("shows normal title when not analyzing", () => {
      render(<AIAnalysisModal {...makeProps()} />);
      expect(screen.getByText("🤖 AI Performance Analysis")).toBeInTheDocument();
    });

    it("shows analyzing title when isAnalyzing is true", () => {
      render(<AIAnalysisModal {...makeProps({ isAnalyzing: true })} />);
      expect(screen.getByText("🤖 AI Analysis in Progress...")).toBeInTheDocument();
    });

    it("shows in-progress warning banner when isAnalyzing", () => {
      render(<AIAnalysisModal {...makeProps({ isAnalyzing: true })} />);
      expect(screen.getByText(/Please wait for it to complete/)).toBeInTheDocument();
    });

    it("shows in-progress warning banner when generating a report", () => {
      render(<AIAnalysisModal {...makeProps({ isGeneratingReport: true })} />);
      expect(screen.getByText(/Please wait for it to complete/)).toBeInTheDocument();
    });

    it("does not show in-progress warning banner when idle", () => {
      render(<AIAnalysisModal {...makeProps()} />);
      expect(screen.queryByText(/Please wait for it to complete/)).not.toBeInTheDocument();
    });
  });

  describe("question textarea", () => {
    it("renders the question textarea", () => {
      render(<AIAnalysisModal {...makeProps()} />);
      expect(screen.getByLabelText("AI analysis question")).toBeInTheDocument();
    });

    it("reflects the aiQuestion prop value", () => {
      render(<AIAnalysisModal {...makeProps({ aiQuestion: "Is latency acceptable?" })} />);
      const textarea = screen.getByLabelText("AI analysis question") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Is latency acceptable?");
    });

    it("calls onQuestionChange when the textarea changes", () => {
      const onQuestionChange = vi.fn();
      render(<AIAnalysisModal {...makeProps({ onQuestionChange })} />);
      fireEvent.change(screen.getByLabelText("AI analysis question"), { target: { value: "New question" } });
      expect(onQuestionChange).toHaveBeenCalledWith("New question");
    });
  });

  describe("Send button", () => {
    it("is disabled when question is empty", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, aiQuestion: "" })} />);
      expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
    });

    it("is disabled when question is only whitespace", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, aiQuestion: "   " })} />);
      expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
    });

    it("is disabled when there is no test data", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: false, aiQuestion: "What happened?" })} />);
      expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
    });

    it("is disabled when isAnalyzing is true", () => {
      render(<AIAnalysisModal {...makeProps({
        isAnalyzing: true,
        hasTestData: true,
        aiQuestion: "What happened?"
      })} />);
      expect(screen.getByRole("button", { name: /Sending/ })).toBeDisabled();
    });

    it("is enabled when question and test data are both present", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, aiQuestion: "What happened?" })} />);
      expect(screen.getByRole("button", { name: /Send/ })).not.toBeDisabled();
    });

    it("calls onSendMessage when clicked while enabled", () => {
      const onSendMessage = vi.fn();
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, aiQuestion: "Test?", onSendMessage })} />);
      fireEvent.click(screen.getByRole("button", { name: /Send/ }));
      expect(onSendMessage).toHaveBeenCalled();
    });
  });

  describe("chat transcript", () => {
    it("shows a prompt to ask a question when there are no messages yet and data is ready", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, messages: [] })} />);
      expect(screen.getByText(/Ask a question below to get started/)).toBeInTheDocument();
    });

    it("shows a preparing message when there are no messages yet and data isn't ready", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: false, messages: [] })} />);
      expect(screen.getByText(/Preparing test data/)).toBeInTheDocument();
    });

    it("renders user and assistant messages", () => {
      render(<AIAnalysisModal {...makeProps({
        hasTestData: true,
        messages: [
          { role: "user", content: "What was the error rate?" },
          { role: "assistant", content: "The error rate was 0.5%." }
        ]
      })} />);
      expect(screen.getByText("What was the error rate?")).toBeInTheDocument();
      expect(screen.getByText("The error rate was 0.5%.")).toBeInTheDocument();
    });

    it("shows a chat error when present", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, chatError: "Rate limit exceeded" })} />);
      expect(screen.getByText(/Rate limit exceeded/)).toBeInTheDocument();
    });
  });

  describe("mode cards", () => {
    it("offers Chat and Full report as separate modes, opening on Chat", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      expect(screen.getByRole("tablist", { name: "AI analysis mode" })).toBeInTheDocument();
      expect(chatTab()).toHaveAttribute("aria-selected", "true");
      expect(chatTab()).toHaveTextContent("Ask questions about these performance metrics");
      expect(reportTab()).toHaveAttribute("aria-selected", "false");
      expect(reportTab()).toHaveTextContent("Generate a full report with findings");
      expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Chat/);
      expect(screen.queryByRole("button", { name: /Generate report/ })).not.toBeInTheDocument();
    });

    it("switches to the report view and back without losing the conversation", () => {
      render(<AIAnalysisModal {...makeProps({
        hasTestData: true,
        messages: [
          { role: "user", content: "What was the error rate?" },
          { role: "assistant", content: "The error rate was 0.5%." }
        ]
      })} />);

      fireEvent.click(reportTab());
      expect(reportTab()).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("button", { name: /Generate report/ })).toBeInTheDocument();
      expect(screen.queryByText("What was the error rate?")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("AI analysis question")).not.toBeInTheDocument();

      fireEvent.click(chatTab());
      expect(screen.getByText("What was the error rate?")).toBeInTheDocument();
      expect(screen.getByText("The error rate was 0.5%.")).toBeInTheDocument();
    });

    it("switches modes with the arrow keys", () => {
      render(<AIAnalysisModal {...makeProps()} />);
      fireEvent.keyDown(chatTab(), { key: "ArrowRight" });
      expect(reportTab()).toHaveAttribute("aria-selected", "true");
      expect(reportTab()).toHaveFocus();
      fireEvent.keyDown(reportTab(), { key: "ArrowLeft" });
      expect(chatTab()).toHaveAttribute("aria-selected", "true");
      expect(chatTab()).toHaveFocus();
    });

    it("marks the mode whose request is running, so it's visible from the other view", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ isGeneratingReport: true })} />);
      expect(reportTab()).toHaveAccessibleName(/in progress/);
      expect(chatTab()).not.toHaveAccessibleName(/in progress/);

      rerender(<AIAnalysisModal {...makeProps({ isAnalyzing: true })} />);
      expect(chatTab()).toHaveAccessibleName(/in progress/);
      expect(reportTab()).not.toHaveAccessibleName(/in progress/);
    });

    it("still allows switching while a question is being answered, with the report actions locked", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, isAnalyzing: true, aiQuestion: "Q" })} />);
      fireEvent.click(reportTab());
      expect(reportTab()).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("button", { name: /Generate report/ })).toBeDisabled();
    });
  });

  describe("Report view", () => {
    it("Generate is disabled when there is no test data", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: false })} />);
      fireEvent.click(reportTab());
      expect(screen.getByRole("button", { name: /Generate report/ })).toBeDisabled();
    });

    it("calls onGenerateReport when Generate is clicked", () => {
      const onGenerateReport = vi.fn();
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, onGenerateReport })} />);
      fireEvent.click(reportTab());
      expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Generate report/ }));
      expect(onGenerateReport).toHaveBeenCalled();
    });

    it("shows a placeholder where the report will appear while generating", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, isGeneratingReport: true })} />);
      fireEvent.click(reportTab());
      expect(screen.getByText("Generating report... this can take up to a minute.")).toBeInTheDocument();
    });

    it("shows the finished report expanded and scrolls to it", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true, isGeneratingReport: true })} />);
      fireEvent.click(reportTab());
      expect(scrollIntoView).not.toHaveBeenCalled();

      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "Latency is fine." })} />);
      expect(screen.getByText("Latency is fine.")).toBeVisible();
      expect(screen.queryByText("View Full Report")).not.toBeInTheDocument();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      // The scroll target includes the actions above the report, so they aren't scrolled out of view
      const target = scrollIntoView.mock.instances[0] as unknown as HTMLElement;
      expect(target).toContainElement(screen.getByRole("button", { name: /Regenerate/ }));
      expect(target).toContainElement(screen.getByRole("region", { name: "Generated report" }));
    });

    it("scrolls to a report that finished while the chat view was open once the report view is chosen", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true, isGeneratingReport: true })} />);
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Done" })} />);
      expect(scrollIntoView).not.toHaveBeenCalled();

      fireEvent.click(reportTab());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // Coming back to an already-seen report doesn't jump again
      fireEvent.click(chatTab());
      fireEvent.click(reportTab());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("offers Regenerate and Download above a finished report", () => {
      const onGenerateReport = vi.fn();
      const onDownloadReport = vi.fn();
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Report", onGenerateReport, onDownloadReport })} />);
      fireEvent.click(reportTab());
      fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
      expect(onGenerateReport).toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /Download/ }));
      expect(onDownloadReport).toHaveBeenCalled();
    });

    it("shows a report error in the report view only", () => {
      render(<AIAnalysisModal {...makeProps({ reportError: "API error" })} />);
      expect(screen.queryByText(/API error/)).not.toBeInTheDocument();
      fireEvent.click(reportTab());
      expect(screen.getByText(/API error/)).toBeInTheDocument();
    });
  });

  describe("review fixes", () => {
    it("keeps cell borders on aligned table columns while honoring the alignment", async () => {
      // The spec mocks react-markdown, so render the component map with the real library here
      const { default: RealMarkdown } = await vi.importActual<typeof import("react-markdown")>("react-markdown");
      const { default: realGfm } = await vi.importActual<typeof import("remark-gfm")>("remark-gfm");
      render(<RealMarkdown remarkPlugins={[realGfm]} components={markdownComponents}>
        {"| Endpoint | P95 |\n|:---|---:|\n| /login | 104ms |"}
      </RealMarkdown>);
      const cell = screen.getByRole("cell", { name: "104ms" });
      expect(cell.style.textAlign).toBe("right");
      expect(cell.style.border).toContain("1px solid");
      expect(screen.getByRole("columnheader", { name: "P95" }).style.border).toContain("1px solid");
    });

    it("says a new report is coming while regenerating, keeping the previous one visible", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "Old findings", isGeneratingReport: true })} />);
      fireEvent.click(reportTab());
      expect(screen.getByText("Regenerating... the previous report is shown below until the new one arrives.")).toBeInTheDocument();
      expect(screen.getByText("Old findings")).toBeInTheDocument();
    });

    it("labels the report as the previous one when regenerating fails", () => {
      render(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "Old findings", reportError: "API error" })} />);
      fireEvent.click(reportTab());
      expect(screen.getByText(/API error/)).toBeInTheDocument();
      expect(screen.getByText("The report below is from the previous run.")).toBeInTheDocument();
    });

    it("points only the selected tab at the panel that's rendered", () => {
      render(<AIAnalysisModal {...makeProps()} />);
      expect(chatTab()).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
      expect(reportTab()).not.toHaveAttribute("aria-controls");
      fireEvent.click(reportTab());
      expect(reportTab()).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
      expect(chatTab()).not.toHaveAttribute("aria-controls");
    });

    it("flags a mode that failed while the other view was open", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ isGeneratingReport: true })} />);
      rerender(<AIAnalysisModal {...makeProps({ reportError: "API error" })} />);
      expect(reportTab()).toHaveAccessibleName(/error/);

      fireEvent.click(reportTab());
      expect(reportTab()).not.toHaveAccessibleName(/error/);

      rerender(<AIAnalysisModal {...makeProps({ chatError: "Rate limit exceeded" })} />);
      expect(chatTab()).toHaveAccessibleName(/error/);
    });

    it("scrolls to a report that finished while the modal was closed once it's reopened", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true, isGeneratingReport: true })} />);
      fireEvent.click(reportTab());

      modalState.open = false;
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Done" })} />);
      expect(scrollIntoView).not.toHaveBeenCalled();

      modalState.open = true;
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Done" })} />);
      expect(reportTab()).toHaveAttribute("aria-selected", "true");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("opens the transcript at the newest message after a reopen or a tab switch", () => {
      const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
      try {
        const props = makeProps({ hasTestData: true, messages: [{ role: "user", content: "Q" }, { role: "assistant", content: "A" }] });
        const { rerender } = render(<AIAnalysisModal {...props} />);
        const transcript = () => screen.getByText("Q").closest("div[style*='overflow']") as HTMLElement;

        modalState.open = false;
        rerender(<AIAnalysisModal {...props} />);
        modalState.open = true;
        rerender(<AIAnalysisModal {...props} />);
        expect(transcript().scrollTop).toBe(500);

        fireEvent.click(reportTab());
        fireEvent.click(chatTab());
        expect(transcript().scrollTop).toBe(500);
      } finally {
        scrollHeight.mockRestore();
      }
    });

    it("goes back to Chat when the data changes and the chat and report are cleared", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Old" })} />);
      fireEvent.click(reportTab());
      expect(reportTab()).toHaveAttribute("aria-selected", "true");

      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, aiQuestion: "Default question", sessionKey: 1 })} />);
      expect(chatTab()).toHaveAttribute("aria-selected", "true");
      expect(screen.getByLabelText("AI analysis question")).toHaveValue("Default question");
    });

    it("goes back to Chat for new data even when the report view was open with nothing in it", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      fireEvent.click(reportTab());

      modalState.open = false;
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      modalState.open = true;
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, sessionKey: 1 })} />);
      expect(chatTab()).toHaveAttribute("aria-selected", "true");
    });

    it("keeps the chosen view across reopens and state changes within the same session", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true, isAnalyzing: true, messages: [{ role: "user", content: "Q" }] })} />);
      fireEvent.click(reportTab());

      // A failed first message is rolled back, leaving an empty transcript
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, chatError: "Rate limit exceeded" })} />);
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      modalState.open = false;
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      modalState.open = true;
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      expect(reportTab()).toHaveAttribute("aria-selected", "true");
    });

    it("scrolls to an identical report again after a new session", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Same" })} />);
      fireEvent.click(reportTab());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, sessionKey: 1 })} />);
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportContent: "# Same", sessionKey: 1 })} />);
      fireEvent.click(reportTab());
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it("announces a failure in the view that isn't open", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ isGeneratingReport: true })} />);
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();

      rerender(<AIAnalysisModal {...makeProps({ reportError: "API error" })} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Report generation failed. Switch to Full report to see the error.");

      // In its own view the ErrorBox reports it instead
      fireEvent.click(reportTab());
      expect(screen.getAllByRole("alert").map((el) => el.textContent)).toEqual(["", "❌ Error: API error"]);
    });

    it("doesn't announce an error again after its view has shown it", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      fireEvent.click(reportTab());
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportError: "API error" })} />);

      fireEvent.click(chatTab());
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
      fireEvent.click(reportTab());
      fireEvent.click(chatTab());
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    });

    it("announces the same error again when a retry fails while the other view is open", () => {
      const { rerender } = render(<AIAnalysisModal {...makeProps({ hasTestData: true })} />);
      fireEvent.click(reportTab());
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportError: "API error" })} />);

      // Regenerate clears the error, then the user switches away before it fails the same way
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, isGeneratingReport: true })} />);
      fireEvent.click(chatTab());
      rerender(<AIAnalysisModal {...makeProps({ hasTestData: true, reportError: "API error" })} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Report generation failed. Switch to Full report to see the error.");
    });

    it("gives each modal instance its own tab and panel ids", () => {
      render(<><AIAnalysisModal {...makeProps()} /><AIAnalysisModal {...makeProps()} /></>);
      const ids = [...screen.getAllByRole("tab"), ...screen.getAllByRole("tabpanel")].map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const panel of screen.getAllByRole("tabpanel")) {
        expect(document.getElementById(panel.getAttribute("aria-labelledby")!)).toHaveAttribute("aria-controls", panel.id);
      }
    });

    it("asks the modal to scroll its content, which bringing the report into view relies on", () => {
      render(<AIAnalysisModal {...makeProps()} />);
      expect(screen.getByTestId("mock-modal")).toHaveAttribute("data-scrollable", "true");
    });
  });

  describe("raw test data", () => {
    it("does not render the raw data section when originalData is undefined", () => {
      render(<AIAnalysisModal {...makeProps({ originalData: undefined })} />);
      expect(screen.queryByText("View Raw Test Data")).not.toBeInTheDocument();
    });

    it("renders the raw data section when originalData is present", () => {
      render(<AIAnalysisModal {...makeProps({ originalData: { x: 1 } })} />);
      expect(screen.getByText("View Raw Test Data")).toBeInTheDocument();
    });
  });

  describe("close button", () => {
    it("calls onClose when the close button is clicked", () => {
      const onClose = vi.fn();
      render(<AIAnalysisModal {...makeProps({ onClose })} />);
      fireEvent.click(screen.getByText("Close"));
      expect(onClose).toHaveBeenCalled();
    });

    it("hides the close button text when analyzing", () => {
      render(<AIAnalysisModal {...makeProps({ isAnalyzing: true })} />);
      expect(screen.queryByText("Close")).not.toBeInTheDocument();
    });

    it("hides the close button text when generating a report", () => {
      render(<AIAnalysisModal {...makeProps({ isGeneratingReport: true })} />);
      expect(screen.queryByText("Close")).not.toBeInTheDocument();
    });
  });
});
