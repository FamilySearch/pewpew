import { DisplayDivBody, DisplayDivMain } from "../YamlWriterForm";
import { LoggerProps, Loggers, getDefaultLoggers } from ".";
import type { Meta, StoryFn } from "@storybook/react";
import { GlobalStyle } from "../Global";
import { PewPewLogger } from "../../util/yamlwriter";
import React from "react";

const props: LoggerProps = {
  addLogger: (newLogger: PewPewLogger) => {
    // eslint-disable-next-line no-console
    console.log("Adding logger", newLogger);
  },
  clearAllLoggers: () => {
    // eslint-disable-next-line no-console
    console.log("Removing all loggers");
  },
  deleteLogger: (loggerId: string) => {
    // eslint-disable-next-line no-console
    console.log("deleting logger " + loggerId);
  },
  changeLogger: (pewPewLogger: PewPewLogger) => {
    // eslint-disable-next-line no-console
    console.log("changing logger " + pewPewLogger.id, pewPewLogger);
  },
  loggers: []
};

const propsEmpty: LoggerProps = { ...props };

const propsLoaded: LoggerProps = { ...props,
  loggers: [
    { id: "0", name: "", select: [], where: "", to: "", pretty: false, limit: "", kill: false },
    ...getDefaultLoggers()
  ]
};

export default {
  title: "YamlLoggers"
} as Meta<typeof Loggers>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Loggers {...propsEmpty} ></Loggers>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);

export const Loaded: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Loggers {...propsLoaded} ></Loggers>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);
