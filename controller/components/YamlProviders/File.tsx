import { Div, Label, Span } from "../YamlStyles";
import { PewPewFileProvider, PewPewProvidersBooleanType, PewPewProvidersStringType, ProviderProps} from "./ProviderTypes";
import QuestionBubble from "../YamlQuestionBubble";
import React from "react";

interface FileProviderProps extends ProviderProps {
  data: PewPewFileProvider;
}

export function FileProvider ({ data, ...props }: FileProviderProps) {

  const handleClick = (type: PewPewProvidersBooleanType, newChecked: boolean) => {
    props.changeProvider({ ...data, [type]: newChecked });
  };

  const changeProvider = (type: PewPewProvidersStringType, value: string) => {
    props.changeProvider({ ...data, [type]: value });
  };

  const deleteSelf = () => {
    props.deleteProvider(data.id);
  };

  return (
      <Div>
        <Span>
          <Label> Name: </Label>
          <QuestionBubble text="Name of Provider"></QuestionBubble>
          <input type="text" style={{width: "130px"}} name={data.id} onChange={(event) => changeProvider("name", event.target.value)} value={data.name}/>
        </Span>
        <Span>
          <Label> File Path: </Label>
          <QuestionBubble text="Path to file | Can be file.csv or /file/"></QuestionBubble>
          <input type="text" style={{width: "130px"}} name={data.id} onChange={(event) => changeProvider("file", event.target.value)} value={data.file} />
        </Span>
        <Span>
          <Label> Repeat: </Label>
          <QuestionBubble text="Optional | Want repeat to be true"></QuestionBubble>
          <input style={{marginRight: "15px"}} type="checkbox" name={data.id} onChange={(event) => handleClick("repeat", event.target.checked)} checked={data.repeat}/>
        </Span>
        <Span>
          <Label> Random: </Label>
          <QuestionBubble text="Optional | Want repeat to be true"></QuestionBubble>
          <input style={{marginRight: "15px"}} type="checkbox" name={data.id} onChange={(event) => handleClick("random", event.target.checked)} checked={data.random}/>
        </Span>
        <button style={{marginLeft: "auto"}} id={data.id} onClick={deleteSelf}>X</button>
      </Div>
  );
}

export default FileProvider;
