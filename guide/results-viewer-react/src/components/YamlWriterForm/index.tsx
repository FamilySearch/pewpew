import {
  AUTHENTICATED,
  HIT_RATE_REGEX,
  URLS,
  getAuthorizationHeader,
  getDefaultHeaders,
  isValidUrl
} from "../YamlUrls";
import { Button, Checkbox, Div, Input, InputsDiv, Label } from "../YamlStyles";
import {
  HarEndpoint,
  HarHeader,
  PewPewAPI,
  PewPewHeader,
  PewPewLoadPattern,
  PewPewLogger,
  PewPewProvider,
  PewPewVars
} from "../../util/yamlwriter";
import {
  LOAD_PATTERN,
  LoadPatterns,
  NUMBER_REGEX,
  OVER_REGEX,
  PATTERNS,
  RAMP_PATTERN,
  newLoadLoadPattern,
  newRampLoadPattern
} from "../YamlLoadPatterns";
import { LOAD_TIME, PEAK_LOAD, RAMP_TIME, SESSION_ID, VARS, Vars, getDefaultVars } from "../YamlVars";
import { LOGGERS, LoggerType, Loggers, getDefaultLoggers } from "../YamlLoggers";
import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import {
  PROVIDERS,
  PROVIDER_FILE,
  PROVIDER_LIST,
  PROVIDER_RANGE,
  PROVIDER_RESPONSE,
  Providers
} from "../YamlProviders";
import React, { useEffect, useRef, useState } from "react";
import { createYamlString, writeFile } from "./writeyaml";
import { Endpoints } from "../YamlEndpoints";
import { QuestionBubble } from "../YamlQuestionBubble";
import { Row } from "../Div";
import ToggleDefaults from "../ToggleDefaults/ToggleDefaults";
import { YamlViewer } from "../YamlViewer";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

export const DisplayDivMain = styled.div`
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  padding-left: 2%;
  font: 16px "Century Gothic", Futura, sans-serif;
  text-align: left;
  align-items: initial;
`;
export const DisplayDivBody = styled.div`
  display: flex;
  flex-direction: column;
`;
export const UrlsDiv = styled.div`
  border-right: 2px solid black;
  border-bottom: 2px solid black;
  margin-right: 40px;
  padding-right: 40px;
  padding-bottom: 40px;
  margin-bottom: 10px;
`;
export interface YamlWriterFormProps {
  clearParentEndpoints: () => void,
  parentEndpoints: HarEndpoint[]
}

export interface YamlWriterFormState {
  urls: PewPewAPI[],
  patterns: PewPewLoadPattern[],
  vars: PewPewVars[],
  providers: PewPewProvider[],
  loggers: PewPewLogger[],
  fileName: string,
  previewYaml: string,
  /** State of Default Yaml checkbox */
  default: boolean,
  /** State of Authenticated checkbox */
  authenticated: boolean
}

const NAME_REGEX = new RegExp("^[A-Za-z_-].*$");
const VALUE_REGEX = new RegExp("^[A-Za-z0-9_-{}$].*$");

type YamlWriterBooleanState = "default" | "filterHeaders" | "authenticated";

export const YamlWriterForm = (props: YamlWriterFormProps) => {
  const defaultState: YamlWriterFormState = {
    urls: [],
    patterns: [newRampLoadPattern(), newLoadLoadPattern()],
    vars: getDefaultVars(),
    providers: [],
    loggers: getDefaultLoggers(),
    fileName: "",
    previewYaml: "",
    default: true,
    authenticated: true
  };

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<YamlWriterFormState>) => setState((oldState: YamlWriterFormState) => ({ ...oldState, ...newState}));
  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef);
  const previewModalRef = useRef<ModalObject| null>(null);
  useEffectModal(previewModalRef);

  const setAuthenticated = (authenticated: boolean) => {
    setState((prevState) => ({...prevState, authenticated }));
  };

  const addDefaults = () => {
    setState((prevState) => ({
      ...prevState,
      vars: [...getDefaultVars(), ...prevState.vars],
      patterns: [newRampLoadPattern(), newLoadLoadPattern(), ...prevState.patterns],
      loggers: [...getDefaultLoggers(), ...prevState.loggers]
    }));
  };

  const removeAllDefaults = () => {
    setState((prevState) => ({
      ...prevState,
      vars: prevState.vars.filter((v) => ![SESSION_ID, RAMP_TIME, LOAD_TIME, PEAK_LOAD].includes(v.id)),
      patterns: prevState.patterns.filter((pattern) => pattern.id !== RAMP_PATTERN && pattern.id !== LOAD_PATTERN),
      loggers: prevState.loggers.filter((l) => l.id !== LoggerType.ERROR_LOGGER && l.id !== LoggerType.KILL_LOGGER)
    }));
  };

  const hasDefaultVars: boolean = state.vars.find((v) => v.id === SESSION_ID) !== undefined &&
    state.vars.find((v) => v.id === RAMP_TIME) !== undefined &&
    state.vars.find((v) => v.id === LOAD_TIME) !== undefined &&
    state.vars.find((v) => v.id === PEAK_LOAD) !== undefined;

  const hasDefaultPatterns: boolean = state.patterns.find((p) => p.id === RAMP_PATTERN) !== undefined &&
    state.patterns.find((p) => p.id === LOAD_PATTERN) !== undefined;

  const hasDefaultLoggers: boolean = state.loggers.find((l) => l.id === LoggerType.ERROR_LOGGER) !== undefined &&
    state.loggers.find((l) => l.id === LoggerType.KILL_LOGGER) !== undefined;

  // Used in parent App.js
  // When endpoints are finalized in header.js modal, endpoints get sent to here
  const updatePoints = (endpoints: HarEndpoint[]) => {
    for (const point of endpoints) {
      if (point.selected === "yes") {
        addHarEndpoint(point);
      }
    }
  };

  // When Endpoints are added or update in the parent state they are also added in the child state if not already added
  useEffect(() => {
    updatePoints(props.parentEndpoints);
  }, [props.parentEndpoints]);

  // Used for inputting file name, needs to update state on change
  const changeFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.persist();
    setState((prevState) => ({...prevState, fileName: event.target.value }));
  };

  // Sends information to writeyaml.js
  const submitEvent = () => {
    writeFile({
      urls: state.urls,
      patterns: state.patterns,
      vars: state.vars,
      providers: state.providers,
      loggers: state.loggers,
      filename: state.fileName
    });
    return Promise.resolve();
  };

  // Adds endpoint to array
  // Called from clicking add button, or when endpoints are sent from App.js through refs.child.updatePoints
  const addHarEndpoint = (point: HarEndpoint) => {
    if (point && state.urls.length > 0) {
      // If it exists, don't continue;
      if (state.urls.find((url) => url.url === point.url) !== undefined) { return; }
    }
    const headers: PewPewHeader[] = point.headers.map(({ name, value }: HarHeader): PewPewHeader => ({ id: uniqueId(), name, value }));
    const defaultHeaders: PewPewHeader[] = state.default ? getDefaultHeaders(state.authenticated) :
      [...(state.authenticated ? [getAuthorizationHeader()] : [])];
    addUrl({
      id: uniqueId(),
      url: point.url,
      hitRate: "1hpm",
      headers: [...defaultHeaders, ...headers],
      method: point.method,
      authorization: null
    });
  };

  // Adds endpoint to array
  // Called from clicking add button, or when endpoints are sent from App.js through refs.child.updatePoints
  const addUrl = (newUrl: PewPewAPI) => {
    setState(({ urls, ...prevState }: YamlWriterFormState): YamlWriterFormState => {
      return {...prevState, urls: [...urls, newUrl] };
    });
  };

  // Adds header to array in given url
  // Url found by id
  const addHeaders = (urlId: string, newHeaders: PewPewHeader[]) => {
    log("YamlWriterForm addHeaders " + urlId, LogLevel.DEBUG, newHeaders);
    if (newHeaders.length === 0) {
      return;
    }
    setState(({ urls, ...oldState }: YamlWriterFormState): YamlWriterFormState => {
      const url = urls.find((temp) => temp.id === urlId);
      if (url) {
        url.headers = newHeaders[0].id === AUTHENTICATED // Authenticated needs to be first
          ? [...newHeaders, ...(url.headers)]
          : [...(url.headers), ...newHeaders];
        return { ...oldState, urls: [...urls] };
      } else {
      log("addHeaders unknown urlId " + urlId, LogLevel.ERROR, newHeaders);
      return { ...oldState, urls };
      }
    });
  };

  // Removes header from array in given url
  // Url found by id and type of header
  const deleteHeader = (urlId: string, headerId: string) => {
    // Removing header when X button is pressed in urls modal
    log("YamlWriterForm deleteHeader " + headerId, LogLevel.DEBUG, { urlId, headerId });
    setState(({ urls, ...oldState }: YamlWriterFormState): YamlWriterFormState => {
      const url = urls.find((temp) => temp.id === urlId);
      if (url) {
        url.headers = url.headers.filter((header) => header.id !== headerId);
        return { ...oldState, urls: [...urls] };
      } else {
        log("deleteHeader unknown urlId " + urlId, LogLevel.ERROR, { urlId, headerId });
        return { ...oldState, urls };
      }
    });
  };

  // Removes a pattern, vars, or provider from the array. Activated by clicking X button.
  const removeInput = (id: string, inputType: string) => {
    switch (inputType) {
      case URLS:
        setState((prevState) => ({...prevState, urls: prevState.urls.filter((item) => item.id !== id) }));
        break;
      case PATTERNS:
      case RAMP_PATTERN:
      case LOAD_PATTERN:
        setState((prevState) => ({...prevState, patterns: prevState.patterns.filter((item) => item.id !== id) }));
        break;
      case VARS:
        setState((prevState) => ({...prevState, vars: prevState.vars.filter((item) => item.id !== id) }));
        break;
      case PROVIDERS:
      case PROVIDER_FILE:
      case PROVIDER_RESPONSE:
      case PROVIDER_RANGE:
      case PROVIDER_LIST:
        setState((prevState) => ({...prevState, providers: prevState.providers.filter((item) => item.id !== id) }));
        break;
      case LOGGERS:
        setState((prevState) => ({...prevState, loggers: prevState.loggers.filter((item) => item.id !== id) }));
        break;
    }
  };

  // Clears all of the urls, patterns, vars, or providers depending on the click of the Clear All buttons. (for url, clears Urls from parent)
  const clearInput = (inputType: string) => {
    if (inputType === URLS ) { props.clearParentEndpoints(); }
    setState((prevState) => ({...prevState, [inputType]: []}));
  };

  // Changes information about the given endpoint
  const changeUrl = (pewpewUrl: PewPewAPI) => {
    setState(({ urls, ...prevState }): YamlWriterFormState => {
      const index = urls.findIndex((url) => url.id === pewpewUrl.id);
      if (index >= 0) {
        urls[index] = pewpewUrl;
        urls = [...urls];
      }
      return ({...prevState, urls });
    });
  };

  // Adds a new LoadPattern
  const addPattern = (pewpewPattern: PewPewLoadPattern) => {
    setState(({ patterns, ...prevState }): YamlWriterFormState => {
      return ({...prevState, patterns: [...patterns, pewpewPattern] });
    });
  };

  // Changes information about the given LoadPattern
   const changePattern = (pewpewPattern: PewPewLoadPattern) => {
    setState(({ patterns, ...prevState }): YamlWriterFormState => {
      const index = patterns.findIndex((variable) => variable.id === pewpewPattern.id);
      if (index >= 0) {
        patterns[index] = pewpewPattern;
        patterns = [...patterns];
      }
      return ({...prevState, patterns });
    });
  };

  // Adds a new vars
  const addVar = (pewpewVar: PewPewVars) => {
    setState(({ vars, ...prevState }): YamlWriterFormState => {
      return ({...prevState, vars: [...vars, pewpewVar] });
    });
  };

  // Changes information about the vars
  const changeVars = (pewpewVar: PewPewVars) => {
    setState(({ vars, ...prevState }): YamlWriterFormState => {
      const index = vars.findIndex((variable) => variable.id === pewpewVar.id);
      if (index >= 0) {
        vars[index] = pewpewVar;
        vars = [...vars];
      }
      return ({...prevState, vars });
    });
  };

  // Adds a new provider
  const addProvider = (pewpewProvider: PewPewProvider) => {
    setState(({ providers, ...prevState }): YamlWriterFormState => {
      return ({...prevState, providers: [...providers, pewpewProvider] });
    });
  };

  // Changes information about the provider
  const changeProvider = (pewpewProvider: PewPewProvider) => {
    setState(({ providers, ...prevState }): YamlWriterFormState => {
      const index = providers.findIndex((provider) => provider.id === pewpewProvider.id);
      if (index >= 0) {
        providers[index] = pewpewProvider;
        providers = [...providers];
      }
      return ({...prevState, providers });
    });

  };

  const addLogger = (pewpewLogger: PewPewLogger) => {
    setState(({ loggers, ...prevState }):YamlWriterFormState => {
      return { ...prevState, loggers: [...loggers, pewpewLogger] };
    });
  };

  // Changes information about the logger
  const changeLogger = (pewpewLogger: PewPewLogger) => {
    setState(({ loggers, ...prevState }):YamlWriterFormState => {
      const index = loggers.findIndex((logger) => logger.id === pewpewLogger.id);
      if (index >= 0) {
        loggers[index] = pewpewLogger;
        loggers = [...loggers];
      }
      return { ...prevState, loggers };
    });
  };

  // Checks all ready variables, if all is ready, sets create Yaml button to enabled
  const checkReady = (): { ready: boolean, problems?: JSX.Element[] } => {
    let ready: boolean = true;
    const problems: JSX.Element[] = [];
    if (state.urls.length === 0 || (state.patterns.length === 0)) {
      ready = false;
      if (state.urls.length === 0) {
        problems.push(<li key="urls">Please add at least 1 url</li>);
      }
      if (state.patterns.length === 0) {
        problems.push(<li key="patterns">Please add at least 1 load pattern</li>);
      }
    } else {
      const validUrl: boolean = state.urls.every((url: PewPewAPI) => isValidUrl(url.url) && HIT_RATE_REGEX.test(url.hitRate));
      if (!validUrl) {
        problems.push(<li key="urls">At least one url has an invalid url or hitRate</li>);
      }
      const validPatterns = state.patterns.every((pattern: PewPewLoadPattern) => OVER_REGEX.test(pattern.over) && NUMBER_REGEX.test(pattern.to) && (!pattern.from || NUMBER_REGEX.test(pattern.from)));
      if (!validPatterns) {
        problems.push(<li key="patterns">At least one pattern is invalid</li>);
      }
      const validVars = state.vars.every((variable: PewPewVars) =>
        NAME_REGEX.test(variable.name) && variable.name.length > 0 && VALUE_REGEX.test(variable.value) && variable.value.length > 0
      );
      if (!validVars) {
        problems.push(<li key="vars">At least one variable has an invalid name or value</li>);
      }
      const validProviders = state.providers.every((provider: PewPewProvider) => NAME_REGEX.test(provider.name) && provider.name.length > 0
        && (provider.type !== "list" || (provider.list && provider.list.length > 0)));
      if (!validProviders) {
        problems.push(<li key="providers">At least one provider has invalid data</li>);
      }
      const validLoggers = state.loggers.every((logger: PewPewLogger) => NAME_REGEX.test(logger.name) && logger.name.length > 0);
      if (!validLoggers) {
        problems.push(<li key="loggers">At least one logger has invalid data</li>);
      }
      ready = ready && validUrl && validPatterns && validVars && validProviders && validLoggers;
      log("checkReady", LogLevel.DEBUG, {ready, validUrl, validPatterns, validVars, validProviders, validLoggers });
    }
    return { ready, problems };
  };

  // Flips the state of any boolean variable to be the opposite of that variable type
  const handleClick = (varsType: YamlWriterBooleanState, newChecked: boolean) => {
    setState((prevState: YamlWriterFormState): YamlWriterFormState => ({...prevState, [varsType]: newChecked}));
  };

  const openPreviewModal = () => {
    try {
      const previewYaml = createYamlString({
        urls: state.urls,
        patterns: state.patterns,
        vars: state.vars,
        providers: state.providers,
        loggers: state.loggers
      });
      updateState({ previewYaml });
    } catch (error) {
      log("Could not create Preview of Yaml", LogLevel.ERROR, error);
      updateState({ previewYaml: `Error: Could not create the yaml preview:  + ${(error as any)?.message || error}` });
    }
    previewModalRef.current?.openModal();
  };

  const isPreviewYamlError = state.previewYaml.startsWith("Error");

  return (
    <DisplayDivMain>
      <DisplayDivBody>
        <InputsDiv>
          <Row style={{ justifyContent: "start" }}>
            <Button onClick={() => modalRef.current?.openModal()}>
              Create Yaml
            </Button>
            <Button onClick={openPreviewModal}>
              Preview Yaml
            </Button>
          </Row>
          <Row style={{ justifyContent: "start" }}>
            <ToggleDefaults
              title="Yaml"
              handleAddMissing={addDefaults}
              handleDeleteAll={removeAllDefaults}
              addDisabled={hasDefaultVars && hasDefaultPatterns && hasDefaultLoggers}
              deleteDisabled={!hasDefaultVars && !hasDefaultPatterns && !hasDefaultLoggers}
            />
            <QuestionBubble text="Includes default, easy to use values for Variables, Load Patterns, and Loggers. Also includes authenticated headers"></QuestionBubble>
          </Row>

          <label htmlFor={AUTHENTICATED}> Authenticated </label>
          <QuestionBubble text="Creates sessionId variable and adds authentication header to every endpoint"></QuestionBubble>
          <Checkbox type="checkbox" id={AUTHENTICATED} onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleClick(AUTHENTICATED, event.target.checked)} checked={state.authenticated} />
        </InputsDiv>
      </DisplayDivBody>
      <DisplayDivBody>
        <Endpoints
          addUrl={addUrl}
          clearAllUrls={() => clearInput(URLS)}
          deleteUrl={(urlId: string) => removeInput(urlId, URLS)}
          changeUrl={changeUrl}
          addHeaders={addHeaders}
          deleteHeader={deleteHeader}
          defaultYaml={state.default}
          authenticated={state.authenticated}
          urls={state.urls}
          peakLoad={state.vars.find((variable) => variable.name === "peakLoad")?.name}
        />
        <Vars
          addVar={addVar}
          clearAllVars={() => clearInput(VARS)}
          deleteVar={(varId: string) => removeInput(varId, VARS)}
          changeVar={changeVars}
          authenticated={state.authenticated}
          setAuthenticated={setAuthenticated}
          vars={state.vars}
        />
        <LoadPatterns
          addPattern={addPattern}
          clearAllPatterns={() => clearInput(PATTERNS)}
          deletePattern={(patternId: string) => removeInput(patternId, PATTERNS)}
          changePattern={changePattern}
          patterns={state.patterns}
          vars={state.vars}
        />
        <Providers
          addProvider={addProvider}
          clearAllProviders={() => clearInput(PROVIDERS)}
          deleteProvider={(patternId: string) => removeInput(patternId, PROVIDERS)}
          changeProvider={changeProvider}
          providers={state.providers}
        />
        <Loggers
          addLogger={addLogger}
          clearAllLoggers={() => clearInput(LOGGERS)}
          deleteLogger={(loggerId: string) => removeInput(loggerId, LOGGERS)}
          changeLogger={changeLogger}
          loggers={state.loggers}
        />
        <Modal
          ref={modalRef}
          title="File Name"
          onSubmit={submitEvent}
          submitText={checkReady().ready ? "Create Yaml" : "Create Template"}
          closeText="Cancel"
          isReady={state.fileName !== ""}
        >
          {!checkReady().ready && <>
            <h3 style={{ textAlign: "left" }}>Cannot create a Yaml due to problems:</h3>
            <ul>{checkReady().problems}</ul>
            <h4 style={{ textAlign: "left" }}>Create a template instead with missing values?</h4>
            <Div>&nbsp;</Div>
          </>}
          <Label>
            File Name:&nbsp;
            <Input style={{width: "150px"}} onChange={changeFile} value={state.fileName} />.yaml
          </Label>
        </Modal>
        <Modal
          ref={previewModalRef}
          title="Yaml Preview"
          closeText="Cancel"
        >
          <YamlViewer yamlContents={state.previewYaml} error={isPreviewYamlError ? state.previewYaml : undefined} />
        </Modal>
      </DisplayDivBody>
    </DisplayDivMain>
  );
};

export default YamlWriterForm;
