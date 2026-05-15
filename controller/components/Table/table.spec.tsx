import { Cell, FlexTable, HtmlTable, HtmlTd, HtmlTh, HtmlTr, Row, SmallCell } from ".";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("Table Components", () => {
  describe("FlexTable", () => {
    it("renders children", () => {
      render(<FlexTable>Table content</FlexTable>);
      expect(screen.getByText("Table content")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<FlexTable>check</FlexTable>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Row", () => {
    it("renders children", () => {
      render(<Row>Row content</Row>);
      expect(screen.getByText("Row content")).toBeInTheDocument();
    });

    it("renders multiple cells as children", () => {
      render(
        <Row>
          <Cell>Cell 1</Cell>
          <Cell>Cell 2</Cell>
        </Row>
      );
      expect(screen.getByText("Cell 1")).toBeInTheDocument();
      expect(screen.getByText("Cell 2")).toBeInTheDocument();
    });
  });

  describe("Cell", () => {
    it("renders children", () => {
      render(<Cell>Cell content</Cell>);
      expect(screen.getByText("Cell content")).toBeInTheDocument();
    });
  });

  describe("SmallCell", () => {
    it("renders children", () => {
      render(<SmallCell>Small cell</SmallCell>);
      expect(screen.getByText("Small cell")).toBeInTheDocument();
    });
  });

  describe("HtmlTable / HtmlTh / HtmlTd / HtmlTr", () => {
    it("renders a complete table structure with header and data cells", () => {
      render(
        <HtmlTable>
          <thead>
            <HtmlTr>
              <HtmlTh>Name</HtmlTh>
              <HtmlTh>Status</HtmlTh>
            </HtmlTr>
          </thead>
          <tbody>
            <HtmlTr>
              <HtmlTd>test-run-01</HtmlTd>
              <HtmlTd>passed</HtmlTd>
            </HtmlTr>
          </tbody>
        </HtmlTable>
      );
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("test-run-01")).toBeInTheDocument();
      expect(screen.getByText("passed")).toBeInTheDocument();
    });

    it("renders HtmlTh as a th element", () => {
      render(
        <HtmlTable>
          <thead>
            <HtmlTr>
              <HtmlTh>Column Header</HtmlTh>
            </HtmlTr>
          </thead>
        </HtmlTable>
      );
      const header = screen.getByText("Column Header");
      expect(header.tagName.toLowerCase()).toBe("th");
    });

    it("renders HtmlTd as a td element", () => {
      render(
        <HtmlTable>
          <tbody>
            <HtmlTr>
              <HtmlTd>Cell Data</HtmlTd>
            </HtmlTr>
          </tbody>
        </HtmlTable>
      );
      const cell = screen.getByText("Cell Data");
      expect(cell.tagName.toLowerCase()).toBe("td");
    });

    it("renders HtmlTr as a tr element", () => {
      const { container } = render(
        <HtmlTable>
          <tbody>
            <HtmlTr>
              <HtmlTd>row data</HtmlTd>
            </HtmlTr>
          </tbody>
        </HtmlTable>
      );
      const rows = container.querySelectorAll("tr");
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
