import { DisplayDivBody, DisplayDivMain } from "../YamlWriterForm";
import type { Meta, StoryFn } from "@storybook/react";
import { Vars, VarsProps} from ".";
import { GlobalStyle } from "../Global";
import { PewPewVars } from "../../util/yamlwriter";
import React from "react";

const props: VarsProps = {
  addVar: (newVar: PewPewVars) => {
    // eslint-disable-next-line no-console
    console.log("Adding variable input", newVar);
  },
  clearAllVars: () => {
    // eslint-disable-next-line no-console
    console.log("Removing all variables");
  },
  deleteVar: (varId: string) => {
    // eslint-disable-next-line no-console
    console.log("deleting variable: " + varId);
  },
  changeVar: (pewpewVar: PewPewVars) => {
    // eslint-disable-next-line no-console
    console.log("changing variable: " + pewpewVar.id, pewpewVar);
  },
  authenticated: false,
  setAuthenticated: (authenticated: boolean) => {
    // eslint-disable-next-line no-console
    console.log("Setting authenticated to: " + authenticated);
  },
  vars: []
};

const propsLoaded: VarsProps = { ...props,
  authenticated: true,
  vars: [
    { id: "0", name: "", value: "" },
    { id: "sessionId", name: "sessionId", value: "${SESSIONID}" },
    { id: "rampTime", name: "rampTime", value: "${RAMP_TIME}" },
    { id: "loadTime", name: "loadTime", value: "${LOAD_TIME}" },
    { id: "peakLoad", name: "peakLoad", value: "${PEAK_LOAD}" }
  ]
};

export default {
  title: "YamlVars"
} as Meta<typeof Vars>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Vars {...props} ></Vars>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);

export const Loaded: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Vars {...propsLoaded} ></Vars>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
);
