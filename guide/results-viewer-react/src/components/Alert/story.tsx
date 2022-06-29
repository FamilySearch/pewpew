import { Alert, Danger, Info, Success, Warning } from ".";
import { GlobalStyle } from "../Global";
import React from "react";
import { storiesOf } from "@storybook/react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */

storiesOf("Alert", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <Alert>Alert</Alert>
    <Success>Success</Success>
    <Danger>Danger</Danger>
    <Warning>Warning</Warning>
    <Info>Info</Info>
  </React.Fragment>
));
