import * as React from "react";
import Dropzone, { DropzoneInputProps, DropzoneRootProps } from "react-dropzone";
import { GlobalStyle, ScreenWidthDiv } from "./components/Global";
import { LogLevel, log } from "./util/log";
import { TestResults } from "./components/TestResults";
import { TestResultsCompare } from "./components/TestResultsCompare";
import { TestResultsMerge } from "./components/TestResultsMerge";
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

const ModeButton = styled.button<{ $active: boolean }>`
  background-color: ${props => props.$active ? "#007bff" : "#6c757d"};
  color: white;
  border: none;
  padding: 0.5em 1em;
  margin: 0 0.5em;
  border-radius: 4px;
  cursor: pointer;
  font-weight: ${props => props.$active ? "bold" : "normal"};

  &:hover {
    background-color: ${props => props.$active ? "#0056b3" : "#545b62"};
  }
`;

const ComparisonContainer = styled.div`
  display: flex;
  gap: 2em;
  margin: 2em 0;
`;

const MergeDropzoneWrapper = styled.div`
  margin: 2em 0;
`;

const MergeFileList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 1em 0;
  text-align: left;
`;

const MergeFileItem = styled.li`
  display: flex;
  align-items: center;
  gap: 1em;
  padding: 0.5em;
  background-color: rgba(40, 167, 69, 0.1);
  border: 1px solid #28a745;
  border-radius: 4px;
  margin-bottom: 0.5em;
  color: rgb(242, 241, 239);
`;

const RemoveButton = styled.button`
  background: none;
  border: 1px solid #dc3545;
  color: #dc3545;
  border-radius: 4px;
  cursor: pointer;
  padding: 0.1em 0.5em;
  margin-left: auto;
  &:hover {
    background-color: rgba(220, 53, 69, 0.1);
  }
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
  mode: "single" | "compare" | "merge";
  // Single mode
  filename: string | undefined;
  fileContents: string | undefined;
  // Compare mode
  baselineFile: FileData | undefined;
  comparisonFile: FileData | undefined;
  // Merge mode
  mergeFiles: FileData[];
  error: string | undefined;
}

export const ResultsViewer = () => {
  const defaultState: ResultsViewierState = {
    mode: "single",
    filename: undefined,
    fileContents: undefined,
    baselineFile: undefined,
    comparisonFile: undefined,
    mergeFiles: [],
    error: undefined
  };
  const [state, setState] = React.useState(defaultState);
  const updateState = (newState: Partial<ResultsViewierState>) =>
    setState((oldState: ResultsViewierState): ResultsViewierState => ({ ...oldState, ...newState }));

  const setMode = (mode: "single" | "compare" | "merge") => {
    updateState({
      mode,
      filename: undefined,
      fileContents: undefined,
      baselineFile: undefined,
      comparisonFile: undefined,
      mergeFiles: [],
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
  const onDropMergeFiles = async (filelist: File[]) => {
    updateState({ error: undefined });
    log("merge filelist", LogLevel.DEBUG, filelist);

    if (!filelist || filelist.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      filelist.map(async (file) => {
        const contents = await readFile(file);
        if (!contents) {
          throw new Error(`${file.name} was empty or unreadable`);
        }
        return { filename: file.name, contents } as FileData;
      })
    );

    const succeeded: FileData[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
      } else {
        errors.push(`${result.reason}`);
      }
    }

    if (errors.length > 0) {
      updateState({ error: errors.join("; ") });
    }

    if (succeeded.length > 0) {
      setState((oldState) => ({
        ...oldState,
        mergeFiles: [...oldState.mergeFiles, ...succeeded]
      }));
      log("merge files loaded", LogLevel.DEBUG, { count: succeeded.length });
    }
  };

  const removeMergeFile = (index: number) => {
    setState((oldState) => ({
      ...oldState,
      mergeFiles: oldState.mergeFiles.filter((_, i) => i !== index)
    }));
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

  const renderMergeMode = () => {
    const { mergeFiles } = state;
    const hasEnoughFiles = mergeFiles.length >= 2;

    return (
      <>
        <h1>Merge Results</h1>
        <p>Upload results files from multiple agents to merge them into a single view.</p>

        <MergeDropzoneWrapper>
          {mergeFiles.length > 0 && (
            <MergeFileList>
              {mergeFiles.map((f, i) => (
                <MergeFileItem key={`${f.filename}-${i}`}>
                  <span>✓ {f.filename}</span>
                  <RemoveButton onClick={() => removeMergeFile(i)}>Remove</RemoveButton>
                </MergeFileItem>
              ))}
            </MergeFileList>
          )}

          <Dropzone onDrop={onDropMergeFiles} multiple={true}>
            {({ getRootProps, getInputProps }: {
              getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps;
              getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
            }) => (
              <ComparisonDropzone {...getRootProps()}>
                <input {...getInputProps()} />
                {mergeFiles.length === 0
                  ? <p>Drop results files here, or click to select (select multiple at once or drop repeatedly)</p>
                  : <p>Drop more files to add them to the merge ({mergeFiles.length} file{mergeFiles.length !== 1 ? "s" : ""} loaded)</p>
                }
              </ComparisonDropzone>
            )}
          </Dropzone>
        </MergeDropzoneWrapper>

        {hasEnoughFiles && (
          <TestResultsMerge
            fileTexts={mergeFiles.map((f) => f.contents)}
            filenames={mergeFiles.map((f) => f.filename)}
          />
        )}

        {!hasEnoughFiles && mergeFiles.length === 1 && (
          <p>Upload at least one more file to merge.</p>
        )}
      </>
    );
  };

  return (
    <>
      <GlobalStyle />

      <ModeToggle>
        <ModeButton
          $active={state.mode === "single"}
          onClick={() => setMode("single")}
        >
          Single Results
        </ModeButton>
        <ModeButton
          $active={state.mode === "compare"}
          onClick={() => setMode("compare")}
        >
          Compare Results
        </ModeButton>
        <ModeButton
          $active={state.mode === "merge"}
          onClick={() => setMode("merge")}
        >
          Merge Results
        </ModeButton>
      </ModeToggle>

      {state.error && <h1>Error: {state.error}</h1>}

      {state.mode === "single" && renderSingleMode()}
      {state.mode === "compare" && renderCompareMode()}
      {state.mode === "merge" && renderMergeMode()}
    </>
  );
};

export default ResultsViewer;