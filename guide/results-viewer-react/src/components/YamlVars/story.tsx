import { DEV_KEY_BETA, PewPewVars } from "../../util/yamlwriter";
import { DisplayDivBody, DisplayDivMain } from "../YamlWriterForm";
import { Vars, VarsProps} from ".";
import { GlobalStyle } from "../Global";
import React from "react";
import { storiesOf } from "@storybook/react";

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
  defaultYaml: false,
  authenticated: false,
  vars: []
};

const propsLoaded: VarsProps = { ...props,
  defaultYaml: true,
  authenticated: true,
  vars: [
    { id: "0", name: "", value: "" },
    { id: "sessionId", name: "sessionId", value: "${SESSIONID}" },
    { id: "rampTime", name: "rampTime", value: "${RAMP_TIME}" },
    { id: "loadTime", name: "loadTime", value: "${LOAD_TIME}" },
    { id: "peakLoad", name: "peakLoad", value: "${PEAK_LOAD}" },
    { id: "devKey", name: "devKey", value: DEV_KEY_BETA }
  ]
};

storiesOf("YamlVars", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Vars {...props} ></Vars>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
));

storiesOf("YamlVars", module).add("Loaded", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <DisplayDivBody>
        <Vars {...propsLoaded} ></Vars>
      </DisplayDivBody>
    </DisplayDivMain>
  </React.Fragment>
));
