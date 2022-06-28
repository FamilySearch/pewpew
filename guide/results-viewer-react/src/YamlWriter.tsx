/* YamlWriter
* Originally Created by Joseph Turcotte (Summer 2019)
* Edits and improvements by Conner Sabin (Summer 2021)
*/

import "./yamlwriterstyles.css";
import React, {useState} from "react";
import { GlobalStyle } from "./components/Global";
import { HarEndpoint } from "./util/yamlwriter";
// YamlWriterForm has all the editing of endpoints and load patterns
import { YamlWriterForm } from "./components/YamlWriterForm";
// YamlWriterUpload has all the loading of files
import { YamlWriterUpload } from "./components/YamlWriterUpload";

export type YamlWriterState = {
  endpoints: HarEndpoint[];
};

export const YamlWriter = () => {
  const defaultState: YamlWriterState = {
      endpoints: []
  };

  const [state, setParentState] = useState(defaultState);

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
    <YamlWriterUpload sendEndpoints={updateEndpoints}/>
    <YamlWriterForm clearParentEndpoints={clearEndpoints} parentEndpoints={state.endpoints}/>
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
