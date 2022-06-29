import styled, { createGlobalStyle } from "styled-components";


export const GlobalStyle = createGlobalStyle`
  body {
    background-color: rgb(50, 50, 50);
    color: rgb(250, 250, 250);
    // https://familysearch.slack.com/archives/C09E2K6PL/p1577117592008900
    // https://www.youtube.com/watch?v=jVhlJNJopOQ
    // font-family: Papyrus,fantasy;
    font-family: sans-serif;
    font-size: 1.25rem;
    line-height: 150%;
    text-align: center;
  }
  input, select, option, button, textarea {
    background-color: hsl(210, 25%, 8%);
    color: rgb(200, 200, 200);
    // font-family: Papyrus,fantasy;
    font-size: .9rem;
  }
  ul {
    text-align: left;
  }
  a {
    color: lightblue;
  }
  a:visited {
    color: magenta;
  }
`;

export const ScreenWidthDiv = styled.div`
  min-height: 93vh;
  min-width: 93vh;
`;
