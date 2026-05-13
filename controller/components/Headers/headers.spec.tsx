import { H1, H2, H3 } from ".";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("Headers Components", () => {
  describe("H1", () => {
    it("renders children text", () => {
      render(<H1>Main Heading</H1>);
      expect(screen.getByText("Main Heading")).toBeInTheDocument();
    });

    it("renders as an h1 element", () => {
      render(<H1>H1 Title</H1>);
      const heading = screen.getByText("H1 Title");
      expect(heading.tagName.toLowerCase()).toBe("h1");
    });

    it("renders in the DOM", () => {
      const { container } = render(<H1>check</H1>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("H2", () => {
    it("renders children text", () => {
      render(<H2>Section Heading</H2>);
      expect(screen.getByText("Section Heading")).toBeInTheDocument();
    });

    it("renders as an h2 element", () => {
      render(<H2>H2 Title</H2>);
      const heading = screen.getByText("H2 Title");
      expect(heading.tagName.toLowerCase()).toBe("h2");
    });

    it("renders in the DOM", () => {
      const { container } = render(<H2>check</H2>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("H3", () => {
    it("renders children text", () => {
      render(<H3>Subsection Heading</H3>);
      expect(screen.getByText("Subsection Heading")).toBeInTheDocument();
    });

    it("renders as an h3 element", () => {
      render(<H3>H3 Title</H3>);
      const heading = screen.getByText("H3 Title");
      expect(heading.tagName.toLowerCase()).toBe("h3");
    });

    it("renders in the DOM", () => {
      const { container } = render(<H3>check</H3>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });
});
