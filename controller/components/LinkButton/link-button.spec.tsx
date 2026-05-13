vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock("../../src/clientutil", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/clientutil")>(),
  formatPageHref: (href: string) => href
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { LinkButton } from ".";
import React from "react";

describe("LinkButton", () => {
  describe("Rendering", () => {
    it("should render children inside the link", () => {
      render(<LinkButton href="/test">Click Me</LinkButton>);
      expect(screen.getByText("Click Me")).toBeInTheDocument();
    });

    it("should render an anchor element with the provided href", () => {
      render(<LinkButton href="/my-page">Go</LinkButton>);
      const links = screen.getAllByRole("link");
      expect(links.some((l) => l.getAttribute("href") === "/my-page")).toBe(true);
    });

    it("should render a button inside the anchor", () => {
      render(<LinkButton href="/test">My Button</LinkButton>);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });
  });

  describe("Name attribute", () => {
    it("should apply the name attribute to the button when provided", () => {
      render(<LinkButton href="/test" name="my-button">Label</LinkButton>);
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.name).toBe("my-button");
    });

    it("should not set name attribute when omitted", () => {
      render(<LinkButton href="/test">Label</LinkButton>);
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.name).toBeFalsy();
    });
  });

  describe("Target attribute", () => {
    it("should apply the target attribute to the anchor when provided", () => {
      render(<LinkButton href="/test" target="_blank">External</LinkButton>);
      const links = screen.getAllByRole("link");
      expect(links.some((l) => l.getAttribute("target") === "_blank")).toBe(true);
    });
  });

  describe("Title attribute", () => {
    it("should apply the title attribute to the anchor when provided", () => {
      render(<LinkButton href="/test" title="Page Title">Link</LinkButton>);
      const links = screen.getAllByRole("link");
      expect(links.some((l) => l.getAttribute("title") === "Page Title")).toBe(true);
    });
  });

  describe("onClick handler", () => {
    it("should call onClick when the button is clicked", () => {
      const onClick = vi.fn();
      render(<LinkButton href="/test" onClick={onClick}>Click</LinkButton>);
      fireEvent.click(screen.getByRole("button"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should not throw when onClick is not provided", () => {
      render(<LinkButton href="/test">No Handler</LinkButton>);
      expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
    });
  });

  describe("data-testid", () => {
    it("should apply data-testid to the anchor element", () => {
      render(<LinkButton href="/test" data-testid="my-link">Link</LinkButton>);
      expect(screen.getByTestId("my-link")).toBeInTheDocument();
    });
  });
});
