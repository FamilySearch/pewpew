import React from "react";
import styled from "styled-components";

export const Div = styled.div`
  margin-top: 15px;
  display: flex;
  flex-direction: row;
`;
export const Label = styled.label`
  margin-right: 8px;
  display: flex;
  flex-direction: row;
`;
export const Span = styled.span`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  margin-right: 15px;
`;
export const NonFlexSpan = styled.span`
  display: flex;
  flex-direction: row;
  flex-wrap: no-wrap;
  align-items: center;
  margin-right: 15px;
`;
export const Checkbox = styled.input`
margin-right: 15px;
`;
export const InputsDiv = styled.div`
  display: inline-block;
  border-right: 2px solid black;
  border-bottom: 2px solid black;
  margin-right: 40px;
  padding-right: 40px;
  padding-bottom: 40px;
  padding-top: 5px;
  margin-bottom: 10px;
`;

export interface InputPropsText {
  style?: React.CSSProperties;
  id?: string;
  type: "text" | "number";
  name?: string;
  value?: string | number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>, type: string) => void;
  dataType: string;
  defaultValue?: number | string;
  min?: string;
  max?: string;
  defaultChecked?: boolean;
  title?: string;
}

export const Input = (props: InputPropsText) => {

  const changeInput = (event: React.ChangeEvent<HTMLInputElement>, type: string) => {
    props.onChange(event, type);
  };

  return (
    <input
      style={props.style}
      id={props.id}
      type={props.type}
      name={props.name}
      value={props.value}
      min={props.min}
      max={props.max}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => changeInput(event, props.dataType)}
      defaultValue={props.defaultValue}
      defaultChecked={props.defaultChecked}
      title={props.title}
    />
  );
};

export default Input;