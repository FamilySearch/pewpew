import { Button, Div, InputsDiv} from "../YamlStyles";
import { CSSTransition, TransitionGroup } from "react-transition-group";
import { ProviderType, ProviderTypes } from "./ProviderTypes";
import React, { useRef, useState } from "react";
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

export const PROVIDERS = "providers";
export const PROVIDER_FILE = "providerFile";
export const PROVIDER_RESPONSE = "providerResponse";
export const PROVIDER_RANGE = "providerRange";
export const PROVIDER_LIST = "providerList";

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
      throw new Error("Unknown ProviderType: " + PROVIDER_FILE);
  }
};

export function Providers ({ providers, ...props }: ProviderMainProps) {
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

  // https://github.com/reactjs/react-transition-group/issues/904
  // http://reactcommunity.org/react-transition-group/transition#Transition-prop-nodeRef
  const nodeRef = useRef(null);
  return (
    <InputsDiv>
      <Button onClick={() => addProviderDropDown()}>
        Add Provider
      </Button>
      <Button onClick={clearProviders}>
        Clear All Providers
      </Button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Providers" href="https://familysearch.github.io/pewpew/config/providers-section.html"></QuestionBubble>
      &nbsp;&nbsp;
      <Div style={{marginTop: "0px"}}>
        {display &&
          <ProviderInputsDiv>
              <Button id={PROVIDER_FILE} onClick={() => props.addProvider(newProviderFile())}>
                  File
              </Button>
              <Button id={PROVIDER_RESPONSE} onClick={() => props.addProvider(newProviderResponse())}>
                  Response
              </Button>
              <Button id={PROVIDER_RANGE} onClick={() => props.addProvider(newProviderRange())}>
                  Range
              </Button>
              <Button id={PROVIDER_LIST} onClick={() => props.addProvider(newProviderList())}>
                  List
              </Button>&nbsp;&nbsp;
              <QuestionBubble text="Select the type of provider you want to add"></QuestionBubble>
          </ProviderInputsDiv>
        }
      </Div>
      <TransitionGroup className="loadPatter-section_list" nodeRef={nodeRef}>
        {Array.from(providersMap.values()).map((provider: PewPewProvider) => (
          <CSSTransition key={provider.id} timeout={300} classNames="load" nodeRef={nodeRef}>
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

export default Providers;
