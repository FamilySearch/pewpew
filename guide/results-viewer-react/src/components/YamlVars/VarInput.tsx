import { Div, Label, Span} from "../YamlStyles";
import { DeleteIcon } from "../Icons/DeleteIcon";
import { PewPewVars } from "../../util/yamlwriter";
import { PewPewVarsStringType } from ".";
import QuestionBubble from "../YamlQuestionBubble";
import React from "react";


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
            <input
              type="text"
              style={{width: "130px"}}
              onChange={(event) => changeVars(pewpewVar, "name", event.target.value)}
              name={pewpewVar.id}
              value={pewpewVar.name}
              id="name"
            />
          </Span>
          <Span>
            <Label> Value: </Label>
            <QuestionBubble text="Required | value of variable"></QuestionBubble>
            <input
              type="text"
              style={{width: "130px"}}
              onChange={(event) => changeVars(pewpewVar, "value", event.target.value)}
              name={pewpewVar.id}
              value={pewpewVar.value}
              id="value"
            />
          </Span>
          <button id={pewpewVar.id} onClick={() => deleteVar(pewpewVar.id)}>
            <DeleteIcon style={{ height: "15px", width: "15px" }}/>
          </button>
        </Div>
    );
};

export default VarInput;