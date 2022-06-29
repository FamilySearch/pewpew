import QuestionBubble, { QuestionBubbleProps } from ".";
import { DisplayDivBody } from "../YamlWriterForm";
import { GlobalStyle } from "../Global";
import React from "react";
import { storiesOf } from "@storybook/react";


const props: QuestionBubbleProps = {
  text: "This is what the question bubble looks like",
  href: ""
};

const linkProps: QuestionBubbleProps = {
  text: "This question bubble links to the pew pew documentation",
  href: "https://familysearch.github.io/pewpew/"
};

storiesOf("YamlQuestionBubble", module).add("Default", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivBody>
      <p style={{marginBottom: "100px"}}></p>
      <QuestionBubble {...props} ></QuestionBubble>
    </DisplayDivBody>
  </React.Fragment>
));

storiesOf("YamlQuestionBubble", module).add("Linked Question Mark", () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivBody>
      <p style={{marginBottom: "100px"}}></p>
      <QuestionBubble {...linkProps} ></QuestionBubble>
    </DisplayDivBody>
  </React.Fragment>
));
