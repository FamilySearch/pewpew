import { Column, Div, DivLeft, DivRight, Row } from ".";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("Div Components", () => {
  describe("Div (base)", () => {
    it("renders children", () => {
      render(<Div>Base div content</Div>);
      expect(screen.getByText("Base div content")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Div>check</Div>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Row", () => {
    it("renders children", () => {
      render(<Row>Row content</Row>);
      expect(screen.getByText("Row content")).toBeInTheDocument();
    });

    it("renders multiple children", () => {
      render(
        <Row>
          <span>Cell A</span>
          <span>Cell B</span>
        </Row>
      );
      expect(screen.getByText("Cell A")).toBeInTheDocument();
      expect(screen.getByText("Cell B")).toBeInTheDocument();
    });
  });

  describe("Column", () => {
    it("renders children", () => {
      render(<Column>Column content</Column>);
      expect(screen.getByText("Column content")).toBeInTheDocument();
    });

    it("renders multiple children", () => {
      render(
        <Column>
          <span>Row 1</span>
          <span>Row 2</span>
        </Column>
      );
      expect(screen.getByText("Row 1")).toBeInTheDocument();
      expect(screen.getByText("Row 2")).toBeInTheDocument();
    });
  });

  describe("DivLeft", () => {
    it("renders children", () => {
      render(<DivLeft>Left content</DivLeft>);
      expect(screen.getByText("Left content")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<DivLeft>left</DivLeft>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("DivRight", () => {
    it("renders children", () => {
      render(<DivRight>Right content</DivRight>);
      expect(screen.getByText("Right content")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<DivRight>right</DivRight>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });
});
