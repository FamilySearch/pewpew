import FilesList, { FileListProps } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: FileListProps = {
  files: [],
  onClick: (clicVal: React.MouseEvent<HTMLButtonElement>) => {
    // eslint-disable-next-line no-console
    console.log("clicVal: ", clicVal);
  }
};
const propsLoaded: FileListProps = {
  ...props,
  files: [
    new File([], "File 1"),
    "String 1",
    new File([], "File 2"),
    "String 2",
    new File([], "File 3"),
    "String 3",
    new File([], "File 4"),
    "String 4",
    new File([], "File 5"),
    "String 5"
  ]
};

export default {
  title: "FilesList"
};

export const Empty = () => (
  <React.Fragment>
    <GlobalStyle />
    <FilesList {...props} />
  </React.Fragment>
);

export const Loaded = () => (
  <React.Fragment>
    <GlobalStyle />
    <FilesList {...propsLoaded} />
  </React.Fragment>
);
