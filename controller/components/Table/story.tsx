import { Cell, FlexTable, HtmlTable, HtmlTd, HtmlTh, HtmlTr, Row, SmallCell } from ".";
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
    <HtmlTable>
      <thead>
      <HtmlTr>
        <HtmlTh>Head 1</HtmlTh>
        <HtmlTh>Head 2</HtmlTh>
        <HtmlTh>Head 3</HtmlTh>
      </HtmlTr>
      </thead>
    </HtmlTable>
  </React.Fragment>
);

export const Full = () => (
  <React.Fragment>
    <GlobalStyle />
    <HtmlTable>
      <thead>
      <HtmlTr>
        <HtmlTh>Head 1</HtmlTh>
        <HtmlTh>Head 2</HtmlTh>
        <HtmlTh>Head 3</HtmlTh>
      </HtmlTr>
      </thead>
      <tbody>
      <HtmlTr>
        <HtmlTd>HtmlTd 1</HtmlTd>
        <HtmlTd>HtmlTd 2</HtmlTd>
        <HtmlTd>HtmlTd 3</HtmlTd>
      </HtmlTr>
      <HtmlTr>
        <HtmlTd>HtmlTd 4</HtmlTd>
        <HtmlTd>HtmlTd 5</HtmlTd>
        <HtmlTd>HtmlTd 6</HtmlTd>
      </HtmlTr>
      <HtmlTr>
        <HtmlTd>HtmlTd 7</HtmlTd>
        <HtmlTd>HtmlTd 8</HtmlTd>
        <HtmlTd>HtmlTd 9</HtmlTd>
      </HtmlTr>
      </tbody>
    </HtmlTable>
  </React.Fragment>
);
