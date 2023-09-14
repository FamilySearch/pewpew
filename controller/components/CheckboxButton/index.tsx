import Div from "../Div";
import React from "react";
import styled from "styled-components";

const CheckboxDiv = styled(Div)`
  flex-flow: row wrap;
  border: 1;
`;
const Label = styled.label`
  display: inline-block;
  border-radius: 6px;
  height: 40px;
  width: 30px;
  margin-right: 3px;
  line-height: 40px;
  text-align: center;
  cursor: pointer;
`;
const Input = styled.input`
  display: none!important;
  display: inline-block;
  border-radius: 6px;
  height: 40px;
  width: 30px;
  margin-right: 3px;
  line-height: 40px;
  text-align: center;
  cursor: pointer;
`;

/** Props passed in by the parent object */
export interface CheckboxButtonProps {
  /** Id used in the checkbox, and the text of the checkbox if text not provided */
  id: string;
  value: boolean;
  /** Text in the checkbox. Id will beused if not provided */
  text?: string;
  onClick: (event: React.MouseEvent<HTMLInputElement | HTMLLabelElement, MouseEvent>) => void;
}

export const CheckboxButton = ({
  id,
  value,
  text,
  onClick
}: CheckboxButtonProps) => {
  const style: React.CSSProperties = value ? { background: "#2AD705", color: "#ffffff" } : { background: "#dddddd", color: "black" };
  return (
    <CheckboxDiv>
      <Input id={id} type="checkbox" checked={value} onClick={onClick} onChange={() => {/* noop */}} style={style} />
      <Label style={style} htmlFor={id} onClick={onClick}>{text || id}</Label>
    </CheckboxDiv>
  );
};

export default CheckboxButton;
