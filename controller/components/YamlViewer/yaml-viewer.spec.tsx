import { render, screen } from "@testing-library/react";
import React from "react";
import { YamlViewer } from ".";

describe("YamlViewer", () => {
  describe("Textarea rendering", () => {
    it("should render a textarea when yamlContents is provided", () => {
      render(<YamlViewer yamlContents="key: value" />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("should render the provided contents in the textarea", () => {
      const contents = "name: test\nvalue: 123";
      render(<YamlViewer yamlContents={contents} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(textarea.value).toBe(contents);
    });

    it("should render a textarea with loading placeholder when loading is true", () => {
      render(<YamlViewer loading={true} />);
      expect(screen.getByPlaceholderText("Loading Data...")).toBeInTheDocument();
    });

    it("should not render a textarea when no contents and not loading", () => {
      render(<YamlViewer />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("Filename display", () => {
    it("should render the filename when yamlFilename is provided", () => {
      render(<YamlViewer yamlFilename="my-test.yaml" yamlContents="key: value" />);
      expect(screen.getByText(/my-test\.yaml/)).toBeInTheDocument();
    });

    it("should not render a filename heading when yamlFilename is not provided", () => {
      render(<YamlViewer yamlContents="key: value" />);
      expect(screen.queryByText(/Yaml File:/)).not.toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("should render the error message when error prop is provided", () => {
      render(<YamlViewer error="Failed to load file" />);
      expect(screen.getByText(/Failed to load file/)).toBeInTheDocument();
    });

    it("should not render an error when error prop is not provided", () => {
      render(<YamlViewer yamlContents="key: value" />);
      expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("should show No Data warning when no contents, no loading, and no error", () => {
      render(<YamlViewer />);
      expect(screen.getByText("No Data")).toBeInTheDocument();
    });

    it("should not show No Data warning when yamlContents is provided", () => {
      render(<YamlViewer yamlContents="key: value" />);
      expect(screen.queryByText("No Data")).not.toBeInTheDocument();
    });

    it("should not show No Data warning when loading is true", () => {
      render(<YamlViewer loading={true} />);
      expect(screen.queryByText("No Data")).not.toBeInTheDocument();
    });
  });
});
