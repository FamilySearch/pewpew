import { NotesProvider, VIEW_MODES, useNotesContext } from "./NotesContext";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function TestConsumer () {
  const ctx = useNotesContext();
  return (
    <div>
      <span data-testid="view-mode">{ctx.viewMode}</span>
      <span data-testid="word-count">{ctx.wordCount}</span>
      <span data-testid="char-count">{ctx.charCount}</span>
      <span data-testid="is-dirty">{String(ctx.isDirty)}</span>
      <button onClick={() => ctx.setViewMode(VIEW_MODES.SPLIT)}>Set Split</button>
      <button onClick={() => ctx.setViewMode(VIEW_MODES.PREVIEW)}>Set Preview</button>
      <button onClick={() => ctx.setIsDirty(true)}>Set Dirty</button>
    </div>
  );
}

function UpdateStatsConsumer ({ getText }: { getText: () => string }) {
  const { updateStats, wordCount, charCount } = useNotesContext();
  return (
    <div>
      <span data-testid="word-count">{wordCount}</span>
      <span data-testid="char-count">{charCount}</span>
      <button onClick={() => updateStats({ getText } as any)}>Update</button>
    </div>
  );
}

describe("NotesContext", () => {
  describe("initial values", () => {
    it("provides viewMode 'edit' by default", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      expect(screen.getByTestId("view-mode").textContent).toBe("edit");
    });

    it("provides wordCount 0 by default", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      expect(screen.getByTestId("word-count").textContent).toBe("0");
    });

    it("provides charCount 0 by default", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      expect(screen.getByTestId("char-count").textContent).toBe("0");
    });

    it("provides isDirty false by default", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      expect(screen.getByTestId("is-dirty").textContent).toBe("false");
    });
  });

  describe("setViewMode", () => {
    it("updates viewMode to split", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      fireEvent.click(screen.getByText("Set Split"));
      expect(screen.getByTestId("view-mode").textContent).toBe("split");
    });

    it("updates viewMode to preview", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      fireEvent.click(screen.getByText("Set Preview"));
      expect(screen.getByTestId("view-mode").textContent).toBe("preview");
    });
  });

  describe("setIsDirty", () => {
    it("updates isDirty to true", () => {
      render(<NotesProvider><TestConsumer /></NotesProvider>);
      fireEvent.click(screen.getByText("Set Dirty"));
      expect(screen.getByTestId("is-dirty").textContent).toBe("true");
    });
  });

  describe("updateStats", () => {
    it("computes word count from editor getText()", () => {
      render(<NotesProvider><UpdateStatsConsumer getText={() => "hello world test"} /></NotesProvider>);
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByTestId("word-count").textContent).toBe("3");
    });

    it("computes char count from editor getText()", () => {
      render(<NotesProvider><UpdateStatsConsumer getText={() => "hello"} /></NotesProvider>);
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByTestId("char-count").textContent).toBe("5");
    });

    it("counts 0 words for empty text", () => {
      render(<NotesProvider><UpdateStatsConsumer getText={() => ""} /></NotesProvider>);
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByTestId("word-count").textContent).toBe("0");
    });

    it("counts 0 words for whitespace-only text", () => {
      render(<NotesProvider><UpdateStatsConsumer getText={() => "   "} /></NotesProvider>);
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByTestId("word-count").textContent).toBe("0");
    });

    it("counts char length for whitespace-only text", () => {
      render(<NotesProvider><UpdateStatsConsumer getText={() => "   "} /></NotesProvider>);
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByTestId("char-count").textContent).toBe("3");
    });

    it("does nothing when editor is null", () => {
      function NullUpdater () {
        const { updateStats, wordCount } = useNotesContext();
        return (
          <div>
            <span data-testid="word-count">{wordCount}</span>
            <button onClick={() => updateStats(null)}>Update Null</button>
          </div>
        );
      }
      render(<NotesProvider><NullUpdater /></NotesProvider>);
      fireEvent.click(screen.getByText("Update Null"));
      expect(screen.getByTestId("word-count").textContent).toBe("0");
    });
  });

  describe("useNotesContext outside provider", () => {
    it("throws when used outside NotesProvider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => vi.fn());
      function BareConsumer () {
        useNotesContext();
        return null;
      }
      expect(() => render(<BareConsumer />)).toThrow("useNotesContext must be used within a NotesProvider");
      consoleSpy.mockRestore();
    });
  });
});
