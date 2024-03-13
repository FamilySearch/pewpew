import type { Meta, StoryFn } from "@storybook/react";
import { GlobalStyle } from "../Layout";
import React from "react";
import Toaster from "./index";

export default {
  title: "Toaster",
  component: Toaster
} as Meta<typeof Toaster>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <Toaster id="toaster" message={"Type your message here: "}/>
  </React.Fragment>
);
