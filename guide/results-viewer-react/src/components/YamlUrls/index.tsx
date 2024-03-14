import { Div, Label, Span } from "../YamlStyles";
import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import { PewPewAPI, PewPewHeader } from "../../util/yamlwriter";
import React, { useEffect, useRef, useState } from "react";
import QuestionBubble from "../YamlQuestionBubble";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

// import axios from "axios";

const ModalEndpointInput = styled.div`
  display: flex;
  flex-direction: row;
  margin-bottom: 10px;
`;
const ModalHitMethodInput = styled.div`
  display: flex;
  flex-direction: row;
  margin: 25px 0;
`;
const EndpointDisplay = styled.span`
  margin-right: 5px;
  max-width: 450px;
  width: 450px;
  white-space: nowrap;
  overflow: hidden;
`;

export interface UrlProps {
  deleteUrl: (id: string) => void;
  changeUrl: (pewpewUrl: PewPewAPI) => void;
  addHeaders: (urlId: string, newHeaders: PewPewHeader[]) => void;
  deleteHeader: (urlId: string, headerId: string) => void;
  data: PewPewAPI;
  /** State of Authenticated checkbox */
  authenticated: boolean
  /** State of Default Headers checkbox */
  defaultHeaders: boolean,
}

export interface UrlState {
  passed: boolean;
}

export const HIT_RATE_REGEX: RegExp = new RegExp("^(\\d+)hp(h|m|s)$");
export const URLS = "urls";
const EMPTY_HEADER = "emptyHeader";
const DEFAULT_HEADERS = "defaultHeaders";
export const AUTHENTICATED = "authenticated";
const ACCEPT_LANGUAGE = "acceptLanguage";
const CONTENT_TYPE = "contentType";
type HeaderType = "defaultHeaders" | "authenticated" | "acceptLanguage" | "contentType";
type PewPewApiStringType = "url" | "method" | "hitRate";
type PewPewHeaderStringType = "name" | "value";

export const newHeader = () => ({ id: uniqueId(), name: "", value: "" });
export const getAuthorizationHeader = (): PewPewHeader => ({ id: AUTHENTICATED, name: "Authorization", value: "Bearer ${v:sessionId}" });
const getAcceptLanguageHeader = (): PewPewHeader => ({ id: ACCEPT_LANGUAGE, name: "Accept-Language", value: "en-us" });
const getContentTypedHeader = (): PewPewHeader => ({ id: CONTENT_TYPE, name: "Content-Type", value: "application/json" });
export const getDefaultHeaders = (authenticated?: boolean): PewPewHeader[] => [
  ...(authenticated ? [getAuthorizationHeader()] : []),
  getAcceptLanguageHeader(),
  getContentTypedHeader()
];

function getHeader (headerType: HeaderType | "emptyHeader" = EMPTY_HEADER): PewPewHeader {
  switch (headerType) {
    case AUTHENTICATED:
      return getAuthorizationHeader();
    case ACCEPT_LANGUAGE:
      return getAcceptLanguageHeader();
    case CONTENT_TYPE:
      return getContentTypedHeader();
    case EMPTY_HEADER:
      return newHeader();
    default:
      throw new Error("getHeader Invalid headerType: " + headerType);
  }
}


export const getUrlStyle = (invalidUrl: boolean): React.CSSProperties => ({ color: invalidUrl ? "red" : undefined });
export const getUrlTitle = (invalidUrl: boolean): string | undefined => invalidUrl ? "Endpoint URL is not valid" : undefined;
export const getHitRateStyle = (invalidHitRate: boolean): React.CSSProperties => ({ color: invalidHitRate ? "red" : undefined });
export const getHitRateTitle = (invalidHitRate: boolean): string | undefined => invalidHitRate ? "Hit Rate is not valid" : undefined;

export function isValidUrl (url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function Urls ({ data: { headers, ...data }, ...props }: UrlProps) {
  const defaultState: UrlState = {
    passed: false
  };
  // /** Map to keep id's unique */
  const headersMap = new Map(headers.map((header) => ([header.id, header])));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [state, _setState] = useState(defaultState);
  const modalRef = useRef<ModalObject | null>(null);
  useEffectModal(modalRef);

  // Changes the state of authenticated button when default is checked or unchecked
  useEffect(() => {
    // Add/delete from headersMap/headers
    if (props.authenticated && !headersMap.has(AUTHENTICATED)) {
      // Add it (will update the map when it comes back in via props)
      addHeader(AUTHENTICATED);
    } else if (!props.authenticated && headersMap.has(AUTHENTICATED)) {
      // Remove it (will update the map when it comes back in via props)
      removeHeader(AUTHENTICATED);
    }
  }, [props.authenticated]);

  useEffect(() => {
    // Add/delete from headersMap/headers
    const hasAcceptLanguage = headersMap.has(ACCEPT_LANGUAGE);
    const hasContentType = headersMap.has(CONTENT_TYPE);
    // If we need to change both, we need to group them into a single "defaultHeaders" transaction
    if (props.defaultHeaders && (!hasAcceptLanguage || !hasContentType)) {
      // Add it (will update the map when it comes back in via props)
      const headerToAdd: HeaderType = !hasAcceptLanguage && !hasContentType
        ? DEFAULT_HEADERS
        : !hasAcceptLanguage ? ACCEPT_LANGUAGE : CONTENT_TYPE;
      addHeader(headerToAdd);
    } else if (!props.defaultHeaders && (hasAcceptLanguage || hasAcceptLanguage)) {
      // Remove it (will update the map when it comes back in via props)
      const headerToRemove: HeaderType = hasAcceptLanguage && hasContentType
        ? DEFAULT_HEADERS
        : hasAcceptLanguage ? ACCEPT_LANGUAGE : CONTENT_TYPE;
      removeHeader(headerToRemove);
    }
  }, [props.defaultHeaders]);

  // Currently unoperational. Needs a server to access websites correctly.
  // Would recommend simply using Postman instead of getting this function to work.
  // Postman is already used by a lot of the FamilySearch org and does what this function below would do and more.
  // Users can also simply create the testing script, test endpoints locally with pew pew, and edit the endpoints as needed.
  const checkUrl = () => {
    alert("Currently not working. Sorry!");
    // console.log(data.url);
    // const myUrl = `https://cors-escape-git-master.shalvah.now.sh/${data.url}`;
    // console.log(myUrl);
    /* let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
      if (readyState === 4 && status === 200) {
        let response = responseText;
        console.log(response);
      }
    }
    xhr.open("GET", myUrl);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.send(); */

    /* fetch(myUrl, {
      method: "POST",
      headers: {
        "Accept-Language": "en-us",
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      redirect: "follow",
    })
      .then(response => {
        console.log(response);
        if (response.ok) {
          response.text().then(text => {
            console.log(text);
            //setState((prevState: UrlState): UrlState => ({...prevState, passed: true}));
          })
        }
      })
      .catch(error => console.error(error));
  } */
    /* axios.defaults.headers.post["Content-Type"] = "application/x-www-form-urlencoded";
    axios.get(myUrl)
      .then((response) => {
        console.log(response);
        if (response.statusText === "OK") {
          setState((prevState: UrlState): UrlState => ({...prevState, passed: true }));
        } else {
          setState((prevState: UrlState): UrlState => ({...prevState, passed: false }));
        }
      })
      .catch((error) => {
        console.error(error);
        setState((prevState: UrlState): UrlState => ({...prevState, passed: false }));
      })
      .finally(() => {
        props.updateReady(state.urlReady && state.hitReady);
      });
      */
  };

  // Adds header to array in given url
  // Url found by id
  const addHeader = (headerType?: HeaderType) => {
    log("addHeader " + headerType, LogLevel.DEBUG);
    // Adding header when Authenticated option is checked
    if (headerType === DEFAULT_HEADERS) {
      // add all
      props.addHeaders(data.id, getDefaultHeaders());
    } else {
      // put at end
      props.addHeaders(data.id, [getHeader(headerType)]);
    }
  };

  // Removes header from array in given url
  // Url found by id and type of header
  const removeHeader = (headerId: string) => {
    // Removing header when X button is pressed in urls modal
    log("removeHeader " + headerId, LogLevel.DEBUG);
    if (headerId === DEFAULT_HEADERS) {
      // Remove both!
      props.deleteHeader(data.id, ACCEPT_LANGUAGE);
      props.deleteHeader(data.id, CONTENT_TYPE);
    } else {
      props.deleteHeader(data.id, headerId);
    }
  };

  const changeUrl = (type: PewPewApiStringType, value: string) => {
    data[type] = value;
    props.changeUrl({ ...data, headers });
  };

  const changeHeader = (headerIndex: number, type: PewPewHeaderStringType, value: string) => {
    // const header: PewPewHeader = headers[headerIndex];
    // // type = "name" or "value"
    // header[type] = value;
    // Typechecking above ^ for next line
    headers[headerIndex][type] = value;
    props.changeUrl({ ...data, headers });
  };

  const checked = state.passed ? " Passed" : "";
  const invalidUrl: boolean = !isValidUrl(data.url);
  const urlStyle: React.CSSProperties = getUrlStyle(invalidUrl);
  const urlTitle: string | undefined = getUrlTitle(invalidUrl);
  const invalidHitRate = !HIT_RATE_REGEX.test(data.hitRate);
  return (
    <Div>
      <EndpointDisplay style={urlStyle} title={urlTitle}>
        {data.url ? data.url : "Url"}
      </EndpointDisplay>
      <Modal ref={modalRef} title="Edit Endpoint" closeText="Close">
        <ModalEndpointInput>
          <Label> Endpoint: {checked}</Label>
          <input style={{ ...urlStyle, width: "500px" }} onChange={(event) => changeUrl("url", event.target.value)} title={urlTitle} name={data.id} value={data.url} id="urlUrl" />
          <button onClick={checkUrl} disabled={invalidUrl} title={invalidUrl ? "Endpoint URL is not valid" : "Attempt to call this Endpoint"}>Test</button>
          <p style={{ marginLeft: "10px", fontSize: "11px" }}>Endpoint must be in the form "https://www.(url)" or "http://www.(url)" </p>
        </ModalEndpointInput>
        <ModalHitMethodInput>
          <Span>
            <Label> Hit Rate: </Label>
            <QuestionBubble text="Required | Number, then hph, hpm, or hps"></QuestionBubble>
            <input style={{ ...getHitRateStyle(invalidHitRate), width: "75px" }} onChange={(event) => changeUrl("hitRate", event.target.value)} name={data.id} value={data.hitRate} id="urlHitrate" title={getHitRateTitle(invalidHitRate)} />
          </Span>
          <Span>
            <Label> Method: </Label>
            <select onChange={(event) => changeUrl("method", event.target.value)} name={data.id} value={data.method} id="urlMethod">
              <option value="GET"> Get </option>
              <option value="POST"> Post </option>
              <option value="PUT"> Put </option>
              <option value="DELETE"> Delete </option>
              <option value="PATCH"> Patch </option>
            </select>
          </Span>
          <button name={data.id} style={{ marginRight: "10px" }} onClick={() => addHeader()}>Add Header</button>
        </ModalHitMethodInput>
        <div>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((header: PewPewHeader, index: number) => {
                // This maps out all of the headers uploaded from har file
                return (
                  <tr key={header.id}>
                    <td><button onClick={() => removeHeader(header.id)}>X</button></td>
                    <td style={{ alignSelf: "center" }}><input id={`urlHeaderKey@${index}`} name={data.id} value={header.name} onChange={(event) => changeHeader(index, "name", event.target.value)} /></td>
                    <td><textarea style={{ width: "450px", resize: "none" }} id={`urlHeaderValue@${index}`} name={data.id} value={header.value} onChange={(event) => changeHeader(index, "value", event.target.value)} /></td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      </Modal>
      <button onClick={() => modalRef.current?.openModal()}>Edit</button>
      <button id={data.id} onClick={() => props.deleteUrl(data.id)}>X</button>
    </Div>
  );
}

export default Urls;
