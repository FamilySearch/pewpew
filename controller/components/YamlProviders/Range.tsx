import { Div, Label, Span} from "../YamlStyles";
import { PewPewProvidersNumberType, PewPewRangeProvider, ProviderProps } from "./ProviderTypes";
import QuestionBubble from "../YamlQuestionBubble";
import React from "react";

interface RangeProviderProps extends ProviderProps {
  data: PewPewRangeProvider;
}

export function RangeProvider ({ data, ...props }: RangeProviderProps) {
  const handleClick = (newChecked: boolean) => {
    props.changeProvider({ ...data, repeat: newChecked });
  };

  const changeProviderName = (value: string) => {
    props.changeProvider({ ...data, name: value });
  };

  const changeProviderNumber = (type: PewPewProvidersNumberType, value: string) => {
    props.changeProvider({ ...data, [type]: parseInt(value) });
  };

  const deleteProvider = () => {
    props.deleteProvider(data.id);
  };

  return (
      <Div>
        <Span>
          <Label> Name: </Label>
          <QuestionBubble text="Name of Provider"></QuestionBubble>
          <input style={{width: "130px"}} type="text" name={data.id} onChange={(event) => changeProviderName(event.target.value)} value={data.name} />
        </Span>
        <Span>
          <Label> Start: </Label>
          <QuestionBubble text="Starting value"></QuestionBubble>
          <input style={{width: "60px"}} type="number" name={data.id} onChange={(event) => changeProviderNumber("start", event.target.value)} value={data.start} />
        </Span>
        <Span>
          <Label> End: </Label>
          <QuestionBubble text="Ending Value"></QuestionBubble>
          <input style={{width: "60px"}} type="number" name={data.id} onChange={(event) => changeProviderNumber("end", event.target.value)} value={data.end} />
        </Span>
        <Span>
          <Label> Step: </Label>
          <QuestionBubble text="Optional | How big of step through range"></QuestionBubble>
          <input style={{width: "60px"}} type="number" min="1" max="65535" name={data.id} onChange={(event) => changeProviderNumber("step", event.target.value)} value={data.step} />
        </Span>
        <Span>
          <Label> Repeat: </Label>
          <QuestionBubble text="Optional | Want repeat to be true"></QuestionBubble>
          <input type="checkbox" name={data.id} onChange={(event) => handleClick(event.target.checked)} checked={data.repeat}/>
        </Span>
        <button style={{marginLeft: "auto"}} id={data.id} onClick={deleteProvider}>X</button>
      </Div>
  );
}

export default RangeProvider;
