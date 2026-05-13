vi.mock("../../src/log", () => ({ LogLevel: { DEBUG: "debug", WARN: "warn" }, log: vi.fn() }));
vi.mock("../LinkButton", () => ({ Button: ({ children, onClick, disabled, ...props }: any) => <button onClick={onClick} disabled={disabled} {...props}>{children}</button> }));
vi.mock("../Headers", () => ({ H3: ({ children }: any) => <h3>{children}</h3> }));
vi.mock("../TestsList", () => ({ TestsList: ({ tests, onClick }: any) => <ul>{tests.map((t: any) => <li key={t.testId} onClick={(e: any) => onClick(e, t)}>{t.testId}</li>)}</ul> }));

import { Modal, ModalObject, TestsListModal } from ".";
import React, { act, createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

describe("Modal", () => {
  describe("Display behavior", () => {
    it("should not render when initialDisplay is false (default)", () => {
      render(<Modal title="Test Modal">Modal content</Modal>);
      expect(screen.queryByText("Test Modal")).not.toBeInTheDocument();
    });

    it("should render when initialDisplay is true", () => {
      render(<Modal title="Test Modal" initialDisplay={true}>Modal content</Modal>);
      expect(screen.getByText("Test Modal")).toBeInTheDocument();
    });

    it("should render children when open", () => {
      render(<Modal initialDisplay={true}>Child content here</Modal>);
      expect(screen.getByText("Child content here")).toBeInTheDocument();
    });
  });

  describe("Title rendering", () => {
    it("should render the title when provided", () => {
      render(<Modal title="My Modal Title" initialDisplay={true} />);
      expect(screen.getByText("My Modal Title")).toBeInTheDocument();
    });

    it("should not render a title element when title is omitted", () => {
      render(<Modal initialDisplay={true}>Content</Modal>);
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });
  });

  describe("Close button", () => {
    it("should render the close button with default text", () => {
      render(<Modal initialDisplay={true} />);
      expect(screen.getByText("close")).toBeInTheDocument();
    });

    it("should render the close button with custom closeText", () => {
      render(<Modal initialDisplay={true} closeText="Dismiss" />);
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
    });

    it("should call onClose when the close button is clicked", () => {
      const onClose = vi.fn();
      render(<Modal initialDisplay={true} onClose={onClose} />);
      fireEvent.click(screen.getByText("close"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("should hide the modal after close button is clicked", () => {
      render(<Modal title="Closeable" initialDisplay={true} />);
      expect(screen.getByText("Closeable")).toBeInTheDocument();
      fireEvent.click(screen.getByText("close"));
      expect(screen.queryByText("Closeable")).not.toBeInTheDocument();
    });

    it("should close the modal when the backdrop is clicked", () => {
      const onClose = vi.fn();
      const { container } = render(<Modal title="Backdrop Test" initialDisplay={true} onClose={onClose} />);
      // The backdrop is the first child of the ModalStyle wrapper
      const backdrop = container.firstChild?.firstChild as HTMLElement;
      if (backdrop) { fireEvent.click(backdrop); }
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Submit button", () => {
    it("should not render submit button when onSubmit is not provided", () => {
      render(<Modal initialDisplay={true} />);
      expect(screen.queryByText("submit")).not.toBeInTheDocument();
    });

    it("should render submit button when onSubmit is provided", () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      render(<Modal initialDisplay={true} onSubmit={onSubmit} />);
      expect(screen.getByText("submit")).toBeInTheDocument();
    });

    it("should render submit button with custom submitText", () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      render(<Modal initialDisplay={true} onSubmit={onSubmit} submitText="Confirm" />);
      expect(screen.getByText("Confirm")).toBeInTheDocument();
    });

    it("should disable submit button when isReady is false", () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      render(<Modal initialDisplay={true} onSubmit={onSubmit} isReady={false} />);
      const submitBtn = screen.getByText("submit") as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
    });

    it("should enable submit button when isReady is true", () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      render(<Modal initialDisplay={true} onSubmit={onSubmit} isReady={true} />);
      const submitBtn = screen.getByText("submit") as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(false);
    });

    it("should call onSubmit when submit button is clicked", () => {
      const onSubmit = vi.fn(() => Promise.resolve());
      render(<Modal initialDisplay={true} onSubmit={onSubmit} isReady={true} />);
      fireEvent.click(screen.getByText("submit"));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("Ref imperative handle", () => {
    it("should expose openModal and closeModal via ref", async () => {
      const ref = createRef<ModalObject>();
      render(<Modal ref={ref} title="Ref Modal" />);
      expect(screen.queryByText("Ref Modal")).not.toBeInTheDocument();
      await act(async () => { ref.current!.openModal(); await Promise.resolve(); });
      expect(screen.getByText("Ref Modal")).toBeInTheDocument();
      await act(async () => { ref.current!.closeModal(); await Promise.resolve(); });
      expect(screen.queryByText("Ref Modal")).not.toBeInTheDocument();
    });

    it("should report isOpen state correctly", async () => {
      const ref = createRef<ModalObject>();
      render(<Modal ref={ref} />);
      expect(ref.current!.isOpen()).toBe(false);
      await act(async () => { ref.current!.openModal(); await Promise.resolve(); });
      expect(ref.current!.isOpen()).toBe(true);
    });
  });
});

describe("TestsListModal", () => {
  it("should show loading when tests is undefined", async () => {
    const ref = createRef<ModalObject>();
    render(<TestsListModal ref={ref} tests={undefined} onClick={vi.fn()} />);
    await act(async () => { ref.current!.openModal(); await Promise.resolve(); });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should show no-prior-tests message when tests array is empty", async () => {
    const ref = createRef<ModalObject>();
    render(<TestsListModal ref={ref} tests={[]} onClick={vi.fn()} />);
    await act(async () => { ref.current!.openModal(); await Promise.resolve(); });
    expect(screen.getByText("No prior tests found")).toBeInTheDocument();
  });

  it("should render tests when tests array has items", async () => {
    const ref = createRef<ModalObject>();
    const tests = [{ testId: "test-abc-123", s3Folder: "folder", status: "running" as any, startTime: 1000 }];
    render(<TestsListModal ref={ref} tests={tests} onClick={vi.fn()} />);
    await act(async () => { ref.current!.openModal(); await Promise.resolve(); });
    expect(screen.getByText("test-abc-123")).toBeInTheDocument();
  });

  it("should render the modal title as Compare With", async () => {
    const ref = createRef<ModalObject>();
    render(<TestsListModal ref={ref} tests={[]} onClick={vi.fn()} />);
    await act(async () => { ref.current!.openModal(); await Promise.resolve(); });
    expect(screen.getByText("Compare With")).toBeInTheDocument();
  });
});
