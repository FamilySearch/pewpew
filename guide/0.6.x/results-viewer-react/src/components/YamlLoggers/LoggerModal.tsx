import { Label, Span } from "../YamlStyles";
import { LogLevel, log } from "../../util/log";
import { LoggerSelectEntry, PewPewLogger } from "../../util/yamlwriter";
import { Modal, ModalObject } from "../Modal";
import React, { Ref, forwardRef, useEffect, useState } from "react";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

const ColumnBlockDiv = styled.div`
  display:inline-block;
  vertical-align: top;
`;
const LabelBody = styled.label`
  margin-right: 40px;
  display: flex;
  flex-direction: row;
`;
const LabelHeader = styled.label`
  margin-right: 40px;
  display: flex;
  flex-direction: row;
  font-size: 18px;
  font-weight: 20px;
  border-bottom: solid black;
  margin-bottom: 5px;
`;
const TextDiv = styled.div`
  padding-top: 15px;
  padding-bottom: 10px;
`;

interface LoggerModalProps {
  onClose?: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  changeLogger: (parameter: LoggerSelectEntry[]) => void;
  data: PewPewLogger;
}

const LOGGER_SELECT = "loggerSelect";
const REQUEST = "request";
const RESPONSE = "response";
const TIMING = "timing";

type HeaderLoggerType = "request" | "response" | "timing";
type RequestLoggerName = "request" | "method" | "url" | "requestHeaders" | "requestHeadersAll" | "requestBody";
type ResponseLoggerName = "response" | "status" | "responseHeaders" | "responseHeadersAll" | "responseBody";
type TimingLoggerName = "timestamp" | "rtt";
type LoggerName = RequestLoggerName | ResponseLoggerName | TimingLoggerName;

type LoggerSelectEntryDisplay = Omit<LoggerSelectEntry, "id"> & { display: string }
type RequestLogger = Record<RequestLoggerName, LoggerSelectEntryDisplay>;
type ResponseLogger = Record<ResponseLoggerName, LoggerSelectEntryDisplay>;
type TimingLogger = Record<TimingLoggerName, LoggerSelectEntryDisplay>;

const requestLoggers: RequestLogger = {
  "request": { display: "start-line", name: "request", value: "request[\"start-line\"]" },
  "method": { display: "method", name: "method", value: "request.method" },
  "url": { display: "url", name: "url", value: "request.url" },
  "requestHeaders": { display: "headers", name: "requestHeaders", value: "request.headers" },
  "requestHeadersAll": { display: "headers_all", name: "requestHeadersAll", value: "request.headers_all" },
  "requestBody": { display: "body", name: "requestBody", value: "request.body" }
};
const responseLoggers: ResponseLogger = {
  "response": { display: "start-line", name: "response", value: "response[\"start-line\"]" },
  "status": { display: "status", name: "status", value: "response.status" },
  "responseHeaders": { display: "headers", name: "responseHeaders", value: "response.headers" },
  "responseHeadersAll": { display: "headers_all", name: "responseHeadersAll", value: "response[\"headers-all\"]" },
  "responseBody": { display: "body", name: "responseBody", value: "response.body" }
};
const timingLoggers: TimingLogger = {
  "timestamp": { display: "timestamp", name: "timestamp", value: "epoch(\"ms\")" },
  "rtt": { display: "stats.rtt", name: "rtt", value: "stats.rtt" }
};

const getLoggerSelectEntryByName = (loggerName: LoggerName): LoggerSelectEntry => {
  let displayLogger: LoggerSelectEntryDisplay | undefined;
  if (loggerName in requestLoggers) {
    displayLogger = requestLoggers[loggerName as RequestLoggerName];
  } else if (loggerName in responseLoggers) {
    displayLogger = responseLoggers[loggerName as ResponseLoggerName];
  } else if (loggerName in timingLoggers) {
    displayLogger = timingLoggers[loggerName as TimingLoggerName];
  }
  if (displayLogger) {
    const { name, value } = displayLogger;
    const loggerEntry: LoggerSelectEntry = { id: name, name, value };
    log("getLoggerSelectEntryByName", LogLevel.DEBUG, { name, loggerEntry });
    return loggerEntry;
  } else {
    log("Unknown LoggerSelectEntry name " + loggerName, LogLevel.ERROR);
    throw new Error("Unknown LoggerSelectEntry name " + loggerName);
  }
};

export const defaultLoggers: {
  request: RequestLogger,
  response: ResponseLogger,
  timing: TimingLogger
} = {
  request: requestLoggers,
  response: responseLoggers,
  timing: timingLoggers
};

export const loggerOptions: {
  type: HeaderLoggerType;
  stateVariable: string;
  returnTypeArray: LoggerSelectEntryDisplay[];
}[] = [
  // Here is all of the Request information (loggerOptions[0])
  {
    type: REQUEST,
    stateVariable: "defaultRequest",
    returnTypeArray: Object.values(requestLoggers)
  },
  // Here is all of the Response information (loggerOptions[1])
  {
    type: RESPONSE,
    stateVariable: "defaultResponse",
    returnTypeArray: Object.values(responseLoggers)
  },
  // Here is all of the Timing information (loggerOptions[2])
  {
    type: TIMING,
    stateVariable: "defaultTiming",
    returnTypeArray: Object.values(timingLoggers)
  }
];

export const debugLoggerSelect: LoggerSelectEntry[] = [
  getLoggerSelectEntryByName("timestamp"),
  getLoggerSelectEntryByName("rtt"),
  getLoggerSelectEntryByName("request"),
  getLoggerSelectEntryByName("method"),
  getLoggerSelectEntryByName("requestHeaders"),
  getLoggerSelectEntryByName("requestBody"),
  getLoggerSelectEntryByName("response"),
  getLoggerSelectEntryByName("status"),
  getLoggerSelectEntryByName("responseHeaders"),
  getLoggerSelectEntryByName("responseBody")
];
export const errorLoggerSelect: LoggerSelectEntry[] = [
  getLoggerSelectEntryByName("timestamp"),
  getLoggerSelectEntryByName("rtt"),
  getLoggerSelectEntryByName("request"),
  getLoggerSelectEntryByName("requestHeaders"),
  getLoggerSelectEntryByName("requestBody"),
  getLoggerSelectEntryByName("response"),
  getLoggerSelectEntryByName("status"),
  getLoggerSelectEntryByName("responseHeaders")
];
export const killLoggerSelect = [
  getLoggerSelectEntryByName("timestamp"),
  getLoggerSelectEntryByName("status"),
  getLoggerSelectEntryByName("request"),
  getLoggerSelectEntryByName("response")
];

interface RequestState {
  request: boolean;
  method: boolean;
  url: boolean;
  requestHeaders: boolean;
  requestHeadersAll: boolean;
  requestBody: boolean;
}
interface ResponseState {
  response: boolean;
  status: boolean;
  responseHeaders: boolean;
  responseHeadersAll: boolean;
  responseBody: boolean;
}

interface TimingState {
  timestamp: boolean;
  rtt: boolean;
}

interface LoggerModalState {
  name: string;
  value: string;
  defaultRequest: boolean;
  defaultResponse: boolean;
  defaultTiming: boolean;
  request: RequestState;
  response: ResponseState;
  timing: TimingState;
}

const defaultRequest: RequestState = { request: false, method: false, url: false, requestHeaders: false, requestHeadersAll: false, requestBody: false };
const defaultResponse: ResponseState = { response: false, status: false, responseHeaders: false, responseHeadersAll: false, responseBody: false };
const defaultTiming: TimingState = { timestamp: false, rtt: false };

const getLoggerModalStateData = (loggerSelects: LoggerSelectEntry[]): Pick<LoggerModalState, "request" | "response" | "timing"> => {
  // test
  const request: RequestState = { ...defaultRequest };
  const response: ResponseState = { ...defaultResponse };
  const timing: TimingState = { ...defaultTiming };
  for (const loggerSelect of loggerSelects) {
    log("getLoggerModalStateData", LogLevel.DEBUG, { loggerSelect });
    // Check if it's one of them
    if (loggerSelect.id in requestLoggers) {
      request[loggerSelect.id as keyof RequestState] = true;
      log("getLoggerModalStateData requestState", LogLevel.DEBUG, { id: loggerSelect.id, requestState: request });
    } else if (loggerSelect.id in responseLoggers) {
      response[loggerSelect.id as keyof ResponseState] = true;
      log("getLoggerModalStateData responseState", LogLevel.DEBUG, { id: loggerSelect.id, responseState: response });
    } else if (loggerSelect.id in timingLoggers) {
      timing[loggerSelect.id as keyof TimingState] = true;
      log("getLoggerModalStateData timingState", LogLevel.DEBUG, { id: loggerSelect.id, timingState: timing });
    } else {
      // Something else
      log("getLoggerModalStateData other", LogLevel.DEBUG, { id: loggerSelect.id });
    }
  }
  return { request, response, timing };
};

export const LoggerModal = forwardRef(({ onClose, changeLogger, data }: LoggerModalProps, ref: Ref<ModalObject>) => {
  getLoggerModalStateData(data.select);
  const defaultState: LoggerModalState = {
    name: "",
    value: "",
    defaultRequest: false,
    defaultResponse: false,
    defaultTiming: false,
    ...getLoggerModalStateData(data.select)
  };

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<LoggerModalState>) =>
    setState((oldState: LoggerModalState): LoggerModalState => ({ ...oldState, ...newState }));

  useEffect(() => {
    const loggerState = getLoggerModalStateData(data.select);
    updateState(loggerState);
  }, [data.select]);

  const addInput = (id: string, name: string, value: string) => {
    const list = data.select;
    if (id === "timestamp") {
      list.unshift({ id, name, value });
    } else {
      list.push({ id, name, value });
    }
    changeLogger(list);
  };

  const addInputUser = () => {
    addInput(uniqueId(), state.name, state.value);
    updateState({ name: "", value: "" });
  };

  const handleChangeName = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateState({ name: event.target.value });
  };

  const handleChangeValue = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateState({ value: event.target.value });
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (state.name && state.value) {
      if (event.key === "Enter") {
        addInputUser();
      }
    }
  };

  const handleClickDeleteItem = (itemId: string, name: string) => {
    deleteItem([itemId]);
    // Check if it's a checkbox?
    log("handleClickDeleteItem", LogLevel.DEBUG, { itemId, name });
    if (itemId in state.request && typeof state.request[itemId as keyof RequestState] === "boolean") {
      setState(({ request, ...oldState }) => ({ ...oldState, request: { ...request, [itemId]: false } }));
    }
    if (itemId in state.response && typeof state.response[itemId as keyof ResponseState] === "boolean") {
      setState(({ response, ...oldState }) => ({ ...oldState, response: { ...response, [itemId]: false } }));
    }
    if (itemId in state.timing && typeof state.timing[itemId as keyof TimingState] === "boolean") {
      setState(({ timing, ...oldState }) => ({ ...oldState, timing: { ...timing, [itemId]: false } }));
    }
  };

  const deleteItem = (itemIds: string[]) => {
    const list = data.select = data.select.filter((item: LoggerSelectEntry) => !itemIds.includes(item.id));
    changeLogger(list);
  };

  // This function changes the state of all check boxes under a certain header and adds/removes all of the values
  const headerClick = (dataType: HeaderLoggerType, newChecked: boolean) => {
    let loggerArray: {
      type: HeaderLoggerType;
      stateVariable: string;
      returnTypeArray: LoggerSelectEntryDisplay[];
    } | undefined;
    for (const loggerOption of loggerOptions) {
      if (loggerOption.type === dataType) { loggerArray = loggerOption; }
    }
    log("headerClick", LogLevel.DEBUG, { dataType, loggerArray, newChecked });
    if (!loggerArray) {
      log("Uknown loggerOptions: " + dataType, LogLevel.ERROR);
      return;
    }
    updateState({ [loggerArray.stateVariable]: newChecked });
    for (const logger of loggerArray.returnTypeArray) {
      log("headerClick listClick", LogLevel.DEBUG, { dataType, logger, newChecked });
      // BUG: Add works via listClick. delete only does 1, delete below
      listClick(dataType, logger.name as LoggerName, logger.value, newChecked, true);
    }
    if (!newChecked) {
      // BUG: Add works via listClick. delete only does 1
      deleteItem(loggerArray.returnTypeArray.map((logger) => logger.name));
    }
  };

  // When any checkbox button is clicked, flip the state variable of that checkbox and add/remove that input
  const listClick = (headerType: HeaderLoggerType, name: LoggerName, value: string, newChecked: boolean, dontDelete?: boolean) => {
    let stateType: RequestState | ResponseState | TimingState | undefined;
    let stateValue: boolean | undefined;
    if (headerType === REQUEST) { stateType = state.request; stateValue = state.request[name as RequestLoggerName]; }
    if (headerType === RESPONSE) { stateType = state.response; stateValue = state.response[name as ResponseLoggerName]; }
    if (headerType === TIMING) { stateType = state.timing; stateValue = state.timing[name as TimingLoggerName]; }
    if (stateValue === undefined || stateValue === newChecked) {
      // Nothing needed
      log("listClick no change", LogLevel.DEBUG, { headerType, name, value, newChecked, stateValue, current: stateType });
      return;
    }

    setState((prevState) => ({ ...prevState, [headerType]: { ...prevState[headerType], [name]: newChecked } }));
    log("listClick", LogLevel.DEBUG, { headerType, name, newChecked });
    if (newChecked) {
      addInput(name, name, value);
    } else if (dontDelete !== true) {
      deleteItem([name]);
    }
  };

  return (
    <Modal ref={ref} title="Select Loggers" closeText="Close" onClose={onClose}>
      {loggerOptions.map((header, optionsIndex: number) => {
        const stateVariable = header.type === REQUEST ? state.defaultRequest : header.type === RESPONSE ? state.defaultResponse : state.defaultTiming;
        const itemType = header.type === REQUEST ? state.request : header.type === RESPONSE ? state.response : state.timing;
        return (
          <ColumnBlockDiv key={optionsIndex}>
            <LabelHeader>
              {header.type}
              <input
                key={header.stateVariable}
                style={{ marginLeft: "auto" }}
                type="checkbox"
                id={data.id}
                onChange={(event) => headerClick(header.type, event.target.checked)}
                checked={stateVariable}
              />
            </LabelHeader>
            {header.returnTypeArray.map((item, returnTypeIndex: number) => {
              return (
                <LabelBody key={returnTypeIndex}>
                  {item.display}&nbsp;&nbsp;&nbsp;&nbsp;
                  <input
                    key={item.name}
                    style={{ marginLeft: "auto" }}
                    type="checkbox"
                    id={data.name}
                    name={item.name}
                    value={item.value}
                    onChange={(event) => listClick(header.type, item.name as LoggerName, item.value, (event.target as HTMLInputElement).checked)}
                    checked={(itemType as any)[item.name]}
                  />
                </LabelBody>
              );
            })}
          </ColumnBlockDiv>
        );
      })}
      <TextDiv>
        Add any other items you want to be logged:
      </TextDiv>
      <Span>
        <Label>Name:</Label>
        <input style={{ width: "170px" }} name={data.id} onChange={handleChangeName} value={state.name} />&nbsp;&nbsp;
        <Label>Value:</Label>
        <input style={{ width: "170px" }} name={data.id} onChange={handleChangeValue} value={state.value} onKeyPress={onKeyUp} />&nbsp;&nbsp;
        <button id={LOGGER_SELECT} name={data.id} onClick={addInputUser} >
          Add
        </button>
      </Span>
      <table>
        <tbody>
          {data.select.map((item: LoggerSelectEntry, index: number) => {
            return (
              <tr key={index}>
                <td><button id={item.id} onClick={() => handleClickDeleteItem(item.id, item.name)}>X</button></td>
                <td>{item.name}</td>
                <td>:</td>
                <td>{item.value}</td>
              </tr>);
          })}
        </tbody>
      </table>
    </Modal>
  );
});

export default LoggerModal;
