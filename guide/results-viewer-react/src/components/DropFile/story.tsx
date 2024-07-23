import DropFile, { DropFileProps } from ".";
import type { Meta, StoryFn } from "@storybook/react";
import { GlobalStyle } from "../Global";
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
} as Meta<typeof DropFile>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DropFile {...props} />
  </React.Fragment>
);
