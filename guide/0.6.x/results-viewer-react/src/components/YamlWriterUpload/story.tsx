import { LogLevel, log } from "../../util/log";
import type { Meta, StoryFn } from "@storybook/react";
import { YamlWriterUpload, YamlWriterUploadProps } from ".";
import { GlobalStyle } from "../Global";
import { HarEndpoint } from "../../util/yamlwriter";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Modal component.
 * Source: https://storybook.js.org
 */

const props: YamlWriterUploadProps = {
  sendEndpoints: (endpoints: HarEndpoint[]) => {
    log("clearing parent endpoints", LogLevel.INFO, endpoints);
  }
};

export default {
  title: "YamlWriterUpload"
} as Meta<typeof YamlWriterUpload>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlWriterUpload {...props}></YamlWriterUpload>
  </React.Fragment>
);
