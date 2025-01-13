import { CSSTransition, TransitionGroup } from "react-transition-group";
import { Checkbox, Div, InputsDiv, Label, Span} from "../YamlStyles";
import {
  LOAD_TIME_DEFAULT,
  PEAK_LOAD_DEFAULT,
  PewPewVars,
  RAMP_TIME_DEFAULT,
  SESSION_ID_DEFAULT
} from "../../util/yamlwriter";
import React, { useEffect, useRef, useState } from "react";
import QuestionBubble from "../YamlQuestionBubble";
import VarInput from "./VarInput";
import { uniqueId } from "../../util/clientutil";

export type PewPewVarsStringType = "name" | "value";
interface DefaultVariables {
  sessionId: boolean;
  rampTime: boolean;
  loadTime: boolean;
  peakLoad: boolean;
}

type DefaultVariablesType = keyof DefaultVariables;

// This is the default state of all checkboxes and drop downs when the UI is initially loaded
const defaultUI: DefaultVariables = {
  rampTime: true,
  loadTime: true,
  peakLoad: true,
  sessionId: true
};

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
}
export const VARS = "vars";
const SESSION_ID = "sessionId";
const RAMP_TIME = "rampTime";
const LOAD_TIME = "loadTime";
const PEAK_LOAD = "peakLoad";
const DEFAULT_VARS = "defaultVars";

export const emptyVar = (varId: string = uniqueId()): PewPewVars => ({ id: varId, name: "", value: "" });
export const rampTimeVar = (): PewPewVars => ({ id: RAMP_TIME, name: RAMP_TIME, value: RAMP_TIME_DEFAULT });
export const loadTimeVar = (): PewPewVars => ({ id: LOAD_TIME, name: LOAD_TIME, value: LOAD_TIME_DEFAULT });
export const peakLoadVar = (): PewPewVars => ({ id: PEAK_LOAD, name: PEAK_LOAD, value: PEAK_LOAD_DEFAULT });
export const sessionIdVar = (): PewPewVars => ({ id: SESSION_ID, name: SESSION_ID, value: SESSION_ID_DEFAULT });

function getDefaultVar (varName: DefaultVariablesType): PewPewVars {
  switch (varName) {
    case SESSION_ID:
      return sessionIdVar();
    case RAMP_TIME:
      return rampTimeVar();
    case LOAD_TIME:
      return loadTimeVar();
    case PEAK_LOAD:
      return peakLoadVar();
    default:
      throw new Error("getDefaultVar Invalid varName: " + varName);
  }
}

export function getDefaultVars (defaultVars: DefaultVariables = defaultUI): PewPewVars[] {
  const pewpewVars: PewPewVars[] = [];
  for (const [varName, isEnabled] of Object.entries(defaultVars)) {
    if (isEnabled) {
      pewpewVars.push(getDefaultVar(varName as DefaultVariablesType));
    }
  }

  return pewpewVars;
}

export function Vars ({ authenticated, defaultYaml, ...props }: VarsProps) {
  const defaultState: VarsState = {
    nameReady: false,
    valueReady: false,
    defaultVars: defaultYaml,
    ...defaultUI
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
    switchDefault(SESSION_ID, newChecked);
  };

  // Switching the default should remove the vars or add all of them to the vars
  // Can be called via a click, or via a prop from the defaultYaml checkbox from the parent
  const switchAllDefaults = (newChecked: boolean) => {
    switchDefault(LOAD_TIME, newChecked);
    switchDefault(RAMP_TIME, newChecked);
    switchDefault(PEAK_LOAD, newChecked);
    updateState({ defaultVars: newChecked });
  };

  const switchDefault = (varsType: DefaultVariablesType, newChecked: boolean) => {
    updateState({ [varsType]: newChecked });
    // Add/delete from varsMap/vars
    if (newChecked && !varsMap.has(varsType)) {
      // Add it (will update the map when it comes back in via props)
      const defaultVar = getDefaultVar(varsType);
      props.addVar(defaultVar);
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
    updateState({ defaultVars: false, sessionId: false, rampTime: false, loadTime: false, peakLoad: false });
    props.clearAllVars();
  };

  // https://github.com/reactjs/react-transition-group/issues/904
  // http://reactcommunity.org/react-transition-group/transition#Transition-prop-nodeRef
  const nodeRef = useRef(null);
  return (
    <InputsDiv>
      <button onClick={() => props.addVar(emptyVar())}>
        Add Vars
      </button>
      <button onClick={clearAllVars}>
        Clear All Vars
      </button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Variables" href="https://familysearch.github.io/pewpew/config/vars-section.html"></QuestionBubble>
      &nbsp;&nbsp;

      <label htmlFor={DEFAULT_VARS}> Default Vars </label>
      <QuestionBubble text="Default Vars include ramptime, loadtime, and peakload"></QuestionBubble>
      <Checkbox type="checkbox" id={DEFAULT_VARS} onChange={handleClickDefault} checked={state.defaultVars} />

      <Div>
        {[SESSION_ID, RAMP_TIME, LOAD_TIME, PEAK_LOAD].map((varName) => {
          const stateKey = varName as DefaultVariablesType;
          // TODO: Should these be read only?
          return (
            <Span>
              <Label htmlFor={varName}> {varName}: </Label>
              <QuestionBubble text={`${varName} included`}></QuestionBubble>
              <Checkbox type="checkbox" id={varName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => switchDefault(varName as keyof DefaultVariables, event.target.checked)} checked={state[stateKey]}/>
            </Span>
          );
        })}
      </Div>
      <TransitionGroup className="loadPatter-section_list" nodeRef={nodeRef}>
        {Array.from(varsMap.values()).map((pewpewVar: PewPewVars) => (
          <CSSTransition key={pewpewVar.id} timeout={300} classNames="load" nodeRef={nodeRef}>
            <VarInput pewpewVar={pewpewVar} changeVars={changeVars} deleteVar={deleteVar} />
          </CSSTransition>
        ))}
      </TransitionGroup>
    </InputsDiv>
  );
}

export default Vars;
