vi.mock("../../src/authclient", () => ({
  logout: vi.fn()
}));
vi.mock("../../src/runtimeConfig", () => ({
  useRuntimeConfig: () => ({ HIDE_ENVIRONMENT: "" })
}));
vi.mock("next/head", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));

import { render, screen } from "@testing-library/react";
import { AuthPermission } from "../../types";
import Layout from ".";
import React from "react";

describe("Layout Component", () => {
  it("renders children", () => {
    render(
      <Layout authPermission={AuthPermission.User}>
        <div data-testid="child-content">Hello World</div>
      </Layout>
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("renders nav links for New Test, Test History, Calendar, Yaml Creator", () => {
    render(
      <Layout authPermission={AuthPermission.User}>
        <span>content</span>
      </Layout>
    );
    expect(screen.getByTestId("nav-new-test")).toBeInTheDocument();
    expect(screen.getByTestId("nav-test-history")).toBeInTheDocument();
    expect(screen.getByTestId("nav-calendar")).toBeInTheDocument();
    expect(screen.getByTestId("nav-logout")).toBeInTheDocument();
    expect(screen.getByText("Yaml Creator")).toBeInTheDocument();
  });

  it("hides admin link when authPermission is not Admin", () => {
    render(
      <Layout authPermission={AuthPermission.User}>
        <span>content</span>
      </Layout>
    );
    expect(screen.queryByTestId("nav-admin")).not.toBeInTheDocument();
  });

  it("shows admin link when authPermission is Admin", () => {
    render(
      <Layout authPermission={AuthPermission.Admin}>
        <span>content</span>
      </Layout>
    );
    expect(screen.getByTestId("nav-admin")).toBeInTheDocument();
  });

  it("renders a custom title via Head", () => {
    render(
      <Layout authPermission={undefined} title="My Custom Title">
        <span>content</span>
      </Layout>
    );
    // With next/head mocked the title tag renders inline
    const titleEl = document.querySelector("title");
    expect(titleEl?.textContent).toBe("My Custom Title");
  });

  it("renders the default title when no title prop is provided", () => {
    render(
      <Layout authPermission={undefined}>
        <span>content</span>
      </Layout>
    );
    const titleEl = document.querySelector("title");
    expect(titleEl?.textContent).toBe("PewPew as a Service - Run your load tests!");
  });

  it("hides admin link when authPermission is undefined", () => {
    render(
      <Layout authPermission={undefined}>
        <span>content</span>
      </Layout>
    );
    expect(screen.queryByTestId("nav-admin")).not.toBeInTheDocument();
  });

  it("renders other controllers when provided", () => {
    const otherControllers = {
      beta: { url: "https://beta.example.com", hover: "Beta Controller" }
    };
    render(
      <Layout authPermission={AuthPermission.User} otherControllers={otherControllers}>
        <span>content</span>
      </Layout>
    );
    expect(screen.getByTestId("nav-beta")).toBeInTheDocument();
  });
});
