import { Alert, Danger, Info, Success, Warning } from ".";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("Alert Components", () => {
  describe("Alert (base)", () => {
    it("renders children", () => {
      render(<Alert>Base alert message</Alert>);
      expect(screen.getByText("Base alert message")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Alert>Check DOM</Alert>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Success", () => {
    it("renders children", () => {
      render(<Success>Operation succeeded</Success>);
      expect(screen.getByText("Operation succeeded")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Success>OK</Success>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Danger", () => {
    it("renders children", () => {
      render(<Danger>Something went wrong</Danger>);
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Danger>Error</Danger>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Warning", () => {
    it("renders children", () => {
      render(<Warning>Proceed with caution</Warning>);
      expect(screen.getByText("Proceed with caution")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Warning>Warn</Warning>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Info", () => {
    it("renders children", () => {
      render(<Info>For your information</Info>);
      expect(screen.getByText("For your information")).toBeInTheDocument();
    });

    it("renders in the DOM", () => {
      const { container } = render(<Info>Info</Info>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("data-testid support", () => {
    it("passes data-testid to Alert", () => {
      render(<Alert data-testid="my-alert">Testable</Alert>);
      expect(screen.getByTestId("my-alert")).toBeInTheDocument();
    });

    it("passes data-testid to Success", () => {
      render(<Success data-testid="success-alert">Win</Success>);
      expect(screen.getByTestId("success-alert")).toBeInTheDocument();
    });

    it("passes data-testid to Danger", () => {
      render(<Danger data-testid="danger-alert">Fail</Danger>);
      expect(screen.getByTestId("danger-alert")).toBeInTheDocument();
    });

    it("passes data-testid to Warning", () => {
      render(<Warning data-testid="warning-alert">Caution</Warning>);
      expect(screen.getByTestId("warning-alert")).toBeInTheDocument();
    });

    it("passes data-testid to Info", () => {
      render(<Info data-testid="info-alert">Note</Info>);
      expect(screen.getByTestId("info-alert")).toBeInTheDocument();
    });
  });
});
