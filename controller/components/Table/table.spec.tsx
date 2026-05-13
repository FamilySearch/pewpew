import { Cell, FlexTable, Row, SmallCell, TABLE, TD, TH, TR } from ".";
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

  describe("TABLE / TH / TD / TR", () => {
    it("renders a complete table structure with header and data cells", () => {
      render(
        <TABLE>
          <thead>
            <TR>
              <TH>Name</TH>
              <TH>Status</TH>
            </TR>
          </thead>
          <tbody>
            <TR>
              <TD>test-run-01</TD>
              <TD>passed</TD>
            </TR>
          </tbody>
        </TABLE>
      );
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("test-run-01")).toBeInTheDocument();
      expect(screen.getByText("passed")).toBeInTheDocument();
    });

    it("renders TH as a th element", () => {
      render(
        <TABLE>
          <thead>
            <TR>
              <TH>Column Header</TH>
            </TR>
          </thead>
        </TABLE>
      );
      const header = screen.getByText("Column Header");
      expect(header.tagName.toLowerCase()).toBe("th");
    });

    it("renders TD as a td element", () => {
      render(
        <TABLE>
          <tbody>
            <TR>
              <TD>Cell Data</TD>
            </TR>
          </tbody>
        </TABLE>
      );
      const cell = screen.getByText("Cell Data");
      expect(cell.tagName.toLowerCase()).toBe("td");
    });

    it("renders TR as a tr element", () => {
      const { container } = render(
        <TABLE>
          <tbody>
            <TR>
              <TD>row data</TD>
            </TR>
          </tbody>
        </TABLE>
      );
      const rows = container.querySelectorAll("tr");
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
