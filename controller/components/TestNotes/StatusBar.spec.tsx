import { NotesProvider, useNotesContext } from "./NotesContext";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import StatusBar from "./StatusBar";

function StatsUpdater ({ getText }: { getText: () => string }) {
  const { updateStats } = useNotesContext();
  return <button onClick={() => updateStats({ getText } as any)}>Update</button>;
}

describe("StatusBar", () => {
  describe("accessibility", () => {
    it("has role='status'", () => {
      render(<NotesProvider><StatusBar /></NotesProvider>);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("has aria-live='polite'", () => {
      render(<NotesProvider><StatusBar /></NotesProvider>);
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("initial state", () => {
    it("shows '0 words' initially", () => {
      render(<NotesProvider><StatusBar /></NotesProvider>);
      expect(screen.getByText("0 words")).toBeInTheDocument();
    });

    it("shows '0 characters' initially", () => {
      render(<NotesProvider><StatusBar /></NotesProvider>);
      expect(screen.getByText("0 characters")).toBeInTheDocument();
    });
  });

  describe("after updateStats", () => {
    it("reflects updated word count", () => {
      render(
        <NotesProvider>
          <StatsUpdater getText={() => "hello world"} />
          <StatusBar />
        </NotesProvider>
      );
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByText("2 words")).toBeInTheDocument();
    });

    it("reflects updated char count", () => {
      render(
        <NotesProvider>
          <StatsUpdater getText={() => "hello world"} />
          <StatusBar />
        </NotesProvider>
      );
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByText("11 characters")).toBeInTheDocument();
    });

    it("shows 0 words for whitespace-only content", () => {
      render(
        <NotesProvider>
          <StatsUpdater getText={() => "   "} />
          <StatusBar />
        </NotesProvider>
      );
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByText("0 words")).toBeInTheDocument();
    });

    it("shows correct char count for whitespace-only content", () => {
      render(
        <NotesProvider>
          <StatsUpdater getText={() => "   "} />
          <StatusBar />
        </NotesProvider>
      );
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByText("3 characters")).toBeInTheDocument();
    });

    it("shows 0 words for empty content", () => {
      render(
        <NotesProvider>
          <StatsUpdater getText={() => ""} />
          <StatusBar />
        </NotesProvider>
      );
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByText("0 words")).toBeInTheDocument();
    });

    it("shows 1 word for single word", () => {
      render(
        <NotesProvider>
          <StatsUpdater getText={() => "performance"} />
          <StatusBar />
        </NotesProvider>
      );
      fireEvent.click(screen.getByText("Update"));
      expect(screen.getByText("1 words")).toBeInTheDocument();
    });
  });
});
