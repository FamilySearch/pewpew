import { Button, Div, InputsDiv, TipButton } from "../YamlStyles";
import {
  LOAD_TIME_DEFAULT,
  PEAK_LOAD_DEFAULT,
  PewPewVars,
  RAMP_TIME_DEFAULT,
  SESSION_ID_DEFAULT
} from "../../util/yamlwriter";
import React, { useEffect } from "react";
import QuestionBubble from "../YamlQuestionBubble";
import { Row } from "../Div";
import ToggleDefaults from "../ToggleDefaults/ToggleDefaults";
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
  authenticated: boolean;
  setAuthenticated: (authenticated: boolean) => void;
  vars: PewPewVars[];
}

export const VARS = "vars";
export const SESSION_ID = "sessionId";
export const RAMP_TIME = "rampTime";
export const LOAD_TIME = "loadTime";
export const PEAK_LOAD = "peakLoad";

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

export function Vars ({ authenticated, ...props }: VarsProps) {
  /** Map to keep id's unique */
  const varsMap = new Map(props.vars.map((pewpewVar) => ([pewpewVar.id, pewpewVar])));

  // Change when the parent changes
  useEffect(() => {
    switchSessionId(authenticated);
  }, [authenticated]);

  const switchSessionId = (newChecked: boolean) => {
    switchDefault(SESSION_ID, newChecked);
  };

  // Switching the default should remove the vars or add all of them to the vars
  // Can be called via a click, or via a prop from the defaultYaml checkbox from the parent
  const switchAllDefaults = (newChecked: boolean) => {
    switchDefault(LOAD_TIME, newChecked);
    switchDefault(RAMP_TIME, newChecked);
    switchDefault(PEAK_LOAD, newChecked);
    switchDefault(SESSION_ID, newChecked);
  };

  const switchDefault = (varsType: DefaultVariablesType, newChecked: boolean) => {
    if (varsType === SESSION_ID) {
      props.setAuthenticated(newChecked);
    }
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
    props.clearAllVars();
  };

  const getDefaultVarExplanation = (varName: DefaultVariablesType): string => {
    switch (varName) {
      case SESSION_ID:
        return "Session ID is the authentication token for the endpoints.";
      case RAMP_TIME:
        return "Ramp Time is the time it takes to ramp up to the peak load.";
      case LOAD_TIME:
        return "Load Time is the time the peak load is sustained.";
      case PEAK_LOAD:
        return "Peak Load is the maximum number of requests per minute.";
      default:
        throw new Error("getDefaultVarExplanation Invalid varName: " + varName);
    }
  };

  return (
    <InputsDiv>
      <Row style={{ justifyContent: "start" }}>
        <Button onClick={() => props.addVar(emptyVar())}>
          Add Var
        </Button>
        <Button onClick={clearAllVars}>
          Clear All Vars
        </Button>
      </Row>
      <Row style={{ justifyContent: "start" }}>
        <ToggleDefaults
          title="Vars"
          handleAddMissing={() => switchAllDefaults(true)}
          handleDeleteAll={() => switchAllDefaults(false)}
          addDisabled={[RAMP_TIME, LOAD_TIME, PEAK_LOAD].every((varName) => varsMap.has(varName))}
          deleteDisabled={![RAMP_TIME, LOAD_TIME, PEAK_LOAD].some((varName) => varsMap.has(varName))}
        />
        <QuestionBubble text="Click here for more information about Variables" href="https://familysearch.github.io/pewpew/config/vars-section.html"></QuestionBubble>
      </Row>

      {Array.from(varsMap.values()).map((pewpewVar: PewPewVars) => (
          <VarInput pewpewVar={pewpewVar} changeVars={changeVars} deleteVar={deleteVar} />
      ))}
      {[SESSION_ID, RAMP_TIME, LOAD_TIME, PEAK_LOAD].filter((value) => !varsMap.has(value)).map((varName) => {
        return (
          <Div key={varName}>
            <TipButton id={varName} onClick={() => switchDefault(varName as keyof DefaultVariables, true)}>
              Add {varName}
              <span>{getDefaultVarExplanation(varName as DefaultVariablesType)}</span>
            </TipButton>
          </Div>
        );
      })}
    </InputsDiv>
  );
}

export default Vars;
