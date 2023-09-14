import { SmallCell as ButtonCell, Cell as TextCell } from "../Table";
import React from "react";
import styled from "styled-components";

// Make the Input stretch to the edges here.
export const Input = styled.input`
  flex: auto;
`;

// What this returns or calls from the parents
export interface EnvironmentVariableProps {
  name: string;
  variableName: string;
  variableValue: string;
  type: "text" | "password";
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const EnvironmentVariableItem = ({
  name,
  variableName,
  variableValue,
  type,
  onChange,
  onRemove
}: EnvironmentVariableProps) => {
  const isPassword = type === "password";
  let valueAutoComplete: string | undefined;
  if (isPassword || variableName?.toLowerCase().includes("password")) {
    valueAutoComplete = "current-password";
  } else if (variableName?.toLowerCase().includes("username")) {
    valueAutoComplete = "username";
  }
  return (
    <React.Fragment>
      <TextCell>
        <Input name={name + "_variableName"} value={variableName} type="text" onChange={onChange} required placeholder={isPassword ? "PASSWORD" : undefined} autoComplete={type === "password" ? "variable-name" : undefined}/>
      </TextCell>
      <TextCell className="env-var-div">
        <Input name={name + "_variableValue"} value={variableValue} type={type} onChange={onChange} autoComplete={valueAutoComplete}/>
      </TextCell>
      <ButtonCell>
        <Input name={name + "_type"} type="checkbox" checked={isPassword} onChange={onChange} title={isPassword ? "Value will be hidden and not saved in S3" : undefined} />
      </ButtonCell>
      <ButtonCell>
        <button name={name} onClick={onRemove} title="Delete this value">X</button>
      </ButtonCell>
    </React.Fragment>
  );
};

export default EnvironmentVariableItem;
