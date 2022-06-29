import Input, { Checkbox, Div, InputPropsText, InputsDiv, Label, NonFlexSpan, Span } from ".";
import { DisplayDivMain } from "../YamlWriterForm";
import { GlobalStyle } from "../Global";
import React from "react";
import { storiesOf } from "@storybook/react";

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

storiesOf("YamlStyles", module).add("Default", () => (
  <React.Fragment>
  <GlobalStyle />
  <DisplayDivMain>
    <InputsDiv>
      <Div>
      <Span>
        <Label htmlFor="testFor"> Here is a Label: </Label>
        <Input {...inputProps}/>
        <Checkbox type="checkbox" id="testFor"/>
        <button>X</button>
        </Span>
      </Div>
    </InputsDiv>
  </DisplayDivMain>
</React.Fragment>
));

storiesOf("YamlStyles", module).add("Non Flex Span", () => (
  <React.Fragment>
  <GlobalStyle />
  <DisplayDivMain>
    <InputsDiv>
      <Div>
      <NonFlexSpan>
        <Label htmlFor="testFor"> Here is a Label: </Label>
        <Input {...inputProps}/>
        <Checkbox type="checkbox" id="testFor"/>
        <button>X</button>
      </NonFlexSpan>
      </Div>
    </InputsDiv>
  </DisplayDivMain>
</React.Fragment>
));

storiesOf("YamlStyles", module).add("Filled and Checked", () => (
  <React.Fragment>
  <GlobalStyle />
  <DisplayDivMain>
    <InputsDiv>
      <Div>
        <Span>
        <Label htmlFor="testFor"> Here is a Label: </Label>
        <Input type="text" onChange={onChange} dataType="Example" value={"Here is an input"}/>
        <Checkbox type="checkbox" id="testFor" defaultChecked/>
        <button>X</button>
        </Span>
      </Div>
    </InputsDiv>
  </DisplayDivMain>
</React.Fragment>
));
