import {
  API_SCHEDULE,
  AuthPermission,
  AuthPermissions,
  PAGE_START_TEST,
  PAGE_TEST_HISTORY,
  TestManagerError
} from "../types";
import { Alert, Danger } from "../components/Alert";
import { EventApi, EventInput, ViewApi } from "@fullcalendar/core";
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult
} from "next";
import { H1, H3 } from "../components/Headers";
import { LogLevel, log } from "./api/util/log";
import { LogLevel as LogLevelServer, log as logServer } from "@fs/ppaas-common";
import React, { useState } from "react";
import axios, { AxiosResponse } from "axios";
import { formatError, formatPageHref, isTestManagerError } from "./api/util/clientutil";
import Div from "../components/Div";
import { GridView } from "../components/Calendar";
import Layout from "../components/Layout";
import { TestScheduler } from "./api/util/testscheduler";
import { authPage } from "./api/util/authserver";
import dynamic from "next/dynamic";
import styled from "styled-components";
import { useRouter } from "next/router";

const CalendarComponent = dynamic(
  () => import("../components/Calendar"),
  {
    ssr: false
  }
);

const Column = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;
// What this returns or calls from the parents
export interface CalendarPageProps {
  authPermission?: AuthPermission;
  scheduledEvents: EventInput[];
  defaultDate?: Date;
  defaultView?: GridView;
  error?: string;
}

// It's own data that will redraw the UI on changes
export interface CalendarPageState {
  error: string | undefined;
}

const CalendarPage = ({ authPermission, scheduledEvents, defaultDate, error: propsError, defaultView = "timeGridWeek" }: CalendarPageProps) => {
  const defaultState: CalendarPageState = {
    error: propsError
  };
  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<CalendarPageState>) => setState((oldState: CalendarPageState) => ({ ...oldState, ...newState}));
  const router = useRouter();

  const handleDateClick = (arg: {
    date: Date;
    dateStr: string;
    allDay: boolean;
    resource?: any;
    dayEl: HTMLElement;
    jsEvent: MouseEvent;
    view: ViewApi;
  }) => {
    updateState({ error: undefined });
    if (arg.jsEvent.shiftKey && arg.jsEvent.altKey && authPermission === AuthPermission.Admin) {
      return;
    }
    const url: string = PAGE_START_TEST + "?scheduleDate=" + arg.date.getTime();
    router.push(url, formatPageHref(url))
    .catch((error) => log("Could not Router.push to the schedule", LogLevel.ERROR, error));
  };

  const deleteEvent = async (testId: string) => {
    try {
      const response: AxiosResponse = await axios.delete(formatPageHref(API_SCHEDULE + "?testId=" + testId));
      log("Calendar delete response", LogLevel.DEBUG, response);
      if (!isTestManagerError(response.data)) {
        const errorString = API_SCHEDULE + " did not return a TestManagerError object";
        log(errorString, LogLevel.ERROR, response.data);
        throw new Error(errorString);
      }
      const responseData: TestManagerError = response.data;
      log("Calendar delete response", LogLevel.WARN, responseData);
      updateState({ error: `${testId} Event Deleted: ${responseData.message}` });
    } catch (error) {
      log("Calendar delete error", LogLevel.ERROR, error);
      updateState({ error: "Calendar Delete error: " + formatError(error) });
    }
  };

  const handleEventClick = (arg: {
    el: HTMLElement;
    event: EventApi;
    jsEvent: MouseEvent;
    view: ViewApi;
  }): boolean | void => {
    updateState({ error: undefined });
    if (arg.jsEvent.ctrlKey) {
      return undefined;
    }
    arg.jsEvent.preventDefault(); // Prevent default to avoid the url doing a second redirect
    const testId: string = arg.event.id;
    if (arg.jsEvent.shiftKey && arg.jsEvent.altKey && authPermission === AuthPermission.Admin) {
      if (confirm(`Would you like to delete ${testId}?`)) {
        deleteEvent(testId)
        .catch((error) => log("Could not deleteEvent from the schedule", LogLevel.ERROR, error, testId));
      }
      return undefined;
    }
    const url: string = (arg.event.start && arg.event.start.getTime() < Date.now()
        ? (PAGE_TEST_HISTORY + "?testId=")
        : (PAGE_START_TEST + "?edit&testId=")
      ) + testId;
    // We must use route.push "as" similar to our next/link
    router.push(url, formatPageHref(url))
    .catch((error) => log("Could not Router.push to the schedule", LogLevel.ERROR, error));
  };

  return (
    <Layout authPermission={authPermission}>
      <Column>
        <H1>Test Schedule</H1>
        <H3>Click on calendar to schedule a test</H3>
        {(state.error) && <Danger>{state.error}</Danger>}
        {authPermission === AuthPermission.Admin && <Alert>Admin Override: Delete from Schedule with Shift+Alt+Click</Alert>}
        <CalendarComponent
          initialView={defaultView}
          initialDate={defaultDate}
          events={scheduledEvents}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
        />
      </Column>
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps =
  async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<CalendarPageProps>> => {
  try {
    // Authenticate
    const authPermissions: AuthPermissions | string = await authPage(ctx, AuthPermission.ReadOnly);
    // If we have a authPermissions we're authorized, if we're not, we'll redirect
    if (typeof authPermissions === "string") {
      return {
        redirect: {
          destination: authPermissions,
          permanent: false
        },
        props: { scheduledEvents: [] }
      };
    }

    let defaultDate: Date | undefined;
    if (ctx.query.defaultDate && !Array.isArray(ctx.query.defaultDate)) {
      try {
        // If it's a timestamp we have to parse it into a number before passing it to new Date()
        const numberDate = Number(ctx.query.defaultDate);
        defaultDate = new Date(isNaN(numberDate) ? ctx.query.defaultDate : numberDate);
      } catch (error) {
        logServer("Error parsing date", LogLevelServer.WARN, error);
        defaultDate = undefined;
      }
    }

    const defaultView: GridView = ctx.query.defaultView && !Array.isArray(ctx.query.defaultView)
      ? ctx.query.defaultView as GridView
      : undefined;

    const scheduledEvents: EventInput[] = await TestScheduler.getCalendarEvents();
    logServer("scheduledEvents", LogLevelServer.DEBUG, scheduledEvents);

    return {
      props: { authPermission: authPermissions.authPermission, scheduledEvents, defaultDate, defaultView }
    };
  } catch (error) {
    logServer("Error loading permissions or schedule", LogLevelServer.ERROR, error);
    return {
      props: { scheduledEvents: [], error: `Error loading permissions or schedule: ${formatError(error)}` }
    };
  }
};

export default CalendarPage;
