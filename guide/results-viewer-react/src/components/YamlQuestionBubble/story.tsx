import type { Meta, StoryFn } from "@storybook/react";
import { QuestionBubble, QuestionBubbleProps } from ".";
import { DisplayDivBody } from "../YamlWriterForm";
import { GlobalStyle } from "../Global";
import React from "react";


const props: QuestionBubbleProps = {
  text: "This is what the question bubble looks like",
  href: ""
};

const linkProps: QuestionBubbleProps = {
  text: "This question bubble links to the pew pew documentation",
  href: "https://familysearch.github.io/pewpew/"
};

export default {
  title: "YamlQuestionBubble"
} as Meta<typeof QuestionBubble>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivBody>
      <p style={{marginBottom: "100px"}}></p>
      <QuestionBubble {...props} ></QuestionBubble>
    </DisplayDivBody>
  </React.Fragment>
);

export const LinkedQuestionMark: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <DisplayDivBody>
      <p style={{marginBottom: "100px"}}></p>
      <QuestionBubble {...linkProps} ></QuestionBubble>
    </DisplayDivBody>
  </React.Fragment>
);
