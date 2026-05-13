vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/interaction", () => ({ default: {} }));
vi.mock("@fullcalendar/react", () => ({ default: (_props: any) => <div data-testid="fullcalendar" /> }));
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }));
vi.mock("next/dynamic", () => ({ default: (_loader: any, _options?: any) => () => <div data-testid="dynamic-mock" /> }));
vi.mock("next/script", () => ({ default: () => null }));

import { render, screen } from "@testing-library/react";
import PPaaSCalendar from ".";
import React from "react";

describe("Calendar Component", () => {
  it("renders without crashing", () => {
    render(<PPaaSCalendar />);
    // With plugins mocked, the loading state renders initially
    expect(document.body).toBeTruthy();
  });

  it("renders loading placeholder before plugins load", () => {
    render(<PPaaSCalendar />);
    // Before useEffect fires plugins remain empty so loadingComponent renders
    expect(screen.getByText("Loading ...")).toBeInTheDocument();
  });

  it("renders with an events prop without throwing", () => {
    const events = [
      { id: "1", title: "Test Event", start: "2024-01-15T10:00:00", end: "2024-01-15T11:00:00" }
    ];
    render(<PPaaSCalendar events={events} />);
    expect(screen.getByText("Loading ...")).toBeInTheDocument();
  });

  it("renders with recurring events containing startRecur", () => {
    const events = [
      {
        id: "2",
        title: "Recurring Event",
        startRecur: Date.now(),
        testRunTimeMn: 60,
        url: "/test?testId=someId"
      }
    ];
    render(<PPaaSCalendar events={events} />);
    expect(screen.getByText("Loading ...")).toBeInTheDocument();
  });

  it("renders with no props (empty calendar)", () => {
    const { container } = render(<PPaaSCalendar />);
    expect(container).toBeTruthy();
  });
});
