import {
  EnvironmentVariablesList,
  EnvironmentVariablesProps,
  EnvironmentVariablesState,
  EnvironmentVariablesUpdate
} from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: EnvironmentVariablesProps = {
  environmentVariables: [],
  onAddOrUpdate: (newVal: EnvironmentVariablesUpdate) => {
    // eslint-disable-next-line no-console
    console.log("newVal: ", newVal);
  },
  onRemove: (name: string) => {
    // eslint-disable-next-line no-console
    console.log("name: ", name);
  }
};
const environmentVariable: EnvironmentVariablesState = {
  name: "1",
  variableName: "",
  variableValue: "",
  type: "text"
};
const propsLoaded: EnvironmentVariablesProps = {
  ...props,
  environmentVariables: [
    { ...environmentVariable },
    { ...environmentVariable, name: "2", variableName: "EMPTY_VAR", variableValue: "" },
    { ...environmentVariable, name: "3", variableName: "TEXT_VAR", variableValue: "Text Value" },
    {
      ...environmentVariable,
      name: "4",
      variableName: "EMPTY_PASSWORD",
      variableValue: "",
      type: "password"
    },
    {
      ...environmentVariable,
      name: "5",
      variableName: "PASSWORD",
      variableValue: "password",
      type: "password"
    }
  ]
};

export default {
  title: "EnvironmentVariableList"
};

export const Empty = () => (
  <React.Fragment>
    <GlobalStyle />
    <EnvironmentVariablesList {...props} />
  </React.Fragment>
);

export const Loaded = () => (
  <React.Fragment>
    <GlobalStyle />
    <form>
    <EnvironmentVariablesList {...propsLoaded} />
    </form>
  </React.Fragment>
);
