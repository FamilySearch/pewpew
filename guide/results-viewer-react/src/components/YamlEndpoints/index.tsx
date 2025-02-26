import { Button, Checkbox, Input, InputsDiv, Label, NonFlexSpan } from "../YamlStyles";
import {
  HIT_RATE_REGEX,
  UrlProps,
  Urls,
  getAuthorizationHeader,
  getDefaultHeaders,
  getHitRateStyle,
  getHitRateTitle
} from "../YamlUrls";
import {
  HarEndpoint,
  HarHeader,
  InputEvent,
  PewPewAPI,
  PewPewHeader
} from "../../util/yamlwriter";
import { LogLevel, log } from "../../util/log";
import React, { useEffect, useRef, useState } from "react";
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
  authenticated: boolean;
  urls: PewPewAPI[];
  peakLoad?: string | undefined;
}

export interface EndpointsState {
    hitRate: string;
    defaultHeaders: boolean;
}

export const newUrl = (deaultHeaders: boolean, authenticated: boolean, peakLoad?: string, point?: HarEndpoint): PewPewAPI => {
  const pointHeaders: PewPewHeader[] = point?.headers.map(({ name, value }: HarHeader): PewPewHeader => ({ id: uniqueId(), name, value })) || [];
  const pewpewHeaders: PewPewHeader[] = deaultHeaders
    ? getDefaultHeaders(authenticated)
    : (authenticated ? [getAuthorizationHeader()] : []);
  return {
    id: uniqueId(),
    url: point?.url || "",
    hitRate: peakLoad ? "${" + peakLoad + "}" : "1hpm",
    headers: [...pewpewHeaders, ...pointHeaders],
    method: point?.method || "GET",
    authorization: null
  };
};

export const Endpoints = ({ urls, peakLoad, ...props }: EndpointsProps) => {
  const defaultState: EndpointsState = {
      hitRate: peakLoad ? "${" + peakLoad + "}" : "1hpm",
      defaultHeaders: props.defaultYaml
  };
  /** Map to keep id's unique */
  const urlsMap = new Map(urls.map((url) => ([url.id, url])));
  log("Endpoints", LogLevel.DEBUG, { urls, map: Array.from(urlsMap.values()) });

  const [state, setState] = useState(defaultState);
  const initialDisplay = useRef(false);
  const updateState = (newState: Partial<EndpointsState>) => setState((oldState: EndpointsState) => ({ ...oldState, ...newState}));

  useEffect(() => {
    // If the props is changed, update the local one to match, but the user can still toggle to see the difference
    updateState({ defaultHeaders: props.defaultYaml });
  }, [props.defaultYaml]);

  useEffect(() => {
    updateState({ hitRate: peakLoad ? "${" + peakLoad + "}" : "1hpm" });
  }, [peakLoad]);

  const handleClickDefault = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateState({ defaultHeaders: event.target.checked });
    // URLs will update via the props passed in
  };

  // Adds endpoint to array
  // Called from clicking add button, or when endpoints are sent from App.js through refs.child.updatePoints
  const addUrl = () => {
    initialDisplay.current = true;
    props.addUrl(newUrl(state.defaultHeaders, props.authenticated, peakLoad ? peakLoad : "1hpm"));
    setTimeout(() => {
      initialDisplay.current = false;
    }, 3000);
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

  const invalidHitRate = !HIT_RATE_REGEX.test(state.hitRate);
  const hitRateStyle: React.CSSProperties = getHitRateStyle(invalidHitRate);
  const hitRateTitle: string | undefined = state.hitRate === "" ? "Please enter a Hit Rate" : (getHitRateTitle(invalidHitRate) || "Update all hit rates");
  // https://github.com/reactjs/react-transition-group/issues/904
  // http://reactcommunity.org/react-transition-group/transition#Transition-prop-nodeRef
  return (
    <InputsDiv>
      <Button onClick={() => addUrl()}>
        Add Endpoint
      </Button>
      <Button onClick={props.clearAllUrls}>
        Clear All Endpoints
      </Button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Endpoints" href="https://familysearch.github.io/pewpew/config/endpoints-section.html"></QuestionBubble>
      &nbsp;&nbsp;

      <label htmlFor={defaultHeaders}> Default Headers </label>
      <QuestionBubble text="Default Headers include Accept-Language and Content-Type"></QuestionBubble>
      <Checkbox type="checkbox" id={defaultHeaders} onChange={handleClickDefault} checked={state.defaultHeaders} />

      <HitratesDiv>
        <NonFlexSpan>
          <Label> Change All Hitrates: </Label>
          <QuestionBubble text="Required | How many hits per minute (hpm) or hits per second (hps)"></QuestionBubble>
          <Input onChange={updateHitRate} value={state.hitRate} id="urlHitRateMaster" onKeyUp={handleKeyUp} style={hitRateStyle} title={hitRateTitle} />
          <Button value={state.hitRate} onClick={updateAllUrl} disabled={invalidHitRate} title={hitRateTitle} style={{ height: "20px", marginLeft: "5px" }}>
            Update
          </Button>
        </NonFlexSpan>
      </HitratesDiv>
      {Array.from(urlsMap.values()).map((url) => (
        <Urls
          deleteUrl={props.deleteUrl}
          changeUrl={props.changeUrl}
          addHeaders={props.addHeaders}
          deleteHeader={props.deleteHeader}
          data={url}
          authenticated={props.authenticated}
          defaultHeaders={state.defaultHeaders}
          initialDisplay={initialDisplay.current}
        />
      ))}
    </InputsDiv>
  );
};

export default Endpoints;
