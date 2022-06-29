import { CSSTransition, TransitionGroup } from "react-transition-group";
import { Checkbox, Div, InputsDiv, Label, Span} from "../YamlStyles";
import {
  DEV_KEY_BETA,
  LOAD_TIME_DEFAULT,
  PEAK_LOAD_DEFAULT,
  PewPewVars,
  RAMP_TIME_DEFAULT,
  SESSION_ID_DEFAULT
} from "../../util/yamlwriter";
import { LogLevel, log } from "../../util/log";
import React, { useEffect, useState } from "react";
import QuestionBubble from "../YamlQuestionBubble";
import VarsDropDown from "./DropDown";
import { uniqueId } from "../../util/clientutil";

export type PewPewVarsStringType = "name" | "value";
interface DefaultVariables {
  sessionId: boolean;
  rampTime: boolean;
  loadTime: boolean;
  peakLoad: boolean;
  devKey: boolean;
}

type DefaultVariablesType = keyof DefaultVariables;

// This is the default state of all checkboxes and drop downs when the UI is initially loaded
const defaultUI: DefaultVariables = {
  devKey: false,
  rampTime: true,
  loadTime: true,
  peakLoad: true,
  sessionId: true
};
const defaultEnvironment = DEV_KEY_BETA;

export interface VarsProps {
  addVar: (pewpewVar: PewPewVars) => void;
  clearAllVars: () => void;
  deleteVar: (varId: string) => void;
  changeVar: (pewpewVar: PewPewVars) => void;
  defaultYaml: boolean;
  authenticated: boolean;
  vars: PewPewVars[];
}

interface VarsState extends DefaultVariables {
  nameReady: boolean;
  valueReady: boolean;
  defaultVars: boolean;
  environment: string;
}
export const vars = "vars";
const sessionId = "sessionId";
const rampTime = "rampTime";
const loadTime = "loadTime";
const peakLoad = "peakLoad";
const devKey = "devKey";
const defaultVars = "defaultVars";

export const newVar = (varId: string = uniqueId()): PewPewVars => ({ id: varId, name: "", value: "" });
export const devKeyVar = (environment: string): PewPewVars => ({ id: devKey, name: devKey, value: environment });
export const rampTimeVar = (): PewPewVars => ({ id: rampTime, name: rampTime, value: RAMP_TIME_DEFAULT });
export const loadTimeVar = (): PewPewVars => ({ id: loadTime, name: loadTime, value: LOAD_TIME_DEFAULT });
export const peakLoadVar = (): PewPewVars => ({ id: peakLoad, name: peakLoad, value: PEAK_LOAD_DEFAULT });
export const sessionIdVar = (): PewPewVars => ({ id: sessionId, name: sessionId, value: SESSION_ID_DEFAULT });

function getDefaultVar (varName: DefaultVariablesType, environment: string): PewPewVars {
  switch (varName) {
    case sessionId:
      return sessionIdVar();
    case rampTime:
      return rampTimeVar();
    case loadTime:
      return loadTimeVar();
    case peakLoad:
      return peakLoadVar();
    case devKey:
      return devKeyVar(environment);
    default:
      throw new Error("getDefaultVar Invalid varName: " + varName);
  }
}

export function getDefaultVars (defaultVars: DefaultVariables = defaultUI, environment: string = defaultEnvironment): PewPewVars[] {
  const pewpewVars: PewPewVars[] = [];
  for (const [varName, isEnabled] of Object.entries(defaultVars)) {
    if (isEnabled) {
      pewpewVars.push(getDefaultVar(varName as DefaultVariablesType, environment));
    }
  }

  return pewpewVars;
}

export function Vars ({ authenticated, defaultYaml, ...props }: VarsProps) {
  const defaultState: VarsState = {
    nameReady: false,
    valueReady: false,
    defaultVars: defaultYaml,
    ...defaultUI,
    environment: defaultEnvironment
  };
  /** Map to keep id's unique */
  const varsMap = new Map(props.vars.map((pewpewVar) => ([pewpewVar.id, pewpewVar])));

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<VarsState>) => setState((oldState): VarsState => ({ ...oldState, ...newState }));

  // The parent needs to prepopulate the vars based on the defaultYaml

  // Change when the parent changes
  useEffect(() => {
    switchAllDefaults(defaultYaml);
  }, [defaultYaml]);

  // Change when the parent changes
  useEffect(() => {
    switchSessionId(authenticated);
  }, [authenticated]);

  const handleClickDefault = (event: React.ChangeEvent<HTMLInputElement>) => {
    switchAllDefaults(event.target.checked);
  };

  const switchSessionId = (newChecked: boolean) => {
    switchDefault(sessionId, newChecked);
  };

  // Switching the default should remove the vars or add all of them to the vars
  // Can be called via a click, or via a prop from the defaultYaml checkbox from the parent
  const switchAllDefaults = (newChecked: boolean) => {
    switchDefault(loadTime, newChecked);
    switchDefault(rampTime, newChecked);
    switchDefault(peakLoad, newChecked);
    updateState({ defaultVars: newChecked });
  };

  const switchDefault = (varsType: DefaultVariablesType, newChecked: boolean) => {
    updateState({ [varsType]: newChecked });
    // Add/delete from varsMap/vars
    if (newChecked && !varsMap.has(varsType)) {
      // Add it (will update the map when it comes back in via props)
      const newVar = getDefaultVar(varsType, state.environment);
      props.addVar(newVar);
    } else if (!newChecked && varsMap.has(varsType)) {
      // Remove it (will update the map when it comes back in via props)
      props.deleteVar(varsType);
    }
  };

  const changeVars = (pewpewVar: PewPewVars, type: PewPewVarsStringType, value: string) => {
    pewpewVar[type] = value;
    props.changeVar(pewpewVar);
  };

  const deleteVar = (varId: string) => {
    if (varId in defaultUI) {
      // This will do the props.deleteVar()
      switchDefault(varId as DefaultVariablesType, false);
    } else {
      props.deleteVar(varId);
    }
  };

  const clearAllVars = () => {
    updateState({ defaultVars: false, sessionId: false, rampTime: false, loadTime: false, peakLoad: false, devKey: false });
    props.clearAllVars();
  };

  const changeEnvironment = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateState({ environment: event.target.value });
    const devKeyVar = varsMap.get(devKey);
    if (devKeyVar) {
      devKeyVar.value = event.target.value;
      props.changeVar(devKeyVar);
    } else {
      log("Environment changed without devKey variable existing", LogLevel.WARN);
    }
  };

  return (
    <InputsDiv>
      <button onClick={() => props.addVar(newVar())}>
        Add Vars
      </button>
      <button onClick={clearAllVars}>
        Clear All Vars
      </button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Variables" href="https://familysearch.github.io/pewpew/config/vars-section.html"></QuestionBubble>
      &nbsp;&nbsp;

      <label htmlFor={defaultVars}> Default Vars </label>
      <QuestionBubble text="Default Vars include ramptime, loadtime, and peakload"></QuestionBubble>
      <Checkbox type="checkbox" id={defaultVars} onChange={handleClickDefault} checked={state.defaultVars} />

      <Div>
        <Span>
          <Label htmlFor={sessionId}> sessionId: </Label>
          <QuestionBubble text="sessionId included"></QuestionBubble>
          <Checkbox type="checkbox" id={sessionId} onChange={(event) => switchDefault(sessionId, event.target.checked)} checked={state.sessionId}/>
        </Span>
        <Span>
          <Label htmlFor={rampTime}> ramptime: </Label>
          <QuestionBubble text="rampTime included"></QuestionBubble>
          <Checkbox type="checkbox" id={rampTime} onChange={(event) => switchDefault(rampTime, event.target.checked)} checked={state.rampTime}/>
        </Span>
        <Span>
          <Label htmlFor={loadTime}> loadtime: </Label>
          <QuestionBubble text="loadTime included"></QuestionBubble>
          <Checkbox type="checkbox" id={loadTime} onChange={(event) => switchDefault(loadTime, event.target.checked)} checked={state.loadTime}/>
        </Span>
        <Span>
          <Label htmlFor={peakLoad}> peakload: </Label>
          <QuestionBubble text="peakLoad included"></QuestionBubble>
          <Checkbox type="checkbox" id={peakLoad} onChange={(event) => switchDefault(peakLoad, event.target.checked)} checked={state.peakLoad}/>
        </Span>
        <div>
          <Span>
            <Label htmlFor={devKey}> devkey: </Label>
            <QuestionBubble text="devKey included"></QuestionBubble>
            <input type="checkbox" id={devKey} onChange={(event) => switchDefault(devKey, event.target.checked)} checked={state.devKey}/>
          </Span>
          <VarsDropDown display={state.devKey} onChange={changeEnvironment} />
        </div>
      </Div>
      <TransitionGroup className="loadPatter-section_list">
        {Array.from(varsMap.values()).map((pewpewVar: PewPewVars) => (
          <CSSTransition key={pewpewVar.id} timeout={300} classNames="load">
            <Div>
              <Span>
                <Label> Name: </Label>
                <QuestionBubble text="Required | name of variable"></QuestionBubble>
                <input
                  type="text"
                  style={{width: "130px"}}
                  onChange={(event) => changeVars(pewpewVar, "name", event.target.value)}
                  name={pewpewVar.id}
                  value={pewpewVar.name}
                  id="name"
                />
              </Span>
              <Span>
                <Label> Value: </Label>
                <QuestionBubble text="Required | value of variable"></QuestionBubble>
                <input
                  type="text"
                  style={{width: "130px"}}
                  onChange={(event) => changeVars(pewpewVar, "value", event.target.value)}
                  name={pewpewVar.id}
                  value={pewpewVar.value}
                  id="value"
                />
              </Span>
              <button id={pewpewVar.id} onClick={() => deleteVar(pewpewVar.id)}>X</button>
            </Div>
          </CSSTransition>
        ))}
      </TransitionGroup>
    </InputsDiv>
  );
}

export default Vars;
