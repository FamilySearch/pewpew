import {
  Column as ColumnInternal,
  Div as DivInternal,
  DivLeft as DivLeftInternal,
  DivRight as DivRightInternal,
  Row as RowInternal
} from ".";
import { GlobalStyle } from "../Global";
import React from "react";
import { storiesOf } from "@storybook/react";
import styled from "styled-components";
/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */

export const Div = styled(DivInternal)`
  border-width: 1px;
  border-style: solid;
  border-color: white;
`;

export const Column = styled(ColumnInternal)`
  border-width: 1px;
  border-style: solid;
  border-color: white;
`;

export const DivLeft = styled(DivLeftInternal)`
  border-width: 1px;
  border-style: solid;
  border-color: white;
`;

export const DivRight = styled(DivRightInternal)`
  border-width: 1px;
  border-style: solid;
  border-color: white;
`;

export const Row = styled(RowInternal)`
  border-width: 1px;
  border-style: solid;
  border-color: white;
`;

storiesOf("Div", module).add("Div", () => (
  <React.Fragment>
    <GlobalStyle />
    <Div>Some children</Div>
  </React.Fragment>
));

storiesOf("Div", module).add("Row", () => (
  <React.Fragment>
    <GlobalStyle />
    <Row>
      <Div>Some children</Div>
      <Div>Some children</Div>
      <Div>Some children</Div>
    </Row>
  </React.Fragment>
));

storiesOf("Div", module).add("Column", () => (
  <React.Fragment>
    <GlobalStyle />
    <Column>
      <Div>Some children</Div>
      <Div>Some children</Div>
      <Div>Some children</Div>
    </Column>
  </React.Fragment>
));

storiesOf("Div", module).add("DivLeftRight", () => (
  <React.Fragment>
    <GlobalStyle />
    <Row>
      <DivLeft>DivLeft</DivLeft>
      <Div>Div</Div>
      <DivRight>DivRight</DivRight>
    </Row>
    <Column>
      <DivLeft>DivLeft</DivLeft>
      <Div>Div</Div>
      <DivRight>DivRight</DivRight>
    </Column>
  </React.Fragment>
));
