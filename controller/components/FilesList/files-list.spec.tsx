import { fireEvent, render, screen } from "@testing-library/react";
import { FilesList } from ".";
import React from "react";

describe("FilesList", () => {
  describe("Rendering with string array", () => {
    it("should render file names from a string array", () => {
      render(<FilesList files={["file1.yaml", "file2.yaml"]} onClick={() => { /* noop */ }} />);
      expect(screen.getByText(/file1\.yaml/)).toBeInTheDocument();
      expect(screen.getByText(/file2\.yaml/)).toBeInTheDocument();
    });

    it("should render a delete button for each file", () => {
      render(<FilesList files={["a.yaml", "b.yaml"]} onClick={() => { /* noop */ }} />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2);
    });

    it("should render nothing when the files array is empty", () => {
      const { container } = render(<FilesList files={[]} onClick={() => { /* noop */ }} />);
      expect(container.querySelector("ul")).not.toBeInTheDocument();
    });
  });

  describe("Rendering with File objects", () => {
    it("should render file names from File objects", () => {
      const file1 = new File(["content"], "upload1.yaml", { type: "text/plain" });
      const file2 = new File(["content"], "upload2.yaml", { type: "text/plain" });
      render(<FilesList files={[file1, file2]} onClick={() => { /* noop */ }} />);
      expect(screen.getByText(/upload1\.yaml/)).toBeInTheDocument();
      expect(screen.getByText(/upload2\.yaml/)).toBeInTheDocument();
    });

    it("should render a mixed array of strings and File objects", () => {
      const file = new File(["content"], "from-file.yaml", { type: "text/plain" });
      render(<FilesList files={["from-string.yaml", file]} onClick={() => { /* noop */ }} />);
      expect(screen.getByText(/from-string\.yaml/)).toBeInTheDocument();
      expect(screen.getByText(/from-file\.yaml/)).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("should call onClick when a delete button is clicked", () => {
      const mockClick = vi.fn();
      render(<FilesList files={["test.yaml"]} onClick={mockClick} />);
      fireEvent.click(screen.getByRole("button"));
      expect(mockClick).toHaveBeenCalledTimes(1);
    });

    it("should set the button name to the filename", () => {
      render(<FilesList files={["named-file.yaml"]} onClick={() => { /* noop */ }} />);
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.name).toBe("named-file.yaml");
    });
  });
});
