import { Button, Div, Input, Label, Span} from "../YamlStyles";
import React, { ChangeEvent } from "react";
import { DeleteIcon } from "../Icons/DeleteIcon";
import { PewPewVars } from "../../util/yamlwriter";
import { PewPewVarsStringType } from ".";
import QuestionBubble from "../YamlQuestionBubble";


interface VarInputProps {
    pewpewVar: PewPewVars;
    changeVars:(pewpewVar: PewPewVars, type: PewPewVarsStringType, value: string) => void;
    deleteVar: (varId: string) => void;
}

const VarInput = ({ pewpewVar, changeVars, deleteVar }: VarInputProps): JSX.Element => {

    return (
        <Div>
          <Span>
            <Label> Name: </Label>
            <QuestionBubble text="Required | name of variable"></QuestionBubble>
            <Input
              type="text"
              style={{width: "130px"}}
              onChange={(event: ChangeEvent<HTMLInputElement>) => changeVars(pewpewVar, "name", event.target.value)}
              name={pewpewVar.id}
              value={pewpewVar.name}
              id="name"
            />
          </Span>
          <Span>
            <Label> Value: </Label>
            <QuestionBubble text="Required | value of variable"></QuestionBubble>
            <Input
              type="text"
              style={{width: "130px"}}
              onChange={(event: ChangeEvent<HTMLInputElement>) => changeVars(pewpewVar, "value", event.target.value)}
              name={pewpewVar.id}
              value={pewpewVar.value}
              id="value"
            />
          </Span>
          <Button id={pewpewVar.id} onClick={() => deleteVar(pewpewVar.id)}>
            <DeleteIcon />
          </Button>
        </Div>
    );
};

export default VarInput;