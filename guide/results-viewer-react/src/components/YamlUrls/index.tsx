import { Button, Div, Input, Label, Select, Span } from "../YamlStyles";
import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import { PewPewAPI, PewPewHeader, PewPewQueryParam } from "../../util/yamlwriter";
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse, Method } from "axios";
import { DeleteIcon } from "../Icons/DeleteIcon";
import { EditIcon } from "../Icons/EditIcon";
import QuestionBubble from "../YamlQuestionBubble";
import RequestDetailsTabs from "./RequestDetailsTabs";
import { XIcon } from "../Icons/XIcon";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

const ModalInput = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
`;
const EndpointDisplay = styled.span`
  margin-right: 5px;
  max-width: 60%;
  min-width: 450px;
  white-space: nowrap;
  overflow: hidden;
`;
const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 5px;
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
  initialDisplay?: boolean;
}

export interface UrlState {
  passed: boolean;
}

export const HIT_RATE_REGEX: RegExp = new RegExp("^(\\d+)hp(h|m|s)$|^\\$\\{[a-zA-Z][a-zA-Z0-9]*\\}$");
export const URLS = "urls";
const EMPTY_HEADER = "emptyHeader";
const DEFAULT_HEADERS = "defaultHeaders";
export const AUTHENTICATED = "authenticated";
const ACCEPT_LANGUAGE = "acceptLanguage";
const CONTENT_TYPE = "contentType";
export type HeaderType = "defaultHeaders" | "authenticated" | "acceptLanguage" | "contentType";
export type PewPewApiStringType = "url" | "method" | "hitRate";
export type PewPewHeaderStringType = "name" | "value";
export type PewPewQueryParamStringType = "name" | "value";
export type TabType = "Headers" | "Query Params" | "Request Body" | "Response";

export const newHeader = () => ({ id: uniqueId(), name: "", value: "" });
export const getAuthorizationHeader = (): PewPewHeader => ({ id: AUTHENTICATED, name: "Authorization", value: "Bearer ${sessionId}" });
const getAcceptLanguageHeader = (): PewPewHeader => ({ id: ACCEPT_LANGUAGE, name: "Accept-Language", value: "en-us"});
const getContentTypedHeader = (): PewPewHeader => ({ id: CONTENT_TYPE, name: "Content-Type", value: "application/json"});
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

export function Urls ({ data: { headers, requestBody, ...data }, ...props }: UrlProps) {
  const defaultState: UrlState = {
    passed: false
  };
  const [url, setUrl] = useState(data.url);
  const [method, setMethod] = useState(data.method as Method);
  const [headersList, setHeadersList] = useState<PewPewHeader[]>(headers);
  const queryParamsFromUrl = useMemo<PewPewQueryParam[]>(() => {
    const queryParamsText = data.url.split("?")[1];
    if (queryParamsText) {
      return queryParamsText.split("&").map((param) => {
        const [name, value] = param.split("=");
        return { id: uniqueId(), name, value };
      });
    }
    return [];
  }, [data.url]);
  const [queryParamsList, setQueryParamsList] = useState<PewPewQueryParam[]>(queryParamsFromUrl);
  const [requestBodyObject, setRequestBodyObject] = useState<object>(requestBody || {});
  const [lastResponse, setLastResponse] = useState<AxiosResponse>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [activeTab, setActiveTab] = useState<TabType>("Headers");
  const enableSubmit = useMemo(() => isValidUrl(url), [url]);
  // /** Map to keep id's unique */
  const headersMap = new Map(headers.map((header) => ([header.id, header])));

  const [state, _setState] = useState(defaultState);
  const modalRef = useRef<ModalObject| null>(null);
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

  async function makeRequest () {
    const request: AxiosRequestConfig = {
      method,
      url,
      headers: headersList.reduce((acc, header) => {
        acc[header.name] = header.value;
        return acc;
      }, {} as Record<string, string>),
      data: requestBodyObject
    };
    try {
      const response = await axios(request);
      setLastResponse(response);
      setActiveTab("Response");
    } catch (error) {
      if ((error as AxiosError).isAxiosError) {
        if ((error as AxiosError).response) {
          setLastResponse((error as AxiosError).response);
        } else {
          setErrorMessage("Error: " + (error as AxiosError).message + ". This is likely a CORS issue.");
          setLastResponse(undefined);
        }
        setActiveTab("Response");
      } else {
        setErrorMessage("Error: " + error);
        setLastResponse(undefined);
        setActiveTab("Response");
      }
    }
  }

  const changeUrlObject = (type: PewPewApiStringType, value: string) => {
    data[type] = value;
    props.changeUrl({ ...data, headers });
  };

  const changeUrl = (event: React.ChangeEvent<HTMLInputElement>) => {
    const urlText = event.target.value;
    const queryParamsText = urlText.split("?")[1];
    if (queryParamsText) {
      const queries = queryParamsText.split("&").map((param) => {
        const [name, value] = param.split("=");
        return { id: uniqueId(), name, value };
      });
      setQueryParamsList(queries);
    }
    setUrl(urlText);
  };

  const clearUrl = () => {
    setUrl("");
    setQueryParamsList([]);
  };

  // Adds header to array in given url
  // Url found by id
  const addHeader = (headerType?: HeaderType) => {
    log("addHeader " + headerType, LogLevel.DEBUG);
    // Adding header when Authenticated option is checked
    if (headerType === DEFAULT_HEADERS) {
      // add all
      setHeadersList((prevHeadersList) => prevHeadersList.concat(getDefaultHeaders(props.authenticated)));
    } else {
      // put at end
      setHeadersList((prevHeadersList) => prevHeadersList.concat(getHeader(headerType)));
    }
  };

  // Removes header from array in given url
  // Url found by id and type of header
  const removeHeader = (headerId: string) => {
    // Removing header when X button is pressed in urls modal
    log("removeHeader " + headerId, LogLevel.DEBUG);
    if (headerId === DEFAULT_HEADERS) {
      // Remove both!
      setHeadersList((prevHeadersList) => prevHeadersList.filter((header) => header.id !== ACCEPT_LANGUAGE && header.id !== CONTENT_TYPE));
    } else {
      setHeadersList((prevHeadersList) => prevHeadersList.filter((header) => header.id !== headerId));
    }
  };

  const changeHeader = (headerIndex: number, type: PewPewHeaderStringType, value: string) => {
    setHeadersList((prevHeadersList) => {
      const newHeadersList = [...prevHeadersList];
      newHeadersList[headerIndex][type] = value;
      return newHeadersList;
    });
  };

  const addQueryParam = () => {
    setQueryParamsList((prevQueryParamsList) => prevQueryParamsList.concat({ id: uniqueId(), name: "", value: "" }));
  };

  const removeQueryParam = (param: PewPewQueryParam) => {
    setUrl((prevUrl) => prevUrl.replace(`&${param.name}=${param.value}`, ""));
    setQueryParamsList((prevQueryParamsList) => prevQueryParamsList.filter((p) => p.id !== param.id));
  };

  const changeQueryParam = (paramIndex: number, type: PewPewQueryParamStringType, value: string) => {
    const paramToReplace = `&${queryParamsList[paramIndex].name}=${queryParamsList[paramIndex].value}`;
    if (type === "name") {
      const replacementParam = `&${value}=${queryParamsList[paramIndex].value}`;
      setUrl((prevUrl) => {
        if (!prevUrl.includes(paramToReplace)) {return `${prevUrl}${!prevUrl.includes("?") ? "?" : "" }${replacementParam}`;}
        else {return prevUrl.replace(paramToReplace, replacementParam);}
      });
    } else if (type === "value") {
      const replacementParam = `&${queryParamsList[paramIndex].name}=${value}`;
      setUrl((prevUrl) => {
        if (!prevUrl.includes(paramToReplace)) {return `${prevUrl}${!prevUrl.includes("?") ? "?" : "" }${replacementParam}`;}
        else {return prevUrl.replace(paramToReplace, replacementParam);}
      });
    }
    setQueryParamsList((prevQueryParamsList) => {
      const newQueryParamsList = [...prevQueryParamsList];
      newQueryParamsList[paramIndex][type] = value;
      return newQueryParamsList;
    });
  };

  const updateRequestBody = (newRequestBody: object) => {
    setRequestBodyObject(newRequestBody);
  };

  const updateEndpointHandler = () => {
    changeUrlObject("method", method);
    changeUrlObject("url", url);
    props.changeUrl({ ...data, headers: headersList });
    return Promise.resolve();
  };

  const resetModalState = () => {
    setUrl(data.url);
    setMethod(data.method as Method);
    setHeadersList(headers);
    setQueryParamsList(queryParamsFromUrl);
    setLastResponse(undefined);
    setErrorMessage(undefined);
    setActiveTab("Headers");
  };

  const handleChangeTab = (tab: TabType) => setActiveTab(tab);

  const checked = state.passed ? " Passed" : "";
  const invalidUrl: boolean = !isValidUrl(url);
  const urlStyle: React.CSSProperties = getUrlStyle(invalidUrl);
  const urlTitle: string | undefined = getUrlTitle(invalidUrl);
  const invalidHitRate = !HIT_RATE_REGEX.test(data.hitRate);
  return (
    <Div>
      <Button onClick={() => modalRef.current?.openModal()} style={{marginRight: "5px"}}><EditIcon /></Button>
      <Button id={data.id} onClick={() => props.deleteUrl(data.id)} style={{marginRight: "5px"}}><DeleteIcon /></Button>
      <EndpointDisplay style={urlStyle} title={urlTitle}>
        {data.url ? data.url : "Url"}
      </EndpointDisplay>
      <Modal
        ref={modalRef}
        title="Edit Endpoint"
        closeText="Close"
        submitText="Update Endpoint"
        onSubmit={updateEndpointHandler}
        onClose={resetModalState}
        isReady={enableSubmit}
        scrollable={false}
        initialDisplay={props.initialDisplay}
        >
        <Row style={{ alignItems: "start"}}>
            <Span style={{ margin: 0 }}>
              <ModalInput>
                <Label style={{ fontSize: "14px", marginBottom: "5px" }} htmlFor="urlMethod"> Method </Label>
                <Select
                  id="urlMethod"
                  style={{ height: "30px", marginRight: "5px", boxSizing: "revert" }}
                  onChange={(event) => setMethod(event.target.value as Method)}
                  name={data.id}
                  value={method}
                >
                  <option value="GET"> Get </option>
                  <option value="POST"> Post </option>
                  <option value="PUT"> Put </option>
                  <option value="DELETE"> Delete </option>
                  <option value="PATCH"> Patch </option>
                </Select>
              </ModalInput>
            </Span>
            <ModalInput style={{ flexGrow: 1 }}>
              <Row>
                <Label style={{ fontSize: "14px" }} htmlFor="urlUrl"> Endpoint {checked}</Label>
                <p style={{ fontSize: "10px", margin: 0 }}> (must be in the form "https://www.[url]" or "http://www.[url]")</p>
              </Row>
              <Row style={{ position: "relative"}}>
                <Input style={{ ...urlStyle, width: "100%" }} onChange={changeUrl} title={urlTitle} name={data.id} value={url} id="urlUrl" type="text" />
                {url && (
                  <Button
                    onClick={clearUrl}
                    style={{
                      position: "absolute",
                      right: "35px",
                      top: "4px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer"
                    }}
                  >
                    <XIcon />
                  </Button>
                )}
                <Button
                  style={{ cursor: "pointer", height: "30px", boxSizing: "revert" }}
                  onClick={makeRequest}
                  disabled={invalidUrl}
                  title={invalidUrl ? "Endpoint URL is not valid" : "Attempt to call this Endpoint"}
                  type="submit"
                >
                  Test
                </Button>
              </Row>
            </ModalInput>
            <Span style={{ marginRight: 0, marginLeft: "10px" }}>
              <ModalInput>
                <Row>
                  <Label htmlFor="urlHitrate" style={{ fontSize: "14px" }}> Hit Rate </Label>
                  <QuestionBubble text="Required | Number, then hph, hpm, or hps"></QuestionBubble>
                </Row>
                <Input style={{ ...getHitRateStyle(invalidHitRate), width: "85px" }} onChange={(event) => changeUrlObject("hitRate", event.target.value)} name={data.id} value={data.hitRate} id="urlHitrate" title={getHitRateTitle(invalidHitRate)} />
              </ModalInput>
            </Span>
        </Row>
        <RequestDetailsTabs
          id={data.id}
          headersList={headersList}
          removeHeader={removeHeader}
          changeHeader={changeHeader}
          addHeader={addHeader}
          response={lastResponse}
          error={errorMessage}
          activeTab={activeTab}
          handleChangeTab={handleChangeTab}
          queryParamList={queryParamsList}
          removeParam={removeQueryParam}
          changeParam={changeQueryParam}
          addParam={addQueryParam}
          requestBody={requestBodyObject}
          updateRequestBody={updateRequestBody}
        />
      </Modal>
    </Div>
  );
}

export default Urls;