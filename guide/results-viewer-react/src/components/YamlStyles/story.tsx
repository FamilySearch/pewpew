import { Button, Checkbox, Div, Input, InputsDiv, Label, NonFlexSpan, Span } from ".";
import type { Meta, StoryFn } from "@storybook/react";
import { DeleteIcon } from "../Icons/DeleteIcon";
import { DisplayDivMain } from "../YamlWriterForm";
import { GlobalStyle } from "../Global";
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

export default {
  title: "YamlStyles"
} as Meta<typeof Input>;

export const Default: StoryFn = () => (
  <React.Fragment>
  <GlobalStyle />
  <DisplayDivMain>
    <InputsDiv>
      <Div>
      <Span>
        <Label htmlFor="testFor"> Here is a Label: </Label>
        <Input type="text" onChange={onChange}/>
        <Checkbox type="checkbox" id="testFor"/>
        <Button><DeleteIcon /></Button>
        </Span>
      </Div>
    </InputsDiv>
  </DisplayDivMain>
</React.Fragment>
);

export const _NonFlexSpan: StoryFn = () => (
  <React.Fragment>
  <GlobalStyle />
  <DisplayDivMain>
    <InputsDiv>
      <Div>
      <NonFlexSpan>
        <Label htmlFor="testFor"> Here is a Label: </Label>
        <Input type="text" onChange={onChange}/>
        <Checkbox type="checkbox" id="testFor"/>
        <Button><DeleteIcon /></Button>
      </NonFlexSpan>
      </Div>
    </InputsDiv>
  </DisplayDivMain>
</React.Fragment>
);

export const FilledAndChecked: StoryFn = () => (
  <React.Fragment>
  <GlobalStyle />
  <DisplayDivMain>
    <InputsDiv>
      <Div>
        <Span>
        <Label htmlFor="testFor"> Here is a Label: </Label>
        <Input type="text" onChange={onChange} value={"Here is an input"}/>
        <Checkbox type="checkbox" id="testFor" defaultChecked/>
        <Button><DeleteIcon /></Button>
        </Span>
      </Div>
    </InputsDiv>
  </DisplayDivMain>
</React.Fragment>
);

FilledAndChecked.story = {
  name: "Filled and Checked"
};
