import { Cell, FlexTable, Row, SmallCell, TABLE, TD, TH, TR } from ".";
import { GlobalStyle } from "../Layout";
import React from "react";

export default {
  title: "Table"
};

export const FlexDefault = () => (
  <React.Fragment>
    <GlobalStyle />
    <FlexTable>
      <Row>
        <Cell>Cell 1</Cell>
        <Cell>Cell 2</Cell>
        <Cell>Cell 3</Cell>
      </Row>
      <Row>
        <Cell>Cell 4</Cell>
        <Cell>Cell 5</Cell>
        <Cell>Cell 6</Cell>
      </Row>
      <Row>
        <Cell>Cell 7</Cell>
        <Cell>Cell 8</Cell>
        <Cell>Cell 9</Cell>
      </Row>
    </FlexTable>
  </React.Fragment>
);

export const FlexWithSmall = () => (
  <React.Fragment>
    <GlobalStyle />
    <FlexTable>
      <Row>
        <Cell>Cell 1</Cell>
        <Cell>Cell 2</Cell>
        <SmallCell>SmallCell 3</SmallCell>
      </Row>
      <Row>
        <Cell>Cell 4</Cell>
        <Cell>Cell 5</Cell>
        <SmallCell>SmallCell 6</SmallCell>
      </Row>
      <Row>
        <Cell>Cell 7</Cell>
        <Cell>Cell 8</Cell>
        <SmallCell>SmallCell 9</SmallCell>
      </Row>
    </FlexTable>
  </React.Fragment>
);

export const Empty = () => (
  <React.Fragment>
    <GlobalStyle />
    <TABLE>
      <thead>
      <TR>
        <TH>Head 1</TH>
        <TH>Head 2</TH>
        <TH>Head 3</TH>
      </TR>
      </thead>
    </TABLE>
  </React.Fragment>
);

export const Full = () => (
  <React.Fragment>
    <GlobalStyle />
    <TABLE>
      <thead>
      <TR>
        <TH>Head 1</TH>
        <TH>Head 2</TH>
        <TH>Head 3</TH>
      </TR>
      </thead>
      <tbody>
      <TR>
        <TD>TD 1</TD>
        <TD>TD 2</TD>
        <TD>TD 3</TD>
      </TR>
      <TR>
        <TD>TD 4</TD>
        <TD>TD 5</TD>
        <TD>TD 6</TD>
      </TR>
      <TR>
        <TD>TD 7</TD>
        <TD>TD 8</TD>
        <TD>TD 9</TD>
      </TR>
      </tbody>
    </TABLE>
  </React.Fragment>
);
