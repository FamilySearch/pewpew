import { DisplayDivBody, DisplayDivMain } from "../YamlWriterForm";
import LoadPatterns, { LOAD_PATTERN, LoadPatternProps, RAMP_PATTERN } from ".";
import type { Meta, StoryFn } from "@storybook/react";
import { GlobalStyle } from "../Global";
import { PewPewLoadPattern } from "../../util/yamlwriter";
import React from "react";

const props: LoadPatternProps = {
  addPattern: (pewpewPattern: PewPewLoadPattern) => {
    // eslint-disable-next-line no-console
    console.log("Adding new LoadPattern", pewpewPattern);
  },
  deletePattern: (id: string) => {
    // eslint-disable-next-line no-console
    console.log("Removing LoadPattern " + id);
  },
  clearAllPatterns: () => {
    // eslint-disable-next-line no-console
    console.log("Removing all LoadPatterns");
  },
  changePattern: (pewpewPattern: PewPewLoadPattern) => {
    // eslint-disable-next-line no-console
    console.log("changing LoadPattern " + pewpewPattern.id, pewpewPattern);
  },
  patterns: [],
  vars: []
};

const propsDefault: LoadPatternProps = { ...props,
  patterns: [
    { id: RAMP_PATTERN, from: "10", to: "100", over: "15m" },
    { id: LOAD_PATTERN, from: "100", to: "100", over: "15m" }
  ]
};

const propsLoaded: LoadPatternProps = { ...props,
  patterns: [
    { id: "0", from: "10", to: "100", over: "15m" },
    { id: "1", from: "100", to: "100", over: "15m" },
    { id: "2", from: "", to: "", over: "" },
    { id: "3", from: "", to: "", over: "15m" },
    { id: "4", from: "10", to: "", over: "" },
    { id: "5", from: "", to: "100", over: "" },
    { id: "6", from: "", to: "100", over: "15m" },
    { id: "7", from: "10", to: "100", over: "5m" }
  ]
};

export default {
  title: "YamlLoadPatterns"
} as Meta<typeof LoadPatterns>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <LoadPatterns {...propsDefault} ></LoadPatterns>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);

export const Empty: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <LoadPatterns {...props} ></LoadPatterns>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);

export const Loaded: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <LoadPatterns {...propsLoaded} ></LoadPatterns>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);
