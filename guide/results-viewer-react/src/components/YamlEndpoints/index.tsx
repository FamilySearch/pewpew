import { CSSTransition, TransitionGroup } from "react-transition-group";
import { Checkbox, InputsDiv, Label, NonFlexSpan } from "../YamlStyles";
import {
  HarEndpoint,
  HarHeader,
  InputEvent,
  PewPewAPI,
  PewPewHeader
} from "../../util/yamlwriter";
import { LogLevel, log } from "../../util/log";
import React, { useEffect, useState } from "react";
import {
  UrlProps,
  Urls,
  getAuthorizationHeader,
  getDefaultHeaders,
  getHitRateStyle,
  getHitRateTitle,
  hitReg
} from "../YamlUrls";
import { QuestionBubble } from "../YamlQuestionBubble";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

const defaultHeaders = "defaultHeaders";

export const DisplayDivMain = styled.div`
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  padding-left: 2%;
  font: 16px "Century Gothic", Futura, sans-serif;
  text-align: left;
  align-items: last baseline;
`;
export const DisplayDivBody = styled.div`
display: flex;
flex-direction: column;
#createYaml {
  cursor: pointer;
  color: rgb(200, 200, 200);
  }
#createYaml:disabled {
  cursor: default;
  color: black;
}
`;
export const UrlsDiv = styled.div`
  border-right: 2px solid black;
  border-bottom: 2px solid black;
  margin-right: 40px;
  padding-right: 40px;
  padding-bottom: 40px;
  margin-bottom: 10px;
`;
const HitratesDiv = styled.div`
  margin-top: 10px;
  margin-bottom: 10px;
`;

export interface EndpointsProps extends Pick<UrlProps, "deleteUrl" | "changeUrl" | "addHeaders" | "deleteHeader"> {
  addUrl: (pewpewUrl: PewPewAPI) => void;
  clearAllUrls: () => void;
  defaultYaml: boolean;
  /** State of Authenticated checkbox */
  authenticated: boolean
  urls: PewPewAPI[],
}

export interface EndpointsState {
    hitRate: string;
    defaultHeaders: boolean;
}

export const newUrl = (deaultHeaders: boolean, authenticated: boolean, point?: HarEndpoint): PewPewAPI => {
  const headers: PewPewHeader[] = point?.headers.map(({ name, value }: HarHeader): PewPewHeader => ({ id: uniqueId(), name, value })) || [];
  const defaultHeaders: PewPewHeader[] = deaultHeaders
    ? getDefaultHeaders(authenticated)
    : (authenticated ? [getAuthorizationHeader()] : []);
  return {
    id: uniqueId(),
    url: point?.url || "",
    hitRate: "1hpm",
    headers: [...defaultHeaders, ...headers],
    method: point?.method || "GET",
    authorization: null
  };
};

export const Endpoints = ({ urls, ...props }: EndpointsProps) => {
  const defaultState: EndpointsState = {
      hitRate: "",
      defaultHeaders: props.defaultYaml
  };
  /** Map to keep id's unique */
  const urlsMap = new Map(urls.map((url) => ([url.id, url])));
  log("Endpoints", LogLevel.DEBUG, { urls, map: Array.from(urlsMap.values()) });

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<EndpointsState>) => setState((oldState: EndpointsState) => ({ ...oldState, ...newState}));

  useEffect(() => {
    // If the props is changed, update the local one to match, but the user can still toggle to see the difference
    updateState({ defaultHeaders: props.defaultYaml });
  }, [props.defaultYaml]);

  const handleClickDefault = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateState({ defaultHeaders: event.target.checked });
    // URLs will update via the props passed in
  };

  // Adds endpoint to array
  // Called from clicking add button, or when endpoints are sent from App.js through refs.child.updatePoints
  const addUrl = () => {
    props.addUrl(newUrl(state.defaultHeaders, props.authenticated));
  };

  // Updates the hit rate for each endpoint when "update" button is pressed
  const updateAllUrl = (_event: InputEvent)  => {
    const hitRate = state.hitRate;
    log("Updating all endpoints hitRate to " + hitRate, LogLevel.DEBUG);
    for (const url of urls) {
      if (url.hitRate !== hitRate) {
        props.changeUrl({ ...url, hitRate });
      }
    }
    updateState({ hitRate: "" });
  };

  // Updates the value of hit rate to be changed in all urls when update button is pressed or enter key is pressed
  const updateHitRate = (event: React.ChangeEvent<HTMLInputElement>) => {
    setState((prevState) => ({...prevState, hitRate: event.target.value }));
  };

  // Handles the changing of the "Change All Hitrates" when enter key is pressed
  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !invalidHitRate) {
      updateAllUrl(event);
    }
  };

  const invalidHitRate = !hitReg.test(state.hitRate);
  const hitRateStyle: React.CSSProperties = getHitRateStyle(invalidHitRate);
  const hitRateTitle: string | undefined = state.hitRate === "" ? "Please enter a Hit Rate" : (getHitRateTitle(invalidHitRate) || "Update all hit rates");
  return (
    <InputsDiv>
      <button onClick={() => addUrl()}>
        Add Endpoint
      </button>
      <button onClick={props.clearAllUrls}>
        Clear All Endpoints
      </button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Endpoints" href="https://familysearch.github.io/pewpew/config/endpoints-section.html"></QuestionBubble>
      &nbsp;&nbsp;

      <label htmlFor={defaultHeaders}> Default Headers </label>
      <QuestionBubble text="Default Headers include Accept-Language and Content-Type"></QuestionBubble>
      <Checkbox type="checkbox" id={defaultHeaders} onChange={handleClickDefault} checked={state.defaultHeaders} />

      <HitratesDiv>
        <NonFlexSpan>
          <Label> Change All Hitrates: </Label>
          <QuestionBubble text="Required | How many hits per minute (hpm) or hits per second (hps)"></QuestionBubble>
          <input onChange={updateHitRate} value={state.hitRate} id="urlHitRateMaster" onKeyUp={handleKeyUp} style={hitRateStyle} title={hitRateTitle} />
          <button value={state.hitRate} onClick={updateAllUrl} disabled={invalidHitRate} title={hitRateTitle}>
            Update
          </button>
        </NonFlexSpan>
      </HitratesDiv>
      <TransitionGroup className="endpoints-section_list">
        {Array.from(urlsMap.values()).map((url) => (
          <CSSTransition key={url.id} timeout={300} classNames="point">
            <Urls
              deleteUrl={props.deleteUrl}
              changeUrl={props.changeUrl}
              addHeaders={props.addHeaders}
              deleteHeader={props.deleteHeader}
              data={url}
              authenticated={props.authenticated}
              defaultHeaders={state.defaultHeaders}
            />
          </CSSTransition>
        ))}
      </TransitionGroup>
    </InputsDiv>
  );
};

export default Endpoints;
