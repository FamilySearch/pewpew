import { CSSTransition, TransitionGroup } from "react-transition-group";
import { Div, InputsDiv} from "../YamlStyles";
import { ProviderType, ProviderTypes } from "./ProviderTypes";
import React, { useState } from "react";
import { PewPewProvider } from "../../util/yamlwriter";
import QuestionBubble from "../YamlQuestionBubble";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

const ProviderInputsDiv = styled.div`
  margin-right: 40px;
  padding-right: 40px;
  padding-bottom: 0px;
  padding-top: 5px;
`;

export interface ProviderMainProps {
  addProvider: (pewpewProvider: PewPewProvider) => void;
  clearAllProviders: () => void;
  deleteProvider: (id: string) => void;
  changeProvider: (pewpewProvider: PewPewProvider) => void;
  providers: PewPewProvider[];
}

export const providers = "providers";
export const providerFile = "providerFile";
export const providerResponse = "providerResponse";
export const providerRange = "providerRange";
export const providerList = "providerList";

export const newProviderFile = (providerId: string = uniqueId()): PewPewProvider => ({ id: providerId, type: "file", name: "", file: "", repeat: true, random: false });
export const newProviderResponse = (providerId: string = uniqueId()): PewPewProvider => ({ id: providerId, type: "response", name: "", response: {} });
export const newProviderRange = (providerId: string = uniqueId()): PewPewProvider => ({ id: providerId, type: "range", name: "", start: 0, end: "", step: "", repeat: false });
export const newProviderList = (providerId: string = uniqueId()): PewPewProvider => ({ id: providerId, type: "list", name: "", list: [] , repeat: true, random: false });
export const newProvider = (providerType: ProviderType) => {
  switch (providerType) {
    case ProviderType.file:
      return newProviderFile();
    case ProviderType.response:
      return newProviderResponse();
    case ProviderType.range:
      return newProviderRange();
    case ProviderType.list:
      return newProviderList();
    default:
      throw new Error("Unknown ProviderType: " + providerFile);
  }
};

export default function Providers ({ providers, ...props }: ProviderMainProps) {
  const providersMap = new Map(providers.map((pewpewPattern) => ([pewpewPattern.id, pewpewPattern])));

  const [display, setDisplay] = useState(false);

  const addProviderDropDown = () => {
    setDisplay(true);
  };

  const clearProviders = () => {
    setDisplay(false);
    props.clearAllProviders();
  };

  // // Changes information about the provider
  // const changeProvider = (id: string, event: InputEvent, type: string, parameter?: ProviderListEntry[]) => {
  //   const element = event.target as HTMLInputElement;
  //   if (element.value.length < 0) {
  //     return;
  //   }
  //   const index = state.providers.findIndex((provider) => {
  //     return (provider.id === id);
  //   });
  //   const provider = Object.assign({}, state.providers[index]);
  //   switch (type) {
  //     case "providerName":
  //       provider.name = element.value;
  //       break;
  //     case "providerFile":
  //       provider.file = convertInput(element.value);
  //       break;
  //     case "providerStart":
  //       provider.start = convertInput(element.value);
  //       break;
  //     case "providerEnd":
  //       provider.end = convertInput(element.value);
  //       break;
  //     case "providerStep":
  //       provider.step = convertInput(element.value);
  //       break;
  //     case "providerList":
  //       provider.list = convertInput(parameter);
  //       break;
  //     case "providerResponseEmpty":
  //       provider.response = {};
  //       break;
  //     case "providerResponseAuto":
  //       // eslint-disable-next-line camelcase
  //       provider.response = {auto_return: convertInput(element.value)};
  //       break;
  //     case "providerResponseBuffer":
  //       provider.response = {buffer: (element.value === "" ) ? "auto" : convertInput(element.value)};
  //       break;
  //     case "providerRepeat":
  //       provider.repeat = element.checked;
  //       break;
  //     case "providerRandom":
  //       provider.random = element.checked;
  //       break;
  //   }
  //   const providers = state.providers;
  //   providers[index] = provider;
  //   setState((prevState) => ({...prevState, providers }));
  // };

  return (
    <InputsDiv>
      <button onClick={() => addProviderDropDown()}>
        Add Providers
      </button>
      <button onClick={clearProviders}>
        Clear All Providers
      </button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Providers" href="https://familysearch.github.io/pewpew/config/providers-section.html"></QuestionBubble>
      &nbsp;&nbsp;
      <Div style={{marginTop: "0px"}}>
        {display &&
          <ProviderInputsDiv>
              <button id={providerFile} onClick={() => props.addProvider(newProviderFile())}>
                  File
              </button>
              <button id={providerResponse} onClick={() => props.addProvider(newProviderResponse())}>
                  Response
              </button>
              <button id={providerRange} onClick={() => props.addProvider(newProviderRange())}>
                  Range
              </button>
              <button id={providerList} onClick={() => props.addProvider(newProviderList())}>
                  List
              </button>&nbsp;&nbsp;
              <QuestionBubble text="Select the type of provider you want to add"></QuestionBubble>
          </ProviderInputsDiv>
        }
      </Div>
      <TransitionGroup className="loadPatter-section_list">
        {Array.from(providersMap.values()).map((provider: PewPewProvider) => (
          <CSSTransition key={provider.id} timeout={300} classNames="load">
            <ProviderTypes
              deleteProvider={props.deleteProvider}
              changeProvider={props.changeProvider}
              data={provider}
            />
          </CSSTransition>
        ))}
      </TransitionGroup>
    </InputsDiv>
  );
}
