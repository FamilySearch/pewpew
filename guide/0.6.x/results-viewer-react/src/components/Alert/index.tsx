import { Div } from "../Div";
import styled from "styled-components";

export const Alert = styled(Div)`
  padding: .75rem 1.25rem;
  border: 1px solid;
  border-radius: .25rem;
  margin-bottom: .5rem;
  margin-top: .5rem;
`;

export const Success = styled(Alert)`
  color: rgb(168, 234, 183);
  background-color: rgb(23, 54, 30);
  border-top-color: rgb(41, 99, 54);
  border-right-color: rgb(41, 99, 54);
  border-bottom-color: rgb(41, 99, 54);
  border-left-color: rgb(41, 99, 54);
`;

export const Danger = styled(Alert)`
  color: rgb(230, 155, 162);
  background-color: rgb(64, 11, 16);
  border-top-color: rgb(129, 23, 34);
  border-right-color: rgb(129, 23, 34);
  border-bottom-color: rgb(129, 23, 34);
  border-left-color: rgb(129, 23, 34);
`;

export const Warning = styled(Alert)`
  color: rgb(251, 219, 127);
  background-color: rgb(81, 62, 0);
  border-top-color: rgb(167, 126, 0);
  border-right-color: rgb(167, 126, 0);
  border-bottom-color: rgb(167, 126, 0);
  border-left-color: rgb(167, 126, 0);
`;

export const Info = styled(Alert)`
  color: rgb(156, 230, 243);
  background-color: rgb(18, 54, 60);
  border-top-color: rgb(34, 101, 112);
  border-right-color: rgb(34, 101, 112);
  border-bottom-color: rgb(34, 101, 112);
  border-left-color: rgb(34, 101, 112);
`;

export default Alert;
