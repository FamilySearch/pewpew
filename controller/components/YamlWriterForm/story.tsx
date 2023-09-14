import { YamlWriterForm, YamlWriterFormProps } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

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

export default {
  title: "YamlWriterForm"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlWriterForm {...props}></YamlWriterForm>
  </React.Fragment>
);
