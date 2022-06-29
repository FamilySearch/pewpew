import React from "react";
import styled from "styled-components";

export interface QuestionBubbleProps {
  text: string;
  href?: string;
}

const QuestionBubbleStyling = styled.span`
  .questionHover .questionHoverText {
    visibility: hidden;
    width: 120px;
    bottom: 100%;
    left: 50%;
    margin-left: -60px;
    background-color: black;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 5px 0;

    /* Position the tooltip */
    position: absolute;
    z-index: 1;
  }
  .questionHover:hover .questionHoverText {
    visibility: visible;
  }
  .questionHover {
    position: relative;
    display: inline-block;
  }
`;

export function QuestionBubble ({ text, href }: QuestionBubbleProps) {
  return (
    <QuestionBubbleStyling>
    {href && <span style={{marginRight: "8px"}} className="questionHover"><a href={href} target="_blank"><i style={{fontFamily: "Arial"}}>?</i></a><span className="questionHoverText">{text}</span></span>}
    {!href && <span style={{marginRight: "8px"}} className="questionHover"><i style={{fontFamily: "Arial"}}>?</i><span className="questionHoverText">{text}</span></span>}
    </QuestionBubbleStyling>
    );
}

export default QuestionBubble;