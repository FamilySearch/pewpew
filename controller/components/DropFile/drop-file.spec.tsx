let capturedOnDrop: ((files: File[], ...args: any[]) => void) | undefined;

vi.mock("react-dropzone", () => ({
  default: vi.fn(({ onDrop, multiple, children }: any) => {
    capturedOnDrop = onDrop;
    const rootProps = { "data-testid": "dropzone" };
    const inputProps = { type: "file", multiple };
    return children({ getRootProps: () => rootProps, getInputProps: () => inputProps, isDragActive: false, onDrop });
  })
}));
vi.mock("../Div", () => ({ default: ({ children, ...props }: any) => <div {...props}>{children}</div> }));

import { render, screen } from "@testing-library/react";
import { DropFile } from ".";

describe("DropFile", () => {
  describe("Rendering", () => {
    it("should render the drop zone container", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} />);
      expect(screen.getByTestId("dropzone")).toBeInTheDocument();
    });

    it("should render the file input", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} />);
      expect(screen.getByTestId("dropzone-file-input")).toBeInTheDocument();
    });

    it("should display the drop instruction text", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} />);
      expect(screen.getByText("Drop files here, or click to select files")).toBeInTheDocument();
    });

    it("should render file input with type file", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} />);
      const input = screen.getByTestId("dropzone-file-input") as HTMLInputElement;
      expect(input.type).toBe("file");
    });
  });

  describe("Multiple prop", () => {
    it("should default to multiple=true", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} />);
      const input = screen.getByTestId("dropzone-file-input") as HTMLInputElement;
      expect(input.multiple).toBe(true);
    });

    it("should respect multiple=false when provided", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} multiple={false} />);
      const input = screen.getByTestId("dropzone-file-input") as HTMLInputElement;
      expect(input.multiple).toBe(false);
    });
  });

  describe("Drag interaction", () => {
    it("should call onDropFile when files are dropped", () => {
      const onDropFile = vi.fn();
      capturedOnDrop = undefined;
      render(<DropFile onDropFile={onDropFile} />);
      const file = new File(["content"], "test.yaml", { type: "text/plain" });
      capturedOnDrop!([file]);
      expect(onDropFile).toHaveBeenCalledWith([file]);
    });

    it("should render dropzone without drag-active styling by default", () => {
      const onDropFile = vi.fn();
      render(<DropFile onDropFile={onDropFile} />);
      const dropzone = screen.getByTestId("dropzone");
      expect(dropzone).toBeInTheDocument();
    });
  });
});
