/* YamlWriter
* Originally Created by Joseph Turcotte (Summer 2019)
* Edits and improvements by Conner Sabin (Summer 2021)
*/

import { HarEndpoint, PewPewVersion } from "./util/yamlwriter";
import React, { useEffect, useState } from "react";
import { GlobalStyle } from "./components/Global";
// YamlWriterForm has all the editing of endpoints and load patterns
import { YamlWriterForm } from "./components/YamlWriterForm";
// YamlWriterUpload has all the loading of files
import { YamlWriterUpload } from "./components/YamlWriterUpload";
import styled from "styled-components";

const YamlDiv = styled.div`
/* These are needed for the smooth entering
 and exiting transitions of all urls and inputs
-------------------------------------------*/

html {
  box-sizing: border-box;
}
*,*:before,*:after {
  box-sizing: inherit;
}

.point-enter {
  opacity: 0.01;
  transform: translate(-40px, 0)
}

.point-enter-active {
  opacity: 1;
  transform: translate(0, 0);
  transition: all 250ms ease-in;
}

.point-exit {
  opacity: 1;
  transform: translate(0, 0)
}

.point-exit-active {
  opacity: 0.01;
  transform: translate(40px, 0);
  transition: all 100ms ease-in;
}

.load-enter {
  opacity: 0.01;
  transform: translate(-40px, 0)
}

.load-enter-active {
  opacity: 1;
  transform: translate(0, 0);
  transition: all 250ms ease-in;
}

.load-exit {
  opacity: 1;
  transform: translate(0, 0)
}

.load-exit-active {
  opacity: 0.01;
  transform: translate(40px, 0);
  transition: all 100ms ease-in;
}
`;

export interface YamlWriterState {
  endpoints: HarEndpoint[];
}

const VersionSelector = styled.div`
  margin: 20px 0;
  padding: 15px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 15px;

  label {
    font-weight: bold;
    color: rgb(250, 250, 250);
  }

  select {
    padding: 8px 12px;
    font-size: 14px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: hsl(210, 25%, 8%);
    color: rgb(200, 200, 200);
    cursor: pointer;

    &:hover {
      border-color: rgba(255, 255, 255, 0.3);
    }

    &:focus {
      outline: none;
      border-color: #4CAF50;
    }
  }

  .version-info {
    font-size: 13px;
    color: rgb(180, 180, 180);
    font-style: italic;
  }
`;

export const YamlWriter = () => {
  const defaultState: YamlWriterState = {
      endpoints: []
  };

  // Parse version from query parameter, default to 0.5.x
  const getInitialVersion = (): PewPewVersion => {
    const params = new URLSearchParams(window.location.search);
    const versionParam = params.get("version");
    // Validate it's a valid PewPewVersion
    if (versionParam === "0.5.x" || versionParam === "0.6.x") {
      return versionParam;
    }
    return "0.5.x"; // default
  };

  const [state, setParentState] = useState(defaultState);
  const [version, setVersion] = useState<PewPewVersion>(getInitialVersion());

  // Update URL when version changes (optional - keeps URL in sync)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("version", version);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }, [version]);

  // Endpoints from header get sent here when file is loaded
  // Gets sent down to Content immediately
  const updateEndpoints = (harEndpoints: HarEndpoint[]) => {
    setParentState((prevState: YamlWriterState): YamlWriterState => ({...prevState, endpoints: harEndpoints}));
  };

  // Clears endpoints
  const clearEndpoints = () => {
    setParentState((prevState: YamlWriterState): YamlWriterState => ({...prevState, endpoints: []}));
  };

  return (<>
    <GlobalStyle />
    <h1>Create a PewPew Test</h1>
    <VersionSelector>
      <label htmlFor="version-select">Target PewPew Version:</label>
      <select
        id="version-select"
        value={version}
        onChange={(e) => setVersion(e.target.value as PewPewVersion)}
      >
        <option value="0.5.x">0.5.x (Stable)</option>
        <option value="0.6.x">0.6.x (Preview with Scripting)</option>
      </select>
      <span className="version-info">
        {version === "0.6.x"
          ? "Generates YAML with expression syntax: ${e:VARIABLE}"
          : "Generates YAML with template syntax: ${VARIABLE}"}
      </span>
    </VersionSelector>
    <YamlDiv>
      <YamlWriterUpload sendEndpoints={updateEndpoints}/>
      <YamlWriterForm
        clearParentEndpoints={clearEndpoints}
        parentEndpoints={state.endpoints}
        version={version}
      />
    </YamlDiv>
  </>
  );
};

// https://github.com/vercel/next.js/discussions/11493#discussioncomment-14606
// We either need a getInitialProps to get the runtime variables, or we need an `env` section in our
// next.config.js to pass environment variables to statically compiled files at build time.

// Variables are set at run time
// We must have a getInitialProps and return something or we won't get any of our client-side variables (like AUTH_MODE and BASE_PATH)
// YamlWriter.getInitialProps = () => ({});

export default YamlWriter;
