import { CSSTransition, TransitionGroup } from "react-transition-group";
import { Checkbox, Div, InputsDiv, Label, Span} from "../YamlStyles";
import React, { useEffect, useState } from "react";
import { PewPewLoadPattern } from "../../util/yamlwriter";
import QuestionBubble from "../YamlQuestionBubble";
import { uniqueId } from "../../util/clientutil";

export type PewPewLoadPatternStringType = "from" | "to" | "over";

export interface LoadPatternProps {
  addPattern: (pewpewPattern: PewPewLoadPattern) => void;
  clearAllPatterns: () => void;
  deletePattern: (id: string) => void;
  changePattern: (pewpewPattern: PewPewLoadPattern) => void;
  defaultYaml: boolean;
  patterns: PewPewLoadPattern[];
}

interface LoadPatternState {
  defaultPatterns: boolean;
}

export const overReg = new RegExp("^((((\\d+)\\s?(h|hr|hrs|hour|hours))\\s?)?(((\\d+)\\s?(m|min|mins|minute|minutes))\\s?)?(((\\d+)\\s?(s|sec|secs|second|seconds)))?)$");
export const numReg = new RegExp("^[+]?([0-9]+(?:[\\.][0-9]*)?|\\.[0-9]+)$");
export const patterns = "patterns";
export const rampPattern = "rampPattern";
export const loadPattern = "loadPattern";

export const newLoadPattern = (patternId: string = uniqueId()): PewPewLoadPattern => ({ id: patternId, from: "", to: "", over: "" });
export const newRampLoadPattern = (): PewPewLoadPattern => ({ id: rampPattern, from: "10", to: "100", over: "15m" });
export const newLoadLoadPattern = (): PewPewLoadPattern => ({ id: loadPattern, from: "100", to: "100", over: "15m" });


const errorColor: React.CSSProperties = { color: "red" };

export function LoadPatterns ({ defaultYaml, patterns, ...props }: LoadPatternProps) {
  const defaultState: LoadPatternState = {
      defaultPatterns: defaultYaml
  };
  /** Map to keep id's unique */
  const loadPatternsMap = new Map(patterns.map((pewpewPattern) => ([pewpewPattern.id, pewpewPattern])));

  const [state, setState] = useState(defaultState);
  const updateState = (newState: Partial<LoadPatternState>) => setState((oldState): LoadPatternState => ({ ...oldState, ...newState }));

  useEffect(() => {
    switchDefault(defaultYaml);
  }, [defaultYaml]);

  const handleClickDefault = (event: React.ChangeEvent<HTMLInputElement>) => {
    switchDefault(event.target.checked);
  };

  const switchDefault = (newChecked: boolean) => {
    if (newChecked && !loadPatternsMap.has(rampPattern)) {
      // Add it (will update the map when it comes back in via props)
      props.addPattern(newRampLoadPattern());
    } else if (!newChecked && loadPatternsMap.has(rampPattern)) {
      // Remove it (will update the map when it comes back in via props)
      props.deletePattern(rampPattern);
    }
    if (newChecked && !loadPatternsMap.has(loadPattern)) {
      // Add it (will update the map when it comes back in via props)
      props.addPattern(newLoadLoadPattern());
    } else if (!newChecked && loadPatternsMap.has(loadPattern)) {
      // Remove it (will update the map when it comes back in via props)
      props.deletePattern(loadPattern);
    }
    updateState({ defaultPatterns: newChecked });
  };

  const changePattern = (pewpewPattern: PewPewLoadPattern, type: PewPewLoadPatternStringType, value: string) => {
    pewpewPattern[type] = value;
    props.changePattern(pewpewPattern);
  };

  const deletePattern = (patternId: string) => {
    if (patternId === rampPattern || patternId === loadPattern) {
      updateState({ defaultPatterns: false });
    }
    props.deletePattern(patternId);
  };

  const clearAllPatterns = () => {
    updateState({ defaultPatterns: false });
    props.clearAllPatterns();
  };

  return (
  <InputsDiv>
    <button onClick={() => props.addPattern(newLoadPattern())}>
      Add Pattern
    </button>
    <button onClick={clearAllPatterns}>
      Clear All Patterns
    </button>&nbsp;&nbsp;
    <QuestionBubble text="Click here for more information about Load Patterns" href="https://familysearch.github.io/pewpew/config/load_pattern-section.html"></QuestionBubble>
    &nbsp;&nbsp;

    <label htmlFor="defaultPatterns"> Default Patterns </label>
    <QuestionBubble text="Set Default load and ramp time patterns"></QuestionBubble>
    <Checkbox type="checkbox" id="defaultPatterns" name="defaultPatterns" onChange={handleClickDefault} checked={state.defaultPatterns} />

    <TransitionGroup className="loadPatter-section_list">
      {Array.from(loadPatternsMap.values()).map((pewpewPattern: PewPewLoadPattern) => {
        // TODO: Do we want to check if they're greater than 0?
        const validFrom: boolean = !pewpewPattern.from || numReg.test(pewpewPattern.from);
        const validTo: boolean = numReg.test(pewpewPattern.to);
        const validOver: boolean = overReg.test(pewpewPattern.over);
        return <CSSTransition key={pewpewPattern.id} timeout={300} classNames="load">
          <Div>
            <Span>
              <Label> From: </Label>
              <QuestionBubble text="Optional | Percent load start"></QuestionBubble>
              <input
                type="text"
                style={{ width: "170px", color: validFrom ? undefined : errorColor.color }}
                onChange={(event) => changePattern(pewpewPattern, "from", event.target.value)}
                name={pewpewPattern.id}
                id="from"
                value={pewpewPattern.from}
                title={validFrom ? undefined : "Invalid From"}
              />
              <i className="fa fa-percent percentIcon"></i>
            </Span>
            <Span>
              <Label> To: </Label>
              <QuestionBubble text="Required | Percent load end"></QuestionBubble>
              <input
                type="text"
                style={{ width: "170px", color: validTo ? undefined : errorColor.color }}
                onChange={(event) => changePattern(pewpewPattern, "to", event.target.value)}
                name={pewpewPattern.id}
                id="to"
                value={pewpewPattern.to}
                title={validTo ? undefined : "Invalid To"}
              />
              <i className="fa fa-percent percentIcon"></i>
            </Span>
            <Span>
              <Label> Over: </Label>
              <QuestionBubble text="Required | See link for accepted input" href="https://familysearch.github.io/pewpew/config/common-types.html#duration"></QuestionBubble>
              <input
                type="text"
                style={{ width: "170px", color: validOver ? undefined : errorColor.color }}
                onChange={(event) => changePattern(pewpewPattern, "over", event.target.value)}
                name={pewpewPattern.id}
                id="over"
                value={pewpewPattern.over}
                title={validOver ? undefined : "Invalid Over"}
              />
            </Span>
            <button id={pewpewPattern.id} onClick={() => deletePattern(pewpewPattern.id)}>X</button>
          </Div>
        </CSSTransition>;
      })}
    </TransitionGroup>
  </InputsDiv>
  );
}

export default LoadPatterns;
