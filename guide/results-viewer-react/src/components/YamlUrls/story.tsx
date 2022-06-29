import { DisplayDivMain, UrlsDiv } from "../YamlWriterForm";
import { PewPewAPI, PewPewHeader } from "../../util/yamlwriter";
import React, { useState } from "react";
import Urls, { UrlProps, getDefaultHeaders } from ".";
import { GlobalStyle } from "../Global";
import { storiesOf } from "@storybook/react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Modal component.
 * Source: https://storybook.js.org
 */

 const props: UrlProps = {
  deleteUrl: (urlId: string) => {
    // eslint-disable-next-line no-console
    console.log("removing url " + urlId);
  },
  changeUrl: (pewpewUrl: PewPewAPI) => {
    // eslint-disable-next-line no-console
    console.log("changing url", pewpewUrl);
  },
  addHeaders: (urlId: string, newHeaders: PewPewHeader[]) => {
    // eslint-disable-next-line no-console
    console.log("adding headers to " + urlId, newHeaders);
  },
  deleteHeader: (urlId: string, headerId: string) => {
    // eslint-disable-next-line no-console
    console.log(`removing header ${headerId} from url ${urlId}`);
  },
  data: {
    id: "empty",
    url: "",
    hitRate: "",
    headers: [],
    method: "POST", authorization: null
  },
  authenticated: false,
  defaultHeaders: false
};

const propsLoaded: UrlProps = {
  ...props,
  data: {
    id: "loaded",
    url: "https://www.familysearch.org",
    hitRate: "1hpm",
    headers: [
      {id: "0", name : "Default Header", value: "Here is where default headers are. These next 3 are the only default. Authorization header only shows up when Authenticated button is selected"},
      ...getDefaultHeaders(true),
      {id: "1", name : "Har Header", value: "Here is where har headers would be"}
    ],
    method: "GET", authorization: null
  },
  authenticated: true,
  defaultHeaders: true
};

const TestComponent: React.FC = () => {
  const defaultState: PewPewAPI = {
    ...propsLoaded.data,
    url: "bad.url"
  };
  const [state, setState] = useState(defaultState);

  // Changes information about the given endpoint
  const changeUrl = (pewpewUrl: PewPewAPI) => {
    setState(pewpewUrl);
  };

  return <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <UrlsDiv>
        <Urls {...props} data={state} changeUrl={changeUrl} />
      </UrlsDiv>
    </DisplayDivMain>
  </React.Fragment>;
};

storiesOf("YamlUrls", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <UrlsDiv>
        <Urls {...props}></Urls>
      </UrlsDiv>
    </DisplayDivMain>
  </React.Fragment>
));

storiesOf("YamlUrls", module).add("Loaded", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <UrlsDiv>
        <Urls {...propsLoaded}></Urls>
      </UrlsDiv>
    </DisplayDivMain>
  </React.Fragment>
));

storiesOf("YamlUrls", module).add("Interactable", () => {
  return <TestComponent />;
  }
);
