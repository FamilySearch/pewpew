import { EnvironmentVariableItem, EnvironmentVariableProps } from ".";
import { FlexTable, Row } from "../Table";
import { GlobalStyle } from "../Layout";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: EnvironmentVariableProps = {
  name: "empty",
  variableName: "",
  variableValue: "",
  type: "text",
  onChange: (newVal: React.ChangeEvent<HTMLInputElement>) => {
    // eslint-disable-next-line no-console
    console.log("newVal: ", newVal);
  },
  onRemove: (clicVal: React.MouseEvent<HTMLButtonElement>) => {
    // eslint-disable-next-line no-console
    console.log("clicVal: ", clicVal);
  }
};
const propsLoaded: EnvironmentVariableProps = {
  ...props,
  name: "loaded",
  variableName: "VARIABLE_NAME",
  variableValue: "variable value"
};
const propsEmptyPwd: EnvironmentVariableProps = { ...props, name: "emptypwd", type: "password" };
const propsLoadedPwd: EnvironmentVariableProps = {
  ...props,
  name: "loadedpwd",
  variableName: "VARIABLE_NAME",
  variableValue: "variable value",
  type: "password"
};
const propsNoUsername: EnvironmentVariableProps = {
  ...props,
  name: "nousername",
  variableName: "USERNAME"
};
const propsNoPassword: EnvironmentVariableProps = {
  ...props,
  name: "nopassword",
  variableName: "PASSWORD"
};

export default {
  title: "EnvironmentVariableItem"
};

export const EmptyText = () => (
  <React.Fragment>
    <GlobalStyle />
    <FlexTable>
      <Row>
        <EnvironmentVariableItem {...props} />
      </Row>
    </FlexTable>
  </React.Fragment>
);

export const LoadedText = () => (
  <React.Fragment>
    <GlobalStyle />
    <FlexTable>
      <Row>
        <EnvironmentVariableItem {...propsLoaded} />
      </Row>
    </FlexTable>
  </React.Fragment>
);

export const EmptyPassword = () => (
  <React.Fragment>
    <GlobalStyle />
    <form>
    <FlexTable>
      <Row>
        <EnvironmentVariableItem {...propsEmptyPwd} />
      </Row>
    </FlexTable>
    </form>
  </React.Fragment>
);

export const LoadedPassword = () => (
  <React.Fragment>
    <GlobalStyle />
    <form>
    <FlexTable>
      <Row>
        <EnvironmentVariableItem {...propsLoadedPwd} />
      </Row>
    </FlexTable>
    </form>
  </React.Fragment>
);

export const UsernameNotSet = () => (
  <React.Fragment>
    <GlobalStyle />
    <form>
    <FlexTable>
      <Row>
        <EnvironmentVariableItem {...propsNoUsername} />
      </Row>
    </FlexTable>
    </form>
  </React.Fragment>
);

export const PasswordNotSet = () => (
  <React.Fragment>
    <GlobalStyle />
    <form>
    <FlexTable>
      <Row>
        <EnvironmentVariableItem {...propsNoPassword} />
      </Row>
    </FlexTable>
    </form>
  </React.Fragment>
);
