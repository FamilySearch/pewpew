import "../../pages/styles.css";
import { EventApi, EventInput, ViewApi } from "@fullcalendar/core";
import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { CalendarProps } from ".";
import { GlobalStyle } from "../Layout";
import dynamic from "next/dynamic";

const FullCalendar = dynamic(() => import("."), {
  ssr: false
});

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: CalendarProps = {
  initialView: "timeGridWeek"
};

let idCounter = 0;
interface CalendarState {
  events: EventInput[];
  error?: string;
}
const start: number = new Date().setMinutes(0);
const event: EventInput = {
  id: "" + idCounter++,
  title: "Test Event",
  // date: new Date(),
  start
};
const ONE_HOUR: number = 60 * 60000;
const currentEvent: EventInput = { ...event, color: "purple", title: "Running Test" };
const yesterdayEvent: EventInput = {
  ...event,
  id: "" + idCounter++,
  start: start - 25 * ONE_HOUR,
  color: "green",
  title: "Passed Test"
};
const yesterdayFailedEvent: EventInput = {
  ...event,
  id: "" + idCounter++,
  start: start - 23 * ONE_HOUR,
  color: "red",
  title: "Failed Test"
};
const tomorrowEvent: EventInput = {
  ...event,
  id: "" + idCounter++,
  start: start + 23.5 * ONE_HOUR,
  title: "Future Test"
};
const startRecur: number = start + 2 * ONE_HOUR;
const recurringEventLocal: EventInput = {
  title: "Recurring Event Local",
  id: "" + idCounter++,
  start: undefined,
  startRecur,
  startTime: new Date(startRecur).toTimeString().split(" ")[0],
  daysOfWeek: [1, 3, 5]
};
const recurringEventServer: EventInput = {
  title: "Recurring Event Server",
  id: "" + idCounter++,
  start: undefined,
  startRecur: startRecur + ONE_HOUR,
  startTime: new Date(startRecur + 6 * ONE_HOUR).toTimeString().split(" ")[0],
  daysOfWeek: [1, 3, 5]
};

// Test case for event that crosses midnight (like 23:30 to 00:30)
// Simulates what the server sends: startRecur timestamp + testRunTimeMn
const midnightCrossingStartTime = new Date();
midnightCrossingStartTime.setHours(23, 30, 0, 0);
const recurringEventCrossesMidnight: EventInput = {
  title: "Crosses Midnight",
  id: "" + idCounter++,
  start: undefined,
  startRecur: midnightCrossingStartTime.getTime(),
  testRunTimeMn: 120, // 120 minute duration
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6] // Every day
};

const propsLoaded: CalendarProps = {
  ...props,
  events: [
    currentEvent,
    yesterdayEvent,
    yesterdayFailedEvent,
    tomorrowEvent,
    recurringEventLocal,
    recurringEventServer,
    recurringEventCrossesMidnight
  ]
};

const TestComponent: React.FC = () => {
  const defaultState: CalendarState = {
    events: []
  };
  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<CalendarState>) =>
    setState((oldState: CalendarState) => ({ ...oldState, ...newState }));
  const addEvent = (newEvent: EventInput) =>
    setState((oldState: CalendarState) => ({
      ...oldState,
      events: [...oldState.events, newEvent],
      error: undefined
    }));
  const deleteEvent = (removeEvent: EventApi) =>
    setState((oldState: CalendarState) => {
      const oldEvents: EventInput[] = [...oldState.events];
      const index = oldEvents.findIndex((value: EventInput) => value.id === removeEvent.id);
      if (index >= 0) {
        oldEvents.splice(index, 1);
      }
      return { ...oldState, events: oldEvents, error: undefined };
    });

  const handleDateClick = (arg: {
    date: Date;
    dateStr: string;
    allDay: boolean;
    resource?: any;
    dayEl: HTMLElement;
    jsEvent: MouseEvent;
    view: ViewApi;
  }) => {
    // eslint-disable-next-line no-console
    console.log(arg.date, arg.dateStr, arg.allDay, arg.resource);
    updateState({ error: undefined });
    const eventId: number = idCounter++;
    const newEvent: EventInput = {
      id: "" + eventId,
      allDay: arg.allDay
    };
    if (arg.jsEvent.altKey || arg.jsEvent.shiftKey) {
      newEvent.title = "Recurring Event " + eventId;
      newEvent.startTime = arg.date.toTimeString().split(" ")[0];
      // newEvent.endTime = arg.date.toTimeString().split(" ")[0];
      newEvent.startRecur = arg.date;
      newEvent.endRecur = new Date(arg.date.getTime() + 30 * 24 * ONE_HOUR);
      newEvent.daysOfWeek = [];
      if (arg.jsEvent.altKey) {
        newEvent.daysOfWeek.push(2, 4);
      }
      if (arg.jsEvent.shiftKey) {
        newEvent.daysOfWeek.push(1, 3, 5);
      }
      if (arg.jsEvent.altKey && arg.jsEvent.shiftKey) {
        newEvent.daysOfWeek.push(0, 6);
      }
    } else {
      newEvent.title = "Test Event " + eventId;
      newEvent.date = arg.date.getTime();
      if (newEvent.date < Date.now()) {
        if (newEvent.date < Date.now() - ONE_HOUR) {
          newEvent.color = Math.random() >= 0.5 ? "red" : "green";
        } else {
          newEvent.color = "purple";
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(newEvent);
    addEvent(newEvent);
  };

  const handleEventClick = (arg: {
    el: HTMLElement;
    event: EventApi;
    jsEvent: MouseEvent;
    view: ViewApi;
  }): boolean | void => {
    // eslint-disable-next-line no-console
    console.log(event);
    updateState({ error: undefined });
    deleteEvent(arg.event);
  };

  return (
    <React.Fragment>
      <GlobalStyle />
      <FullCalendar
        {...props}
        events={state.events}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
      />
    </React.Fragment>
  );
};

const meta: Meta<typeof FullCalendar> = {
  title: "Calendar",
  component: FullCalendar
};
export default meta;

export const Interactable: StoryObj<typeof FullCalendar> = {
  render: () => {
    return <TestComponent />;
  }
};

export const Loaded: StoryObj<typeof FullCalendar> = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <FullCalendar {...propsLoaded} />
    </React.Fragment>
  )
};
