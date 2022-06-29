import styled from "styled-components";

export const Div = styled.div`
  display: flex;
  vertical-align: middle;
  align-content: start;
  text-align: center;
  justify-content: center;
  padding: 1px;
  /* border-width: 1px;
  border-style: solid;
  border-color: white; */
`;

export const Row = styled(Div)`
  flex-flow: row wrap;
  flex: initial;
`;
export const Column = styled(Div)`
  flex-flow: column;
  flex: 1;
  text-align: center;
  justify-content: flex-start;
`;

/**
 * Left Div (content-align: right)
 */
export const DivLeft = styled(Div)`
  text-align: right;
  justify-content: right;
`;

/**
 * Right Div (content-align: left)
 */
 export const DivRight = styled(Div)`
  text-align: left;
  justify-content: left;
`;
