import * as React from "react";
import Dropzone, { DropzoneInputProps, DropzoneRootProps } from "react-dropzone";
import { GlobalStyle, ScreenWidthDiv } from "./components/Global";
import { LogLevel, log } from "./util/log";
import { TestResults } from "./components/TestResults";
import styled from "styled-components";

const DropzoneDiv = styled(ScreenWidthDiv)`
  align-items: center;
  vertical-align: middle;
  align-content: center;
  text-align: center;
  justify-content: center;
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
  const DivSwap = state.fileContents ? ScreenWidthDiv : DropzoneDiv;
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