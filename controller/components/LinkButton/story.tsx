import { GlobalStyle } from "../Layout";
import LinkButton from ".";
import React from "react";

export default {
  title: "LinkButton"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <LinkButton href="/">Some children</LinkButton>
  </React.Fragment>
);

export const Larger = () => (
  <React.Fragment>
    <GlobalStyle />
    <LinkButton
      href="/"
      theme={{ buttonFontSize: "1.25rem", buttonWidth: "200px", buttonHeight: "50px" }}
    >
      Some children
    </LinkButton>
  </React.Fragment>
);
