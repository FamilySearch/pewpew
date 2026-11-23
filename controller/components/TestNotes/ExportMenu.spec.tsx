vi.mock("../../src/clientutil", () => ({ formatPageHref: vi.fn((url: string) => url) }));
vi.mock("../../types/pages", () => ({
  API_NOTES_EXPORT_FORMAT: vi.fn((folder: string) => `/api/notes/${folder}/export`)
}));

import ExportMenu, { REVOKE_OBJECT_URL_DELAY_MS } from "./ExportMenu";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

function makeRef (content = "# Markdown content"): React.RefObject<(() => string) | null> {
  return { current: () => content } as any;
}

describe("ExportMenu", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Export button", () => {
    it("renders the Export button", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" />);
      expect(screen.getByTestId("export-menu-toggle")).toBeInTheDocument();
    });

    it("dropdown is hidden initially", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" />);
      expect(screen.queryByText("Download Markdown")).not.toBeInTheDocument();
    });

    it("clicking Export opens the dropdown", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.getByText("Download Markdown")).toBeInTheDocument();
      expect(screen.getByText("Export to Confluence")).toBeInTheDocument();
      expect(screen.getByText("Copy to Clipboard")).toBeInTheDocument();
    });

    it("clicking Export again toggles dropdown closed", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.queryByText("Download Markdown")).not.toBeInTheDocument();
    });
  });

  describe("Export to Confluence", () => {
    it("is disabled when hasNotes is false", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" hasNotes={false} />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.getByText("Export to Confluence")).toBeDisabled();
    });

    it("is disabled when hasNotes is not provided", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.getByText("Export to Confluence")).toBeDisabled();
    });

    it("is enabled when hasNotes is true", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" hasNotes={true} />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.getByText("Export to Confluence")).not.toBeDisabled();
    });

    it("clicking Export to Confluence opens a new window", () => {
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" hasNotes={true} />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Export to Confluence"));
      expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("confluence"), "_blank");
    });

    it("clicking Export to Confluence closes the dropdown", () => {
      vi.spyOn(window, "open").mockReturnValue(null);
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" hasNotes={true} />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Export to Confluence"));
      expect(screen.queryByText("Download Markdown")).not.toBeInTheDocument();
    });
  });

  describe("Download Markdown", () => {
    it("triggers a file download with createObjectURL and revokes the URL after the download starts", () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => vi.fn());
        render(<ExportMenu getContent={makeRef("# Hello")} s3Folder="unit/test" />);
        fireEvent.click(screen.getByTestId("export-menu-toggle"));
        fireEvent.click(screen.getByText("Download Markdown"));
        expect(URL.createObjectURL).toHaveBeenCalled();
        // Not in the same tick as the click, which can cancel the download
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(REVOKE_OBJECT_URL_DELAY_MS); });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
      } finally {
        vi.useRealTimers();
      }
    });

    it("triggers anchor click for download", () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => vi.fn());
      render(<ExportMenu getContent={makeRef("# Hello")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Download Markdown"));
      expect(clickSpy).toHaveBeenCalled();
    });

    it("closes the dropdown after download", () => {
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => vi.fn());
      render(<ExportMenu getContent={makeRef("# Hello")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Download Markdown"));
      expect(screen.queryByText("Download Markdown")).not.toBeInTheDocument();
    });

    it("does nothing when getContent returns empty string", () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => vi.fn());
      render(<ExportMenu getContent={makeRef("")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Download Markdown"));
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it("uses s3Folder in the filename", () => {
      let capturedHref = "";
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        capturedHref = this.download;
      });
      render(<ExportMenu getContent={makeRef("content")} s3Folder="mytest/20240101" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Download Markdown"));
      expect(capturedHref).toContain("mytest");
    });
  });

  describe("Copy to Clipboard", () => {
    it("calls navigator.clipboard.writeText with editor content", () => {
      render(<ExportMenu getContent={makeRef("hello clipboard")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Copy to Clipboard"));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello clipboard");
    });

    it("closes the dropdown after copying", async () => {
      render(<ExportMenu getContent={makeRef("hello")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Copy to Clipboard"));
      await waitFor(() => expect(screen.queryByText("Download Markdown")).not.toBeInTheDocument());
    });

    it("does nothing when getContent returns empty string", () => {
      render(<ExportMenu getContent={makeRef("")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Copy to Clipboard"));
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("shows an error and keeps the menu open when the clipboard write is rejected", async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("NotAllowedError"));
      render(<ExportMenu getContent={makeRef("hello")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Copy to Clipboard"));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy");
      expect(screen.getByText("Download Markdown")).toBeInTheDocument();
    });

    it("shows an error when the clipboard API is unavailable (non-secure origin)", async () => {
      Object.assign(navigator, { clipboard: undefined });
      render(<ExportMenu getContent={makeRef("hello")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Copy to Clipboard"));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy");
    });

    it("clears the error when the menu is reopened", async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("NotAllowedError"));
      render(<ExportMenu getContent={makeRef("hello")} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByText("Copy to Clipboard"));
      await screen.findByRole("alert");
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("click outside", () => {
    it("closes the dropdown when clicking outside the menu", () => {
      render(<div><span data-testid="outside">outside</span><ExportMenu getContent={makeRef()} s3Folder="unit/test" /></div>);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      expect(screen.getByText("Download Markdown")).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByTestId("outside"));
      expect(screen.queryByText("Download Markdown")).not.toBeInTheDocument();
    });

    it("stays open when clicking inside the menu", () => {
      render(<ExportMenu getContent={makeRef()} s3Folder="unit/test" />);
      fireEvent.click(screen.getByTestId("export-menu-toggle"));
      fireEvent.mouseDown(screen.getByText("Export to Confluence"));
      expect(screen.getByText("Download Markdown")).toBeInTheDocument();
    });
  });
});
