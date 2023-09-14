import { H1, H2, H3 } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

export default {
  title: "Headers"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <H1>Some H1 title</H1>
    <H2>Some H2 title</H2>
    <H3>Some H3 title</H3>
  </React.Fragment>
);
