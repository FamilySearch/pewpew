import * as React from "react";
import Dropzone, { DropzoneInputProps, DropzoneRootProps } from "react-dropzone";
import { GlobalStyle, ScreenWidthDiv } from "./components/Global";
import { LogLevel, log } from "./util/log";
import { TestResults } from "./components/TestResults";
import { TestResultsCompare } from "./components/TestResultsCompare";
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

const ModeToggle = styled.div`
  text-align: center;
  margin: 2em 0;
`;

const ModeButton = styled.button<{ active: boolean }>`
  background-color: ${props => props.active ? "#007bff" : "#6c757d"};
  color: white;
  border: none;
  padding: 0.5em 1em;
  margin: 0 0.5em;
  border-radius: 4px;
  cursor: pointer;
  font-weight: ${props => props.active ? "bold" : "normal"};

  &:hover {
    background-color: ${props => props.active ? "#0056b3" : "#545b62"};
  }
`;

const ComparisonContainer = styled.div`
  display: flex;
  gap: 2em;
  margin: 2em 0;
`;

const ComparisonDropzone = styled.div`
  flex: 1;
  padding: 2em;
  border: 2px dashed rgb(54, 54, 54);
  border-radius: 4px;
  text-align: center;
  background-color: rgb(61, 64, 67);
  color: rgb(242, 241, 239);
  cursor: pointer;
  transition: border-color 0.24s ease-in-out;

  &:hover {
    border-color: rgb(30, 30, 30);
  }

  &.has-file {
    border-color: #28a745;
    background-color: rgba(40, 167, 69, 0.1);
  }
`;

interface FileData {
  filename: string;
  contents: string;
}

interface ResultsViewierState {
  mode: "single" | "compare";
  // Single mode
  filename: string | undefined;
  fileContents: string | undefined;
  // Compare mode
  baselineFile: FileData | undefined;
  comparisonFile: FileData | undefined;
  error: string | undefined;
}

export const ResultsViewer = () => {
  const defaultState: ResultsViewierState = {
    mode: "single",
    filename: undefined,
    fileContents: undefined,
    baselineFile: undefined,
    comparisonFile: undefined,
    error: undefined
  };
  const [state, setState] = React.useState(defaultState);
  const updateState = (newState: Partial<ResultsViewierState>) =>
    setState((oldState: ResultsViewierState): ResultsViewierState => ({ ...oldState, ...newState }));

  const setMode = (mode: "single" | "compare") => {
    updateState({
      mode,
      filename: undefined,
      fileContents: undefined,
      baselineFile: undefined,
      comparisonFile: undefined,
      error: undefined
    });
  };

  const readFile = (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        resolve(text as string);
      };
      reader.onerror = (e) => {
        const error = e.target?.error;
        reject(error);
      };
      reader.readAsText(file);
    });
  };

  const onDropFile = async (filelist: File[]) => {
    updateState({ error: undefined });
    log("filelist", LogLevel.DEBUG, filelist);

    if (filelist && filelist.length > 0) {
      const file: File = filelist[0];
      try {
        const contents = await readFile(file);
        if (!contents) {
          updateState({ error: `${file.name} was empty or unreadable` });
          return;
        }
        updateState({ filename: file.name, fileContents: contents });
        log("fileContents loaded", LogLevel.DEBUG, { filename: file.name, length: contents.length });
      } catch (error) {
        log("onDropFile error", LogLevel.ERROR, error);
        updateState({ error: `${error}` });
      }
    }
  };

  const onDropComparisonFile = async (filelist: File[], fileType: "baseline" | "comparison") => {
    updateState({ error: undefined });
    log("comparison filelist", LogLevel.DEBUG, { filelist, fileType });

    if (filelist && filelist.length > 0) {
      const file: File = filelist[0];
      try {
        const contents = await readFile(file);
        if (!contents) {
          updateState({ error: `${file.name} was empty or unreadable` });
          return;
        }

        const fileData: FileData = { filename: file.name, contents };
        if (fileType === "baseline") {
          updateState({ baselineFile: fileData });
        } else {
          updateState({ comparisonFile: fileData });
        }

        log("comparison file loaded", LogLevel.DEBUG, { filename: file.name, fileType, length: contents.length });
      } catch (error) {
        log("onDropComparisonFile error", LogLevel.ERROR, error);
        updateState({ error: `${error}` });
      }
    }
  };
  const renderSingleMode = () => {
    const DivSwap = state.fileContents ? ScreenWidthDiv : DropzoneDiv;

    if (state.fileContents) {
      return (
        <>
          <h1>Test Results</h1>
          {state.filename && <h1>{state.filename}</h1>}
          <TestResults resultsText={state.fileContents} />
        </>
      );
    }

    return (
      <Dropzone onDrop={onDropFile} multiple={false}>
        {({ getRootProps, getInputProps }: {
          getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps;
          getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
        }) => (
          <DivSwap {...getRootProps()}>
            <input {...getInputProps()} />
            <p>Drop files here, or click to select files</p>
          </DivSwap>
        )}
      </Dropzone>
    );
  };

  const renderCompareMode = () => {
    const hasBaseline = !!state.baselineFile;
    const hasComparison = !!state.comparisonFile;

    if (hasBaseline && hasComparison) {
      return (
        <>
          <h1>Results Comparison</h1>
          <TestResultsCompare
            baselineText={state.baselineFile!.contents}
            comparisonText={state.comparisonFile!.contents}
            baselineLabel={`Baseline: ${state.baselineFile!.filename}`}
            comparisonLabel={`Comparison: ${state.comparisonFile!.filename}`}
          />
        </>
      );
    }

    return (
      <>
        <h1>Upload Two Files to Compare</h1>
        <ComparisonContainer>
          <Dropzone onDrop={(files) => onDropComparisonFile(files, "baseline")} multiple={false}>
            {({ getRootProps, getInputProps }: {
              getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps;
              getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
            }) => (
              <ComparisonDropzone
                {...getRootProps()}
                className={hasBaseline ? "has-file" : ""}
              >
                <input {...getInputProps()} />
                <h3>Baseline File</h3>
                {hasBaseline ? (
                  <p>✓ {state.baselineFile!.filename}</p>
                ) : (
                  <p>Drop baseline results here, or click to select</p>
                )}
              </ComparisonDropzone>
            )}
          </Dropzone>

          <Dropzone onDrop={(files) => onDropComparisonFile(files, "comparison")} multiple={false}>
            {({ getRootProps, getInputProps }: {
              getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps;
              getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
            }) => (
              <ComparisonDropzone
                {...getRootProps()}
                className={hasComparison ? "has-file" : ""}
              >
                <input {...getInputProps()} />
                <h3>Comparison File</h3>
                {hasComparison ? (
                  <p>✓ {state.comparisonFile!.filename}</p>
                ) : (
                  <p>Drop comparison results here, or click to select</p>
                )}
              </ComparisonDropzone>
            )}
          </Dropzone>
        </ComparisonContainer>
      </>
    );
  };

  return (
    <>
      <GlobalStyle />

      <ModeToggle>
        <ModeButton
          active={state.mode === "single"}
          onClick={() => setMode("single")}
        >
          Single Results
        </ModeButton>
        <ModeButton
          active={state.mode === "compare"}
          onClick={() => setMode("compare")}
        >
          Compare Results
        </ModeButton>
      </ModeToggle>

      {state.error && <h1>Error: {state.error}</h1>}

      {state.mode === "single" ? renderSingleMode() : renderCompareMode()}
    </>
  );
};

export default ResultsViewer;