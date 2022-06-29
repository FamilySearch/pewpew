import { CSSTransition, TransitionGroup } from "react-transition-group";
import { Checkbox, Div, InputsDiv, Label, NonFlexSpan, Span } from "../YamlStyles";
import { LogLevel, log } from "../../util/log";
import { LoggerModal, debugLoggerSelect, errorLoggerSelect, killLoggerSelect } from "./LoggerModal";
import { LoggerSelectEntry, PewPewLogger } from "../../util/yamlwriter";
import { ModalObject, useEffectModal } from "../Modal";
import React, { useEffect, useRef, useState } from "react";
import QuestionBubble from "../YamlQuestionBubble";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

const BorderDiv = styled.div`
  border-bottom: 2px dotted rgb(206, 199, 199);
  padding-top: 12px;
  border-top: 2px dotted rgb(206, 199, 199);
  margin-top: 5px;
`;
const EditListButton = styled.button`
  width: 100px;
`;

export const loggers = "loggers";
const debugLogger = "debugLogger";
const errorLogger = "errorLogger";
const killLogger = "killLogger";
const defaultLoggers = "defaultLoggers";

export type DefaultLoggerTypeAll = DefaultVariablesType | "defaultLoggers";
export type PewPewLoggerBooleanType = "kill" | "pretty";
export type PewPewLoggerStringType = "name" | "where" | "to" | "limit";
interface DefaultVariables {
  debugLogger: boolean;
  errorLogger: boolean;
  killLogger: boolean;
}

type DefaultVariablesType = keyof DefaultVariables;

// This is the default state of all checkboxes and drop downs when the UI is initially loaded
const defaultUI: DefaultVariables = {
  debugLogger: false,
  errorLogger: true,
  killLogger: true
};

export const newLogger = (loggerId: string = uniqueId()): PewPewLogger => ({
  id: loggerId,
  name: "",
  where: "",
  to: "",
  select: [],
  limit: "",
  pretty: false,
  kill: false
});

export const debugLoggerVar = (): PewPewLogger => ({
  id: debugLogger,
  name: "httpAll",
  where: "",
  to: "stdout",
  select: JSON.parse(JSON.stringify(debugLoggerSelect)),
  limit: "",
  pretty: false,
  kill: false
});
export const errorLoggerVar = (): PewPewLogger => ({
  id: errorLogger,
  name: "httpErrors",
  where: "response.status >= 400",
  to: "stderr",
  select: JSON.parse(JSON.stringify(errorLoggerSelect)),
  limit: 200,
  pretty: false,
  kill: false
});
export const killLoggerVar = (): PewPewLogger => ({
  id: killLogger,
  name: "testEnd",
  where: "response.status >= 500",
  to: "stderr",
  select: JSON.parse(JSON.stringify(killLoggerSelect)),
  limit: 50,
  pretty: false,
  kill: true
});

function getDefaultLogger (loggerName: DefaultVariablesType): PewPewLogger {
  switch (loggerName) {
    case debugLogger:
      return debugLoggerVar();
    case errorLogger:
      return errorLoggerVar();
    case killLogger:
      return killLoggerVar();
    default:
      throw new Error("getDefaultLogger Invalid loggerName: " + loggerName);
  }
}

export function getDefaultLoggers (defaultVars: DefaultVariables = defaultUI): PewPewLogger[] {
  const pewpewVars: PewPewLogger[] = [];
  for (const [varName, isEnabled] of Object.entries(defaultVars)) {
    if (isEnabled) {
      pewpewVars.push(getDefaultLogger(varName as DefaultVariablesType));
    }
  }

  return pewpewVars;
}


export interface LoggerProps {
  addLogger: (pewpewLogger: PewPewLogger) => void;
  clearAllLoggers: () => void;
  deleteLogger: (loggerId: string) => void;
  changeLogger: (pewpewLogger: PewPewLogger) => void;
  defaultYaml: boolean;
  loggers: PewPewLogger[];
}

interface LoggerState extends DefaultVariables {
  /** State of the "Default Loggers" checkbox */
  defaultLoggers: boolean;
  /** This should be a PewPewLogger.id */
  currentLogger: PewPewLogger;
}

export function Loggers ({ defaultYaml, ...props }: LoggerProps) {
  const defaultState: LoggerState = {
    defaultLoggers: defaultYaml,
    currentLogger: newLogger(),
    ...defaultUI
  };
  /** Map to keep id's unique */
  const loggerMap = new Map(props.loggers.map((logger) => ([logger.id, logger])));

  const [state, setState] = useState(defaultState);
  const updateState = ((newState: Partial<LoggerState>) => setState((oldState: LoggerState) => ({ ...oldState, ...newState })));
  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef);

  // Prepopulate the loggers based on the defaultYaml
  useEffect(() => {
    switchAllDefaults(defaultYaml);
  }, [defaultYaml]);

  const handleClickDefault = (event: React.ChangeEvent<HTMLInputElement>) => {
    const target = event.target as HTMLInputElement;
    const id = target.id as DefaultLoggerTypeAll;
    const checked = target.checked;
    log("handleClickDefault", LogLevel.DEBUG, { id, checked });
    if (id === defaultLoggers) {
      switchAllDefaults(checked);
    } else {
      switchDefault(id, checked);
    }
  };

  const switchAllDefaults = (newChecked: boolean) => {
    log("switchAllDefaults", LogLevel.DEBUG, { newChecked });
    switchDefault("errorLogger", newChecked);
    switchDefault("killLogger", newChecked);
    updateState({ defaultLoggers: newChecked });
  };

  const switchDefault = (loggerType: DefaultVariablesType, newChecked: boolean) => {
    log("switchDefault", LogLevel.DEBUG, { loggerType, newChecked });
    updateState({ [loggerType]: newChecked });
    // Add/delete from varsMap/vars
    if (newChecked && !loggerMap.has(loggerType)) {
      // Add it (will update the map when it comes back in via props)
      const newVar = getDefaultLogger(loggerType);
      props.addLogger(newVar);
    } else if (!newChecked && loggerMap.has(loggerType)) {
      // Remove it (will update the map when it comes back in via props)
      props.deleteLogger(loggerType);
    }
  };

  const handleClickLogger = (logger: PewPewLogger, loggerType: PewPewLoggerBooleanType, newChecked: boolean) => {
    log("handleClickLogger", LogLevel.DEBUG, { newChecked, loggerType, logger });
    logger[loggerType] = newChecked;
    props.changeLogger(logger);
  };

  const changeLogger = (logger: PewPewLogger, loggerType: PewPewLoggerStringType, value: string) => {
    log("changeLogger", LogLevel.DEBUG, { loggerType, value, logger });
    if (loggerType === "limit" && `${parseInt(value)}` === value) {
      logger.limit = parseInt(value);
    } else {
      logger[loggerType] = value;
    }
    props.changeLogger(logger);
  };

  const changeLoggerSelect = (parameter: LoggerSelectEntry[]) => {
    setState(({ currentLogger, ...oldState }) => ({ ...oldState, currentLogger: { ...currentLogger, select: parameter } }));
  };

  const changeLoggerSelectOnClose = () => {
    // Save it off so when we modify it
    const currentLogger = state.currentLogger;
    log("closeModal", LogLevel.DEBUG, currentLogger);
    props.changeLogger(currentLogger);
  };

  const deleteLogger = (loggerId: string) => {
    if (loggerId in defaultUI) {
      // This will do the props.deleteVar()
      switchDefault(loggerId as DefaultVariablesType, false);
    } else {
      props.deleteLogger(loggerId);
    }
  };

  const openModal = (logger: PewPewLogger) => {
    log("openModal", LogLevel.DEBUG, logger);
    updateState({ currentLogger: logger });
    modalRef.current?.openModal();
  };

  return (
    <InputsDiv>
    <button onClick={() => props.addLogger(newLogger())}>
      Add Loggers
    </button>
    <button onClick={props.clearAllLoggers}>
      Clear All Loggers
    </button>&nbsp;&nbsp;
    <QuestionBubble text="Click here form more information about Loggers" href="https://familysearch.github.io/pewpew/config/loggers-section.html"></QuestionBubble>
    &nbsp;&nbsp;
    <label htmlFor={defaultLoggers}> Default Loggers </label>
    <QuestionBubble text="Default loggers include an error logger and a kill logger"></QuestionBubble>
    <Checkbox type="checkbox" id={defaultLoggers} onChange={handleClickDefault} checked={state.defaultLoggers} />
    <Div>
      <Label htmlFor={debugLogger}> Debug Logger </Label>
      <QuestionBubble text="http_all logs everything for debugging"></QuestionBubble>
      <Checkbox type="checkbox" id={debugLogger} onChange={handleClickDefault} checked={state.debugLogger} />

      <Label htmlFor={errorLogger}> Error Logger </Label>
      <QuestionBubble text="http_errors logs everything that includes an error status"></QuestionBubble>
      <Checkbox type="checkbox" id={errorLogger} onChange={handleClickDefault} checked={state.errorLogger} />

      <Label htmlFor={killLogger}> Kill Logger </Label>
      <QuestionBubble text="test_end logs status errors 500 and above and kills test with too many errors"></QuestionBubble>
      <Checkbox type="checkbox" id={killLogger} onChange={handleClickDefault} checked={state.killLogger} />
    </Div>
    <TransitionGroup className="loadPatter-section_list">
      {Array.from(loggerMap.values()).map((logger: PewPewLogger) => (
        <CSSTransition key={logger.id} timeout={300} classNames="load">
          <BorderDiv>
              <Span style={{paddingBottom: "15px"}}>
                <label style={{marginRight: "7px"}}> Name: </label>
                <QuestionBubble text="Name of Logger"></QuestionBubble>
                <input type="text" style={{width: "150px", marginRight: "120px"}} id="name" name={logger.id} onChange={(event) => changeLogger(logger, "name", event.target.value)} value={logger.name} />

                <label style={{marginRight: "5px"}}> Select: </label>
                <QuestionBubble text="Select data to be logged"></QuestionBubble>
                <EditListButton onClick={() => openModal(logger)}>
                  Edit List
                </EditListButton>
              </Span>
              <NonFlexSpan style={{paddingBottom: "15px"}}>
                <label style={{marginRight: "5px"}}> Where: </label>
                <QuestionBubble text="Only log data that meets where clause"></QuestionBubble>
                <input type="text" style={{width: "150px", marginRight: "120px"}} id="where" name={logger.id} onChange={(event) => changeLogger(logger, "where", event.target.value)} value={logger.where} />

                <label style={{marginRight: "17px"}}> Limit: </label>
                <QuestionBubble text="Integer indicates logger will only log up to n values"></QuestionBubble>
                <input type="text" style={{width: "100px"}} id="limit" name={logger.id} min="0" onChange={(event) => changeLogger(logger, "limit", event.target.value)} value={logger.limit} />

                <button style={{marginLeft: "200px"}} id={logger.id} onClick={() => deleteLogger(logger.id)}>X</button>
              </NonFlexSpan>
              <Span style={{paddingBottom: "15px"}}>
                <label style={{marginRight: "34.5px"}}> To: </label>
                <QuestionBubble text="Where you want data logged to (File, splunk, etc.)"></QuestionBubble>
                <input type="text" style={{width: "150px", marginRight: "120px"}} id="to" name={logger.id} onChange={(event) => changeLogger(logger, "to", event.target.value)} value={logger.to} />
                <div>
                  <span >
                    <label htmlFor={logger.id + "kill"} style={{marginRight: "5px"}}> Kill: </label>
                    <QuestionBubble text="Optional | end test after limit is reached"></QuestionBubble>
                    <input style={{marginRight: "15px"}} type="checkbox" id="kill" name={logger.id} onChange={(event) => handleClickLogger(logger, "kill", event.target.checked)} checked={logger.kill} />
                  </span>
                  <span>
                    <label htmlFor={logger.id + "pretty"} style={{marginRight: "5px"}}> Pretty: </label>
                    <QuestionBubble text="Optional | display results on separate lines (Do not use if logging to splunk)"></QuestionBubble>
                    <input style={{marginRight: "15px"}} type="checkbox" id="pretty" name={logger.id} onChange={(event) => handleClickLogger(logger, "pretty", event.target.checked)} checked={logger.pretty} />
                  </span>
                </div>
              </Span>
          </BorderDiv>
        </CSSTransition>
      ))}
      <LoggerModal
        ref={modalRef}
        data={state.currentLogger}
        changeLogger={changeLoggerSelect}
        onClose={changeLoggerSelectOnClose}
      />
    </TransitionGroup>
  </InputsDiv>
  );
}

export default Loggers;
