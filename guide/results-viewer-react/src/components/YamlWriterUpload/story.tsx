import { LogLevel, log } from "../../util/log";
import { YamlWriterUpload, YamlWriterUploadProps } from ".";
import { GlobalStyle } from "../Global";
import { HarEndpoint } from "../../util/yamlwriter";
import React from "react";
import { storiesOf } from "@storybook/react";

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

storiesOf("YamlWriterUpload", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlWriterUpload {...props}></YamlWriterUpload>
  </React.Fragment>
  ));