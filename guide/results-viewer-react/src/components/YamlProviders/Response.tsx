import { Div, Label, Span } from "../YamlStyles";
import { LogLevel, log } from "../../util/log";
import { PewPewResponseProvider, ProviderProps} from "./ProviderTypes";
import React, { useState } from "react";
import QuestionBubble from "../YamlQuestionBubble";

interface ResponseProviderProps extends ProviderProps {
  data: PewPewResponseProvider;
}

interface ResponseProviderState {
  responseProviderType: ResponseProviderType;
  autoReturnType: AutoReturnType;
  bufferSize: string;
}

enum ResponseProviderType {
  Empty = "empty",
  Auto_Return = "auto_return",
  Buffer = "buffer"
}

enum AutoReturnType {
  If_not_full = "if_not_full",
  Block = "block",
  Force = "force"
}

export function ResponseProvider ({ data, ...props }: ResponseProviderProps) {
  const defaultState: ResponseProviderState = {
    responseProviderType: ResponseProviderType.Empty,
    autoReturnType: AutoReturnType.If_not_full,
    bufferSize: ""
  };

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<ResponseProviderState>) => setState((oldState): ResponseProviderState => ({ ...oldState, ...newState }));

  const changeProviderName = (value: string) => {
    props.changeProvider({ ...data, name: value });
  };

  const handleClick = (responseProviderType: ResponseProviderType) => {
    updateState({ responseProviderType });
    let response: Record<string, string> = {};
    switch (responseProviderType) {
      case ResponseProviderType.Empty:
        response = {};
        break;
      case ResponseProviderType.Auto_Return:
        // eslint-disable-next-line camelcase
        response = { auto_return: state.autoReturnType };
        break;
      case ResponseProviderType.Buffer:
        response = { buffer: state.bufferSize === "" ? "auto" : state.bufferSize };
        break;
      default:{
        const errorMessage = "Unknown ResponseProviderType " + responseProviderType;
        log(errorMessage, LogLevel.ERROR, responseProviderType);
        throw new Error(errorMessage);
      }
    }
    props.changeProvider({ ...data, response });
  };

  const changeAutoReturnType = (autoReturnType: AutoReturnType) => {
    updateState({ autoReturnType });
    // eslint-disable-next-line camelcase
    props.changeProvider({ ...data, response: { auto_return: autoReturnType } });
  };

  const changeBufferSize = (bufferSize: string) => {
    updateState({ bufferSize });
    props.changeProvider({ ...data, response: { buffer: bufferSize === "" ? "auto" : bufferSize } });
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
        <Label> Response: </Label>
        { state.responseProviderType === ResponseProviderType.Empty &&
        <div>
          <input style={{width: "82px", paddingLeft: "34px", marginRight: "5px"}}
          name="providerResponseEmpty" value={"{}"} readOnly />
          <QuestionBubble text="Provider will pick up value as defined by endpoint"></QuestionBubble>
        </div>
        }
        { state.responseProviderType === ResponseProviderType.Auto_Return &&
        <div>
          <select style={{width: "82px", height: "22px", fontSize: "12px", marginRight: "5px"}}
          name={data.id} onChange={(event) => changeAutoReturnType(event.target.value as AutoReturnType)}>
            <option value={AutoReturnType.If_not_full}>If_not_full</option>
            <option value={AutoReturnType.Block}>Block</option>
            <option value={AutoReturnType.Force}>Force</option>
          </select>
          <QuestionBubble text="Defines more specifically how provider is retrieved from an endpoint"></QuestionBubble>
        </div>
        }
        { state.responseProviderType === ResponseProviderType.Buffer &&
        <div>
          <input style={{width: "82px", marginRight: "5px"}} name={data.id} type="number" min="0" onChange={(event) => changeBufferSize(event.target.value)} value={state.bufferSize} placeholder={"auto"} />
          <QuestionBubble text="Specifies soft limit for a provider's buffer. Default auto"></QuestionBubble>
        </div>
        }
      </Span>
      <Span>
        <Label> empty: </Label>
        <input type="radio" name={data.id} value={ResponseProviderType.Empty} onChange={(event) => handleClick(event.target.value as ResponseProviderType)} defaultChecked/>
      </Span>
      <Span>
        <Label> auto_return: </Label>
        <input type="radio" name={data.id} value={ResponseProviderType.Auto_Return} onChange={(event) => handleClick(event.target.value as ResponseProviderType)}/>
      </Span>
      <Span>
        <Label> buffer: </Label>
        <input type="radio" name={data.id} value={ResponseProviderType.Buffer} onChange={(event) => handleClick(event.target.value as ResponseProviderType)} />
      </Span>
      <button style={{marginLeft: "auto"}} id={data.id} onClick={deleteProvider}>X</button>
    </Div>
  );
}

export default ResponseProvider;
