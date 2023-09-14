import Input, { Checkbox, Div, InputPropsText, InputsDiv, Label, NonFlexSpan, Span } from ".";
import { DisplayDivMain } from "../YamlWriterForm";
import { GlobalStyle } from "../Layout";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */

const onChange = () => {
  // eslint-disable-next-line no-console
  console.log("Change value of input");
};

const inputProps: InputPropsText = {
  type: "text",
  onChange,
  dataType: "this is a data type value"
};

export default {
  title: "YamlStyles"
};

export const Default = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <InputsDiv>
        <Div>
          <Span>
            <Label htmlFor="testFor"> Here is a Label: </Label>
            <Input {...inputProps} />
            <Checkbox type="checkbox" id="testFor" />
            <button>X</button>
          </Span>
        </Div>
      </InputsDiv>
    </DisplayDivMain>
  </React.Fragment>
);

export const _NonFlexSpan = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivMain>
      <InputsDiv>
        <Div>
          <NonFlexSpan>
            <Label htmlFor="testFor"> Here is a Label: </Label>
            <Input {...inputProps} />
            <Checkbox type="checkbox" id="testFor" />
            <button>X</button>
          </NonFlexSpan>
        </Div>
      </InputsDiv>
    </DisplayDivMain>
  </React.Fragment>
);

export const FilledAndChecked = {
  render: () => (
    <React.Fragment>
      <GlobalStyle />
      <DisplayDivMain>
        <InputsDiv>
          <Div>
            <Span>
              <Label htmlFor="testFor"> Here is a Label: </Label>
              <Input
                type="text"
                onChange={onChange}
                dataType="Example"
                value={"Here is an input"}
              />
              <Checkbox type="checkbox" id="testFor" defaultChecked />
              <button>X</button>
            </Span>
          </Div>
        </InputsDiv>
      </DisplayDivMain>
    </React.Fragment>
  ),

  name: "Filled and Checked"
};
