import TestQueues, { QueueProps } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: QueueProps = {
  queueName: "unittests",
  onChange: (newVal: React.ChangeEvent<HTMLSelectElement>) => {
    // eslint-disable-next-line no-console
    console.log("newVal: ", newVal);
  },
  testQueues: {
    queue1: "name1",
    queue2: "name2",
    queue3: "name3",
    queue4: "name4",
    queue5: "name5"
  },
  loading: false,
  error: false
};
const propsLoading: QueueProps = { ...props, testQueues: {}, loading: true };
const propsError: QueueProps = { ...props, error: true };

export default {
  title: "TestQueues"
};

export const Loaded = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestQueues {...props} />
  </React.Fragment>
);

export const Loading = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestQueues {...propsLoading} />
  </React.Fragment>
);

export const Error = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestQueues {...propsError} />
  </React.Fragment>
);
