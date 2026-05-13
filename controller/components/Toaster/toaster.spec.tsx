import { render, screen } from "@testing-library/react";
import React from "react";
import { Toaster } from ".";

describe("Toaster Component", () => {
  describe("renders message", () => {
    it("displays the provided message text", () => {
      render(<Toaster id="toast-1" message="Test notification" />);
      expect(screen.getByText("Test notification")).toBeInTheDocument();
    });

    it("displays a different message text", () => {
      render(<Toaster id="toast-2" message="Upload complete" />);
      expect(screen.getByText("Upload complete")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Toaster id="toast-3" message="Hello" />);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("id prop", () => {
    it("sets the element id attribute from the id prop", () => {
      render(<Toaster id="my-toaster" message="Notification" />);
      const el = document.getElementById("my-toaster");
      expect(el).toBeInTheDocument();
    });

    it("renders with a different id", () => {
      render(<Toaster id="toaster-xyz" message="Another note" />);
      const el = document.getElementById("toaster-xyz");
      expect(el).toBeInTheDocument();
    });
  });

  describe("duration prop", () => {
    it("renders without error when duration is provided", () => {
      render(<Toaster id="toast-dur" message="With duration" duration={3000} />);
      expect(screen.getByText("With duration")).toBeInTheDocument();
    });

    it("renders without error when using the default duration", () => {
      render(<Toaster id="toast-default" message="Default duration" />);
      expect(screen.getByText("Default duration")).toBeInTheDocument();
    });

    it("renders without error when duration is a large value", () => {
      render(<Toaster id="toast-long" message="Long toast" duration={60000} />);
      expect(screen.getByText("Long toast")).toBeInTheDocument();
    });
  });

  describe("auto-removal behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("adds fade-out class after duration elapses", () => {
      render(<Toaster id="toast-fade" message="Fading" duration={3000} />);
      const el = document.getElementById("toast-fade")!;
      expect(el.classList.contains("fade-out")).toBe(false);
      vi.advanceTimersByTime(3000);
      expect(el.classList.contains("fade-out")).toBe(true);
    });

    it("does not remove element before duration elapses", () => {
      render(<Toaster id="toast-stay" message="Staying" duration={5000} />);
      vi.advanceTimersByTime(4999);
      expect(document.getElementById("toast-stay")).toBeInTheDocument();
    });

    it("does not add fade-out class before duration elapses", () => {
      render(<Toaster id="toast-early" message="Early" duration={2000} />);
      vi.advanceTimersByTime(1999);
      const el = document.getElementById("toast-early")!;
      expect(el.classList.contains("fade-out")).toBe(false);
    });
  });
});
