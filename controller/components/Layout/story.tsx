import { Layout, OTHER_CONTROLLERS_DEFAULT, OtherControllers } from ".";
import { AuthPermission } from "../../types";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */

const NO_DEV: OtherControllers = { ...OTHER_CONTROLLERS_DEFAULT };
delete NO_DEV["Integration"];
const NO_TEST: OtherControllers = { ...OTHER_CONTROLLERS_DEFAULT };
delete NO_TEST["Beta"];
const NO_PROD: OtherControllers = { ...OTHER_CONTROLLERS_DEFAULT };
delete NO_PROD["Production"];

export default {
  title: "Layout"
};

export const Default = () => <Layout authPermission={undefined}>Some children</Layout>;

export const _Admin = () => <Layout authPermission={AuthPermission.Admin}>Some children</Layout>;

export const _User = () => <Layout authPermission={AuthPermission.User}>Some children</Layout>;

export const _ReadOnly = {
  render: () => <Layout authPermission={AuthPermission.ReadOnly}>Some children</Layout>,

  name: "ReadOnly"
};

export const DevController = () => (
  <Layout authPermission={undefined} otherControllers={NO_DEV}>
    Some children
  </Layout>
);

export const TestController = () => (
  <Layout authPermission={undefined} otherControllers={NO_TEST}>
    Some children
  </Layout>
);

export const ProdController = () => (
  <Layout authPermission={undefined} otherControllers={NO_PROD}>
    Some children
  </Layout>
);
