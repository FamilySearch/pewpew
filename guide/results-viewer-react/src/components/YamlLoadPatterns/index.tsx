import { Button, Div, Input, InputsDiv, Label, Span} from "../YamlStyles";
import { CSSTransition, TransitionGroup } from "react-transition-group";
import { PewPewLoadPattern, PewPewVars } from "../../util/yamlwriter";
import React, { useEffect, useMemo, useRef } from "react";
import { DeleteIcon } from "../Icons/DeleteIcon";
import QuestionBubble from "../YamlQuestionBubble";
import { Row } from "../Div";
import ToggleDefaults from "../ToggleDefaults/ToggleDefaults";
import { uniqueId } from "../../util/clientutil";

export type PewPewLoadPatternStringType = "from" | "to" | "over";

export interface LoadPatternProps {
  addPattern: (pewpewPattern: PewPewLoadPattern) => void;
  clearAllPatterns: () => void;
  deletePattern: (id: string) => void;
  changePattern: (pewpewPattern: PewPewLoadPattern) => void;
  patterns: PewPewLoadPattern[];
  vars: PewPewVars[];
}

export const OVER_REGEX = new RegExp("^((((\\d+)\\s?(h|hr|hrs|hour|hours))\\s?)?(((\\d+)\\s?(m|min|mins|minute|minutes))\\s?)?(((\\d+)\\s?(s|sec|secs|second|seconds)))?)$|^\\$\\{[a-zA-Z][a-zA-Z0-9]*\\}$");
export const NUMBER_REGEX = new RegExp("^[+]?([0-9]+(?:[\\.][0-9]*)?|\\.[0-9]+)$");
export const PATTERNS = "patterns";
export const RAMP_PATTERN = "rampPattern";
export const LOAD_PATTERN = "loadPattern";

export const newLoadPattern = (patternId: string = uniqueId()): PewPewLoadPattern => ({ id: patternId, from: "", to: "", over: "" });
export const newRampLoadPattern = (): PewPewLoadPattern => ({ id: RAMP_PATTERN, from: "10", to: "100", over: "15m" });
export const newLoadLoadPattern = (): PewPewLoadPattern => ({ id: LOAD_PATTERN, from: "100", to: "100", over: "15m" });

const errorColor: React.CSSProperties = { color: "red" };

export function LoadPatterns ({ patterns, vars, ...props }: LoadPatternProps) {
  /** Map to keep id's unique */
  // const loadPatternsMap = new Map(patterns.map((pewpewPattern) => ([pewpewPattern.id, pewpewPattern])));

  const rampTime = useMemo(() => vars.find((pewpewVar) => pewpewVar.id === "rampTime"), [vars]);
  const loadTime = useMemo(() => vars.find((pewpewVar) => pewpewVar.id === "loadTime"), [vars]);

  const switchDefault = (newChecked: boolean) => {
    if (newChecked && !patterns.find((p) => p.id === RAMP_PATTERN)) {
      // Add it (will update the map when it comes back in via props)
      props.addPattern(rampTime ? {...newRampLoadPattern(), over: "${" + rampTime.name + "}"} : newRampLoadPattern());
    } else if (!newChecked && patterns.find((p) => p.id === RAMP_PATTERN)) {
      // Remove it (will update the map when it comes back in via props)
      props.deletePattern(RAMP_PATTERN);
    }
    if (newChecked && !patterns.find((p) => p.id === LOAD_PATTERN)) {
      // Add it (will update the map when it comes back in via props)
      props.addPattern(loadTime ? {...newLoadLoadPattern(), over: "${" + loadTime.name + "}"} : newLoadLoadPattern());
    } else if (!newChecked && patterns.find((p) => p.id === LOAD_PATTERN)) {
      // Remove it (will update the map when it comes back in via props)
      props.deletePattern(LOAD_PATTERN);
    }
  };

  useEffect(() => {
    handleRampTimeChange();
    handleLoadTimeChange();
  }, [vars]);

  const handleRampTimeChange = () => {
    if (!patterns.find((p) => p.id === RAMP_PATTERN)) {
      props.addPattern(rampTime ? {...newRampLoadPattern(), over: "${" + rampTime.name + "}"} : newRampLoadPattern());
    } else {
      changePattern(patterns.find((p) => p.id === RAMP_PATTERN) as PewPewLoadPattern, "over", rampTime ? "${" + rampTime.name + "}" : "15m");
    }
  };

  const handleLoadTimeChange = () => {
    if (!patterns.find((p) => p.id === LOAD_PATTERN)) {
      props.addPattern(loadTime ? {...newLoadLoadPattern(), over: "${" + loadTime.name + "}"} : newLoadLoadPattern());
    } else {
      changePattern(patterns.find((p) => p.id === LOAD_PATTERN) as PewPewLoadPattern, "over", loadTime ? "${" + loadTime.name + "}" : "15m");
    }
  };

  const changePattern = (pewpewPattern: PewPewLoadPattern, type: PewPewLoadPatternStringType, value: string) => {
    pewpewPattern[type] = value;
    props.changePattern(pewpewPattern);
  };

  const deletePattern = (patternId: string) => {
    props.deletePattern(patternId);
  };

  const clearAllPatterns = () => {
    props.clearAllPatterns();
  };

  // https://github.com/reactjs/react-transition-group/issues/904
  // http://reactcommunity.org/react-transition-group/transition#Transition-prop-nodeRef
  const nodeRef = useRef(null);
  return (
  <InputsDiv>
    <Row style={{ justifyContent: "start" }}>
      <Button onClick={() => props.addPattern(newLoadPattern())}>
        Add Pattern
      </Button>
      <Button onClick={clearAllPatterns}>
        Clear All Patterns
      </Button>&nbsp;&nbsp;
      <QuestionBubble text="Click here for more information about Load Patterns" href="https://familysearch.github.io/pewpew/config/load_pattern-section.html"></QuestionBubble>
      &nbsp;&nbsp;
    </Row>

    <Row style={{ justifyContent: "start" }}>
      <ToggleDefaults
        title="Load Patterns"
        handleAddMissing={() => switchDefault(true)}
        handleDeleteAll={() => switchDefault(false)}
        addDisabled={patterns.find((p) => p.id === RAMP_PATTERN) !== undefined && patterns.find((p) => p.id === LOAD_PATTERN) !== undefined}
        deleteDisabled={!patterns.find((p) => p.id === RAMP_PATTERN) || !patterns.find((p) => p.id === LOAD_PATTERN)}
      />
      <QuestionBubble text="Set Default load and ramp time patterns"></QuestionBubble>
    </Row>

    <TransitionGroup className="loadPatter-section_list" nodeRef={nodeRef}>
      {Array.from(patterns.values()).map((pewpewPattern: PewPewLoadPattern) => {
        // TODO: Do we want to check if they're greater than 0?
        const validFrom: boolean = !pewpewPattern.from || NUMBER_REGEX.test(pewpewPattern.from);
        const validTo: boolean = NUMBER_REGEX.test(pewpewPattern.to);
        const validOver: boolean = OVER_REGEX.test(pewpewPattern.over);
        return <CSSTransition key={pewpewPattern.id} timeout={300} classNames="load" nodeRef={nodeRef}>
          <Div>
            <Span>
              <Label> From: </Label>
              <QuestionBubble text="Optional | Percent load start"></QuestionBubble>
              <Input
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
              <Input
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
              <Input
                type="text"
                style={{ width: "170px", color: validOver ? undefined : errorColor.color }}
                onChange={(event) => changePattern(pewpewPattern, "over", event.target.value)}
                name={pewpewPattern.id}
                id="over"
                value={pewpewPattern.over}
                title={validOver ? undefined : "Invalid Over"}
              />
            </Span>
            <Button id={pewpewPattern.id} onClick={() => deletePattern(pewpewPattern.id)}><DeleteIcon /></Button>
          </Div>
        </CSSTransition>;
      })}
    </TransitionGroup>
  </InputsDiv>
  );
}

export default LoadPatterns;
