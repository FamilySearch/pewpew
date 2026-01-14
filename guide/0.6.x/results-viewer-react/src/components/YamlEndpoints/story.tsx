import { Endpoints, EndpointsProps } from ".";
import type { Meta, StoryFn } from "@storybook/react";
import { PewPewAPI, PewPewHeader } from "../../util/yamlwriter";
import { GlobalStyle } from "../Global";
import React from "react";
import { getDefaultHeaders } from "../YamlUrls";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Modal component.
 * Source: https://storybook.js.org
 */

const props: EndpointsProps = {
  addUrl: (pewpewUrl: PewPewAPI) => {
    // eslint-disable-next-line no-console
    console.log("Adding endpoint", pewpewUrl);
  },
  clearAllUrls: () => {
    // eslint-disable-next-line no-console
    console.log("Removing all endpoints");
  },
  deleteUrl: (urlId: string) => {
    // eslint-disable-next-line no-console
    console.log("deleting endpoint " + urlId);
  },
  changeUrl: (pewpewUrl: PewPewAPI) => {
    // eslint-disable-next-line no-console
    console.log("changing endpoint " + pewpewUrl.id, pewpewUrl);
  },
  addHeaders: (urlId: string, newHeaders: PewPewHeader[]) => {
   // eslint-disable-next-line no-console
   console.log("adding headers to " + urlId, newHeaders);
 },
 deleteHeader: (urlId: string, headerId: string) => {
   // eslint-disable-next-line no-console
   console.log(`removing header ${headerId} from url ${urlId}`);
 },
  defaultYaml: false,
  urls: [],
  authenticated: false,
  peakLoad: "1hpm"
};

const propsLoaded: EndpointsProps = {
  ...props,
  defaultYaml: true,
  authenticated: true,
  urls: [
    { id: "0", url: "https://www.pewpew.org/", headers: [...getDefaultHeaders(true), { id: "0", name: "header 0", value: "value 0" }], method: "", hitRate: "5hps", authorization: null },
    { id: "1", url: "badUrl", headers: [], method: "", hitRate: "10hps", authorization: null }
  ]
};

export default {
  title: "YamlEndpoints"
} as Meta<typeof Endpoints>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <Endpoints {...props}></Endpoints>
  </React.Fragment>
);

export const Loaded: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <Endpoints {...propsLoaded}></Endpoints>
  </React.Fragment>
);
