import { YamlWriterForm, YamlWriterFormProps } from ".";
import { GlobalStyle } from "../Global";
import React from "react";
import { storiesOf } from "@storybook/react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Modal component.
 * Source: https://storybook.js.org
 */

 const props: YamlWriterFormProps = {
  clearParentEndpoints: () => {
    // eslint-disable-next-line no-console
    console.log("clearing parent endpoints");
  },
  parentEndpoints: []
};

storiesOf("YamlWriterForm", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlWriterForm {...props}></YamlWriterForm>
  </React.Fragment>
  ));