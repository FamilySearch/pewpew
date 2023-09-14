import CheckboxButton, { CheckboxButtonProps } from ".";
import Div from "../Div";
import { GlobalStyle } from "../Layout";
import React from "react";
import styled from "styled-components";

const WrapperDiv = styled(Div)`
  flex-flow: row wrap;
`;

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */
const props: CheckboxButtonProps = {
  id: "monday",
  value: false,
  text: "Mo",
  onClick: (newVal: React.MouseEvent<HTMLInputElement | HTMLLabelElement, MouseEvent>) => {
    // eslint-disable-next-line no-console
    console.log("newVal: ", newVal);
    // eslint-disable-next-line no-console
    console.log("newVal.target: ", newVal.target);
    // eslint-disable-next-line no-console
    console.log("newVal.type: ", newVal.type);
  }
};
const propsUnchecked: CheckboxButtonProps = { ...props, value: false };
const propsChecked: CheckboxButtonProps = { ...props, value: true };

export default {
  title: "CheckboxButton"
};

export const Unchecked = () => (
  <React.Fragment>
    <GlobalStyle />
    <CheckboxButton {...propsUnchecked} />
  </React.Fragment>
);

export const Checked = () => (
  <React.Fragment>
    <GlobalStyle />
    <CheckboxButton {...propsChecked} />
  </React.Fragment>
);

const weekMap: Map<string, boolean> = new Map<string, boolean>([
  ["Su", false],
  ["Mo", true],
  ["Tu", false],
  ["We", true],
  ["Th", false],
  ["Fr", true],
  ["Sa", false]
]);

export const Multiple = () => (
  <React.Fragment>
    <GlobalStyle />
    <WrapperDiv>
      {Array.from(weekMap.entries()).map(([name, value]: [string, boolean], index: number) => (
        <CheckboxButton
          key={index}
          id={name}
          value={value}
          // eslint-disable-next-line no-console
          onClick={() => console.log(name + " clicked")}
        />
      ))}
    </WrapperDiv>
  </React.Fragment>
);
