import { Alert, Danger, Info, Success, Warning } from ".";
import { GlobalStyle } from "../Global";
import React from "react";

export default {
  title: "Alert",
  component: Alert
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <Alert>Alert</Alert>
    <Success>Success</Success>
    <Danger>Danger</Danger>
    <Warning>Warning</Warning>
    <Info>Info</Info>
  </React.Fragment>
);
