import {
  SmallCell as ButtonCell,
  FlexTable,
  Row,
  Cell as TextCell
} from "../Table";
import { LogLevel, log } from "../../src/log";
import Div from "../Div";
import { EnvironmentVariableItem } from "../EnvironmentVariableItem";
import React from "react";
import { Warning } from "../Alert";
import styled from "styled-components";

const EnvironmentVariablesDiv = styled(Div)`
  flex-flow: column;
`;

const AddVariableButton = styled.button`
  width: 200px;
  height: 25px;
  text-align: center;
  margin: 1em;
`;

// What this returns or calls from the parents
// We can't use the interface EnvironmentVariables beceause we may not have unique keys here
export interface EnvironmentVariablesProps {
  environmentVariables: EnvironmentVariablesState[];
  onAddOrUpdate: (environmentVariable: EnvironmentVariablesUpdate) => void;
  onRemove: (name: string) => void;
}

// What this returns or calls from the parents
export interface EnvironmentVariablesState {
  name: string;
  variableName: string;
  variableValue: string;
  type: "text" | "password";
}

// Updates that will only update one item
export interface EnvironmentVariablesUpdate {
  name: string;
  variableName?: string;
  variableValue?: string;
  type?: "text" | "password";
}

export const EnvironmentVariablesList = ({
  environmentVariables,
  onAddOrUpdate,
  onRemove
}: EnvironmentVariablesProps) => {

  const addItemHandler = () => {
    log("addItemHandler clicked", LogLevel.DEBUG);
    onAddOrUpdate({ name: `newVar${Date.now()}`, variableName: "", variableValue: "", type: "text" });
  };

  const removeItemHandler = (event: React.MouseEvent<HTMLButtonElement>) => {
    const button: HTMLButtonElement = event.target as HTMLButtonElement;
    const name: string | undefined = button.name;
    if (name) {
      onRemove(name);
    }
  };

  const updateItemHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input: HTMLInputElement = event.target as HTMLInputElement;
    const parts = input.name.split("_");
    if (parts && parts.length === 2) {
      const [name, what] = parts;
      const newVar: EnvironmentVariablesUpdate = { name };
      if (newVar) {
        // We don't know which of these was updated
        switch (what) {
          case "variableName":
            newVar.variableName = input.value;
            break;
          case "variableValue":
            newVar.variableValue = input.value;
            break;
          case "type":
            // Don't let it get unchecked, only check it
            if (input.checked) {
              newVar.type = "password";
            }
            break;
          default:
            log("Unknown input type", LogLevel.WARN, input);
            return;
        }
        onAddOrUpdate(newVar);
      } else {
        log("Could not parse input", LogLevel.WARN, { input, parts });
      }
    }
  };

  return (
    <EnvironmentVariablesDiv className="env-vars-div">
      <Div>
        <AddVariableButton name="addenv" onClick={addItemHandler}>Add Environment Variable</AddVariableButton>
      </Div>
      <br/>
      {environmentVariables.length > 0 && <>
        <Warning title="Use SessionIds only in production">Do Not Use Production Passwords!!!</Warning>
        <FlexTable>
          <Row>
            <TextCell>Name</TextCell>
            <TextCell>Value</TextCell>
            <ButtonCell title="Value will not be saved in S3">Hide</ButtonCell>
            <ButtonCell>Del</ButtonCell>
          </Row>
          {environmentVariables.map((environmentVariable: EnvironmentVariablesState) => (
            <Row key={"variablerow" + environmentVariable.name}>
              <EnvironmentVariableItem
                key={"variableitem" + environmentVariable.name}
                {...environmentVariable}
                onChange={updateItemHandler}
                onRemove={removeItemHandler}
              />
            </Row>
          ))}
        </FlexTable>
      </>}
    </EnvironmentVariablesDiv>
  );
};

export default EnvironmentVariablesList;
