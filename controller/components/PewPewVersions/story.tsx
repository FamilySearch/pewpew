import PewPewVersions, { VersionProps } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";
import { latestPewPewVersion } from "../../pages/api/util/clientutil";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: VersionProps = {
  pewpewVersion: latestPewPewVersion,
  onChange: (newVal: React.ChangeEvent<HTMLSelectElement>) => {
    // eslint-disable-next-line no-console
    console.log("newVal: ", newVal);
  },
  pewpewVersions: ["0.1.1", "0.1.2", "0.1.3", "0.1.4", "0.1.5", latestPewPewVersion, "0.1.6"],
  latestPewPewVersion : "latestVersion",
  loading: false,
  error: false
};
const propsLoading: VersionProps = { ...props, pewpewVersions: [], loading: true };
const propsError: VersionProps = { ...props, error: true };

export default {
  title: "PewPewVersions"
};

export const Loaded = () => (
  <React.Fragment>
    <GlobalStyle />
    <PewPewVersions {...props} />
  </React.Fragment>
);

export const Loading = () => (
  <React.Fragment>
    <GlobalStyle />
    <PewPewVersions {...propsLoading} />
  </React.Fragment>
);

export const Error = () => (
  <React.Fragment>
    <GlobalStyle />
    <PewPewVersions {...propsError} />
  </React.Fragment>
);
