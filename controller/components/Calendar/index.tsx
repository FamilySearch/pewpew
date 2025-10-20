import { CalendarOptions, PluginDef } from "@fullcalendar/core";
import { LogLevel, log } from "../../src/log";
import React, { useEffect, useState } from "react";
import { formatPageHref, getHourMinuteFromTimestamp } from "../../src/clientutil";
import Div from "../Div";
import Script from "next/script";
import dynamic from "next/dynamic";
import styled from "styled-components";

const CalendarDiv = styled(Div)`
`;

export type GridView = "timeGridDay" | "timeGridWeek" | "dayGridMonth" | undefined;

const loadingComponent = () => <div>Loading ...</div>;
const CalendarComponent = dynamic(() => import("@fullcalendar/react"), {
  ssr: false,
  loading: loadingComponent
});

// What this returns or calls from the parents
export type CalendarProps = CalendarOptions

/**
 * Wrapper to allow SSR: false loading of https://github.com/fullcalendar/fullcalendar-react/
 * https://github.com/fullcalendar/fullcalendar-react/issues/17
 * https://www.davidangulo.xyz/posts/how-to-use-fullcalendar-in-next-js/
 * @param props OptionsInput from @fullcalendar
 */
export const PPaaSCalendar = ({ ...calendarProps}: CalendarProps) => {
  const [plugins, setPlugins] = useState<PluginDef[]>([]);

  useEffect(() => {
    (async () => {
      const dayGrid = (await import("@fullcalendar/daygrid")).default;
      const timeGrid = (await import("@fullcalendar/timegrid")).default;
      const interaction = (await import("@fullcalendar/interaction")).default;

      setPlugins([dayGrid, timeGrid, interaction]);
    })();
  }, []);

  // Serverside until the useEffect fires
  if (plugins.length === 0) { return loadingComponent(); }

  // If there are any recurring events we need to format them to local time.
  // https://github.com/fullcalendar/fullcalendar/issues/5273
  // It has to be client rendered so we get the local browser time zone
  if (Array.isArray(calendarProps.events)) {
    for (const event of calendarProps.events) {
      if (typeof event.startRecur === "number") {
        event.startTime = getHourMinuteFromTimestamp(event.startRecur);
        if (typeof event.testRunTimeMn === "number") {
          const endTimestamp = event.startRecur + (60000 * event.testRunTimeMn);
          const calculatedEndTime = getHourMinuteFromTimestamp(endTimestamp);
          // If the event crosses midnight (endTime < startTime), use duration instead
          // FullCalendar has issues rendering recurring events that cross midnight with startTime/endTime
          // Using duration makes it explicit and works correctly
          if (calculatedEndTime < event.startTime) {
            // Use duration in format "HH:MM:SS" instead of endTime
            const hours = Math.floor(event.testRunTimeMn / 60);
            const minutes = event.testRunTimeMn % 60;
            event.duration = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
            event.endTime = undefined;
          } else {
            event.endTime = calculatedEndTime;
          }
        }
        log("Updated recurring event", LogLevel.DEBUG, event);
      }
      if (event.url && typeof event.url === "string") {
        // Fix old historical urls that didn't prepend /
        event.url = event.url.startsWith("/") ? event.url : ("/" + event.url);
        // Add the basePath if needed
        event.url = formatPageHref(event.url);
      }
    }
  }
  return (
    <CalendarDiv>
      {/* https://github.com/fullcalendar/fullcalendar/issues/7284#issuecomment-1563308360 */}
      <Script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.7/index.global.min.js" />
      <CalendarComponent
        plugins={plugins}
        initialView="timeGridWeek"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay"
        }}
        allDaySlot={false}
        navLinks={true}
        editable={true}
        dayMaxEventRows={true}
        nowIndicator={true}
        eventStartEditable={false}
        eventDurationEditable={false}
        contentHeight="auto"
        {...calendarProps}
      />
    </CalendarDiv>
  );
};

export default PPaaSCalendar;
