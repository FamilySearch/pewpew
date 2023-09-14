import Div from "../Div";
import styled from "styled-components";

export const FlexTable = styled(Div)`
  flex-flow: column;
  display: flex;
  flex: auto;
`;

export const Row = styled(Div)`
  display: flex;
  flex-direction: row;
  width: 100%;
`;

// The normal cells should grow and shrink the same
export const Cell = styled(Div)`
  flex: 1 1 auto;
`;
// The checkbox and button should not grow or shrink
export const SmallCell = styled(Div)`
  flex: 0 0 10%;
`;

export const TABLE = styled.table`
  color: white;
  border-spacing: 0;
  background-color: grey;
`;

export const TH = styled.th`
  max-width: 150px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  padding: 5px;
  background-color: black;
`;

export const TD = styled.td`
  max-width: 150px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  padding: 5px;
  &:not(:first-child) {
    padding-left: 2em;
  };
  &:last-child {
    text-align: right;
  };
`;

export const TR = styled.tr`
  &:nth-child(even) {
    background: #474747;
  };
`;
