vi.mock("next/link", async () => {
  const { cloneElement } = await import("react");
  return {
    default: ({ href, children, passHref, legacyBehavior, ...props }: any) => {
      if (legacyBehavior) {
        // Simulate passHref: Next.js clones the child and overrides its href with the Link's href prop,
        // stomping any explicitly-set href={formatPageHref(...)} on the child element.
        if (passHref) { return cloneElement(children, { href }); }
        return children;
      }
      return <a href={href} {...props}>{children}</a>;
    }
  };
});
vi.mock("../../src/clientutil", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/clientutil")>(),
  formatPageHref: vi.fn((href: string) => href)
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { LinkButton } from ".";
import React from "react";
import { formatPageHref } from "../../src/clientutil";

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

  describe("BASE_PATH behavior", () => {
    let realFormatPageHref: typeof formatPageHref;

    beforeAll(async () => {
      const actual = await vi.importActual<typeof import("../../src/clientutil")>("../../src/clientutil");
      realFormatPageHref = actual.formatPageHref;
    });

    beforeEach(() => {
      process.env["BASE_PATH"] = "/pewpew/load-test";
      window.history.pushState({}, "", "/pewpew/load-test/");
      vi.mocked(formatPageHref).mockImplementation(realFormatPageHref);
    });

    afterEach(() => {
      delete process.env["BASE_PATH"];
      window.history.pushState({}, "", "/");
      vi.mocked(formatPageHref).mockImplementation((href: string) => href);
    });

    it("should prepend BASE_PATH before the query string, preserving the trailing slash", () => {
      render(<LinkButton href={"/?testId=createtest20260513T201345733" as any}>Link</LinkButton>);
      const links = screen.getAllByRole("link");
      const hrefs = links.map((l) => l.getAttribute("href"));
      expect(hrefs).toContain("/pewpew/load-test/?testId=createtest20260513T201345733");
    });

    it("should prepend BASE_PATH to a plain path href", () => {
      render(<LinkButton href={"/admin" as any}>Link</LinkButton>);
      const links = screen.getAllByRole("link");
      const hrefs = links.map((l) => l.getAttribute("href"));
      expect(hrefs).toContain("/pewpew/load-test/admin");
    });
  });
});
