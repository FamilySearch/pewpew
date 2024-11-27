import { Div, Label, Span } from "../YamlStyles";
import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import { PewPewAPI, PewPewHeader } from "../../util/yamlwriter";
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios, { AxiosRequestConfig, Method } from "axios";
import QuestionBubble from "../YamlQuestionBubble";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

const ModalInput = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
`;
const EndpointDisplay = styled.span`
  margin-right: 5px;
  max-width: 450px;
  width: 450px;
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
}

export interface UrlState {
  passed: boolean;
}

interface RequestOptions extends AxiosRequestConfig {
  method: Method;
  url: string;
  headers?: Record<string, string>;
  data?: any;
  params?: any;
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

export function Urls ({ data: { headers, ...data }, ...props }: UrlProps) {
  const defaultState: UrlState = {
    passed: false
  };
  const [url, setUrl] = useState(data.url);
  const [method, setMethod] = useState(data.method as Method);
  const [headersList, setHeadersList] = useState<PewPewHeader[]>(headers);
  const [lastResponse, setLastResponse] = useState<Record<string, any>>();
  const [lastResponseCode, setLastResponseCode] = useState<string>();
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
    const request: RequestOptions = {
      method,
      url,
      headers: headersList.reduce((acc, header) => {
        acc[header.name] = header.value;
        return acc;
      }, {} as Record<string, string>),
      validateStatus: () => true
    };
    try {
      const response = await axios(request);
      setLastResponseCode(response.status + " " + response.statusText);
      setLastResponse(response.data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

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

  const changeUrl = (type: PewPewApiStringType, value: string) => {
    data[type] = value;
    props.changeUrl({ ...data, headers });
  };

  const changeHeader = (headerIndex: number, type: PewPewHeaderStringType, value: string) => {
    setHeadersList((prevHeadersList) => {
      const newHeadersList = [...prevHeadersList];
      newHeadersList[headerIndex][type] = value;
      return newHeadersList;
    });
  };

  const updateEndpointHandler = () => {
    changeUrl("method", method);
    changeUrl("url", url);
    props.changeUrl({ ...data, headers: headersList });
    return Promise.resolve();
  };

  const checked = state.passed ? " Passed" : "";
  const invalidUrl: boolean = !isValidUrl(url);
  const urlStyle: React.CSSProperties = getUrlStyle(invalidUrl);
  const urlTitle: string | undefined = getUrlTitle(invalidUrl);
  const invalidHitRate = !HIT_RATE_REGEX.test(data.hitRate);
  return (
    <Div>
      <EndpointDisplay style={urlStyle} title={urlTitle}>
        {data.url ? data.url : "Url"}
      </EndpointDisplay>
      <Modal
        ref={modalRef}
        title="Edit Endpoint"
        closeText="Close"
        submitText="Update Endpoint"
        onSubmit={updateEndpointHandler}
        isReady={enableSubmit}
        scrollable={false}
        >
        <Row style={{ alignItems: "start"}}>
            <Span style={{ margin: 0 }}>
              <ModalInput>
                <Label style={{ fontSize: "14px", marginBottom: "5px" }} htmlFor="urlMethod"> Method </Label>
                <select onChange={(event) => setMethod(event.target.value as Method)} name={data.id} value={method} id="urlMethod">
                  <option value="GET"> Get </option>
                  <option value="POST"> Post </option>
                  <option value="PUT"> Put </option>
                  <option value="DELETE"> Delete </option>
                  <option value="PATCH"> Patch </option>
                </select>
              </ModalInput>
            </Span>
            <ModalInput style={{ flexGrow: 1 }}>
              <Row>
                <Label style={{ fontSize: "14px" }} htmlFor="urlUrl"> Endpoint {checked}</Label>
                <p style={{ fontSize: "10px", margin: 0 }}> (must be in the form "https://www.[url]" or "http://www.[url]")</p>
              </Row>
              <Row>
                <input style={{ ...urlStyle, width: "100%" }} onChange={(event) => setUrl(event.target.value)} title={urlTitle} name={data.id} value={url} id="urlUrl" type="text" />
                <button style={{ cursor: "pointer" }} onClick={makeRequest} disabled={invalidUrl} title={invalidUrl ? "Endpoint URL is not valid" : "Attempt to call this Endpoint"} type="submit">Test</button>
              </Row>
            </ModalInput>
            <Span style={{ marginRight: 0, marginLeft: "10px" }}>
              <ModalInput>
                <Row>
                  <Label htmlFor="urlHitrate" style={{ fontSize: "14px" }}> Hit Rate </Label>
                  <QuestionBubble text="Required | Number, then hph, hpm, or hps"></QuestionBubble>
                </Row>
                <input style={{ ...getHitRateStyle(invalidHitRate), width: "75px" }} onChange={(event) => changeUrl("hitRate", event.target.value)} name={data.id} value={data.hitRate} id="urlHitrate" title={getHitRateTitle(invalidHitRate)} />
              </ModalInput>
            </Span>
        </Row>
        <RequestDetailsTabs id={data.id} headersList={headersList} removeHeader={removeHeader} changeHeader={changeHeader} addHeader={addHeader} responseCode={lastResponseCode} response={lastResponse} />
      </Modal>
      <button onClick={() => modalRef.current?.openModal()}>Edit</button>
      <button id={data.id} onClick={() => props.deleteUrl(data.id)}>X</button>
    </Div>
  );
}

export default Urls;

interface RequestDetailsTabsProps extends HeadersViewProps, ResponseViewProps {}

function RequestDetailsTabs ({ id, headersList, removeHeader, changeHeader, addHeader, responseCode, response }: RequestDetailsTabsProps): JSX.Element {
  type tabType = "Headers" | "Response"
  const [activeTab, setActiveTab] = useState<tabType>("Headers");
  const tabs: tabType[] = ["Headers", "Response"];

  return (
    <div>
      <div role="tablist" className="tab-list">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tabpanel-${tab}`}
            id={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`tab ${activeTab === tab ? "active" : ""}`}
            disabled={activeTab === tab}
            style={{width: `${100 / tabs.length}%`}}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "Headers" && <HeadersView id={id} headersList={headersList} removeHeader={removeHeader} changeHeader={changeHeader} addHeader={addHeader} />}
        {activeTab === "Response" && <ResponseView responseCode={responseCode} response={response} />}
      </div>
    </div>
  );
}

interface HeadersViewProps {
  id: string;
  headersList: PewPewHeader[];
  removeHeader: (headerId: string) => void;
  changeHeader: (headerIndex: number, type: PewPewHeaderStringType, value: string) => void;
  addHeader: (headerType?: HeaderType) => void;
}

function HeadersView ({ id, headersList, removeHeader, changeHeader, addHeader }: HeadersViewProps): JSX.Element {
  const styles: Record<string, React.CSSProperties> = {
    headersDisplay: {
      marginTop: "10px",
      maxHeight: "300px",
      overflow: "auto"
    },
    gridContainer: {
      display: "grid",
      gap: "10px"
    },
    gridHeader: {
      display: "grid",
      gridTemplateColumns: "auto 1fr 2fr",
      gap: "10px",
      fontWeight: "bold",
      height: "20px"
    },
    gridRows: {
      display: "grid",
      gridTemplateColumns: "auto 1fr 2fr",
      gap: "10px",
      alignItems: "stretch"
    },
    input: {
      boxSizing: "border-box"
    },
    button: {
      boxSizing: "border-box",
      whiteSpace: "nowrap"
    }
  };
  return (
    <React.Fragment>
        <div style={styles.headersDisplay}>
          <div style={styles.gridContainer}>
            <div style={styles.gridHeader}>
              <span><button name={id} onClick={() => addHeader()}>+</button></span>
              <span>Name</span>
              <span>Value</span>
            </div>
            {headersList.length === 0 && <span>No Headers yet, click "+" to create one</span>}
            {headersList.map((header: PewPewHeader, index: number) => (
              <div key={index} style={styles.gridRows}>
                <button style={styles.button} onClick={() => removeHeader(header.id)}>X</button>
                <input style={styles.input} id={`urlHeaderKey@${index}`} name={id} value={header.name} onChange={(event) => changeHeader(index, "name", event.target.value)} />
                <input style={styles.input} id={`urlHeaderValue@${index}`} name={id} value={header.value} onChange={(event) => changeHeader(index, "value", event.target.value)} />
              </div>
            ))}
          </div>
        </div>
    </React.Fragment>
  );
}

interface ResponseViewProps {
  responseCode: string | undefined;
  response: Record<string, any> | undefined;
}

function ResponseView ({ responseCode, response }: ResponseViewProps): JSX.Element {
  const responseDisplayStyle: React.CSSProperties = {
    maxHeight: "300px",
    overflow: "auto",
    border: "1px solid #ccc",
    padding: "10px",
    backgroundColor: "#2e3438"
  };

  return (
    <React.Fragment>
      <p style={{ fontSize: "14px" }}>Code: {responseCode}</p>
      <div style={responseDisplayStyle}>
        <pre>
          {JSON.stringify(response, null, 2)}
        </pre>
      </div>
    </React.Fragment>
  );
}