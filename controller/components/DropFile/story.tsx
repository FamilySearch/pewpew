import DropFile, { DropFileProps } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: DropFileProps = {
  onDropFile: (_filelist: File[]) => {
    // console.log("filelist: ", filelist);
    return Promise.resolve();
  }
};

export default {
  title: "DropFile"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <DropFile {...props} />
  </React.Fragment>
);
