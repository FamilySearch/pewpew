import { Alert, Danger, Info, Success, Warning } from ".";
import type { Meta, StoryFn } from "@storybook/react";
import { GlobalStyle } from "../Layout";
import React from "react";

export default {
  title: "Alert",
  component: Alert
} as Meta<typeof Alert>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <Alert>Alert</Alert>
    <Success>Success</Success>
    <Danger>Danger</Danger>
    <Warning>Warning</Warning>
    <Info>Info</Info>
  </React.Fragment>
);
