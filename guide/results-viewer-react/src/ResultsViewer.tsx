import * as React from "react";
import Dropzone, { DropzoneInputProps, DropzoneRootProps } from "react-dropzone";
import { LogLevel, log } from "./util/log";
import styled, { createGlobalStyle } from "styled-components";
import { TestResults } from "./components/TestResults";

export const GlobalStyle = createGlobalStyle`
  body {
    background-color: rgb(50, 50, 50);
    color: rgb(250, 250, 250);
    // https://familysearch.slack.com/archives/C09E2K6PL/p1577117592008900
    // https://www.youtube.com/watch?v=jVhlJNJopOQ
    // font-family: Papyrus,fantasy;
    font-family: sans-serif;
    font-size: 1.25rem;
    line-height: 150%;
    text-align: center;
  }
  input, select, option, button, textarea {
    background-color: rgb(51, 51, 51);
    color: rgb(200, 200, 200);
    // font-family: Papyrus,fantasy;
    font-size: .9rem;
  }
  ul {
    text-align: left;
  }
  a {
    color: lightblue;
  }
  a:visited {
    color: magenta;
  }
`;

export const BasicDiv = styled.div`
  min-height: 93vh;
  min-width: 93vh;
`;

export const Div = styled.div`
  min-height: 90vh;
  min-width: 93vw;
  vertical-align: middle;
  align-content: start;
  text-align: center;
  justify-content: center;
  padding: 1px;
  /* border-width: 1px;
  border-style: solid;
  border-color: white; */
`;

const DropzoneDiv = styled(Div)`
  align-items: center;
  border-color: #eeeeee;
  border-style: dashed;
  background-color: rgb(61, 64, 67);
  color: rgb(242, 241, 239);
  border-top-color: rgb(54, 54, 54);
  border-right-color: rgb(54, 54, 54);
  border-bottom-color: rgb(54, 54, 54);
  border-left-color: rgb(54, 54, 54);
  outline: none;
  transition: border .24s ease-in-out;
  margin: 2em;
  &:hover {
    cursor: pointer;
    border-color: rgb(30, 30, 30);
  }
`;


// const statsIntegration = "{\"test\":\"integration\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"http://localhost:9001/\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAYAAAAAAAAAAwAAAAAAAAABAAAAAAAAD/8/8AAAAAAAAP8VAqkTAg\",\"statusCounts\":{\"200\":2}}}}";
// const statsIntOnDemand = `{"test":"int_on_demand","bin":"0.5.10","bucketSize":60}{"index":0,"tags":{"_id":"0","method":"GET","url":"http://localhost:9001"}}{"index":1,"tags":{"_id":"1","method":"GET","url":"http://localhost:9001?*"}}{"time":1656339120,"entries":{"0":{"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAALkVAtkBAjkCEwI","statusCounts":{"204":4}},"1":{"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAANUSAmsCvQECVQI","statusCounts":{"204":4}}}}`;

interface ResultsViewierState {
  filename: string | undefined;
  fileContents: string | undefined;
  error: string | undefined;
}

export const ResultsViewer = () => {
  const defaultState: ResultsViewierState = {
    filename: undefined,
    fileContents: undefined,
    error: undefined
  };
  const [state, setState] = React.useState(defaultState);
  const updateState = (newState: Partial<ResultsViewierState>) =>
    setState((oldState: ResultsViewierState): ResultsViewierState => ({ ...oldState, ...newState }));

  const onDropFile = async (filelist: File[]) => {
    updateState({
      filename: undefined,
      fileContents: undefined,
      error: undefined
     });
    log("filelist", LogLevel.DEBUG, filelist);
    if (filelist && filelist.length > 0) {
      const file: File = filelist[0];
      // Read
      try {
        const fileContents = await new Promise<string | undefined>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const text = e.target?.result;
            log("text", LogLevel.DEBUG, text);
            resolve(text as string);
          };
          reader.onerror = (e) => {
            const error = e.target?.error;
            log("file read error", LogLevel.ERROR, error);
            reject(error);
          };
          reader.readAsText(file);
        });
        log("fileContents", LogLevel.DEBUG, fileContents);
        let error = undefined;
        if (!fileContents) {
          error = file?.name + " was empty or unreadable";
        }
        updateState({ filename: file.name, fileContents, error });
      } catch (error) {
        log("onDropFile error", LogLevel.ERROR, error);
        updateState({
          error: `${error}`
        });
      }
    }
  };
  const DivSwap = state.fileContents ? BasicDiv : DropzoneDiv;
  return (<>
    <GlobalStyle />
    {state.error && <h1> Error: {state.error} </h1>}
    {state.fileContents
      ? <>
        <h1> Test Results </h1>
        {state.filename && <h1>{state.filename}</h1>}
        <TestResults resultsText={state.fileContents} />
      </>
    : <Dropzone onDrop={onDropFile} multiple={false} >
      {({getRootProps, getInputProps}: {getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps, getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps }) => (
      <DivSwap {...getRootProps()}>
        <>
            <input {...getInputProps()} />
            <p>Drop files here, or click to select files</p>
          </>
      </DivSwap>
      )}
      </Dropzone>
    /* end fileContents else */}
  </>);
};

export default ResultsViewer;