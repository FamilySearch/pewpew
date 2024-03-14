import {
  Accordion,
  AccordionItem,
  AccordionItemButton,
  AccordionItemHeading,
  AccordionItemPanel
} from "react-accessible-accordion";
import { Har, HarEndpoint } from "../../util/yamlwriter";
import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import React, { useRef, useState } from "react";
import { Div } from "../Div";
import DropFile from "../DropFile";
import { Span } from "../YamlStyles";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

export const HeaderMain = styled.div`
  width: 100%;
  border-bottom: 2px solid black;
  margin: 0px;
  padding-left: 2%;
  padding-bottom: 10px;
  font: 14px "Century Gothic", Futura, sans-serif;
  text-align: left;
`;
const UploadHarButton = styled.button`
  justify-content: left;
  padding: 2px;
  width: fit-content;
  height: fit-content;
  min-width: 115px;
  margin-top: 1.2%
`;
const AccHeadingDiv = styled.div`
  display: flex;
  flex-wrap: nowrap;
  flex-direction: row;
  flex: 1 0 100%;
  align-items: stretch;
`;
const AccHeadingText = styled.span`
  font-weight: bold;
  font-size: 25px;
`;

const AccordianStyleDiv = styled.div`
/**
* ----------------------------------------------
* Accordion Item Styles
* ----------------------------------------------
**/
.accUrlHead, .accTypeHead {
  width: 100%;
  display: flex;
  flex-direction: row;
}
.accItem {
  padding: 25px;
  font-weight: bold;
  font-size: 15px;
  word-wrap: break-word;
}
.accItem:hover {
  cursor: pointer;
}
.accPointButtonYes {
  background: rgb(7, 92, 7);
}
.accPointButtonNo {
  background: rgb(172, 88, 88);
}
.accButton {
  width: 40px;
  height: 40px;
  align-self: center;
  border: 0;
}
.accButton:hover {
  cursor: pointer;
}
.accUrlButtonYes, .accTypeButtonYes {
  background: rgb(7, 92, 7);
}
.accUrlButtonPartial, .accTypeButtonPartial {
  background: rgb(172, 172, 42);
}
.accUrlButtonNo, .accTypeButtonNo {
  background: rgb(172, 88, 88);
}
/**
* ----------------------------------------------
* Accordion Styles
* ----------------------------------------------
**/
.accordion {
  border-radius: 2px;
}
.accordion__button {
  cursor: pointer;
  padding: 18px;
  width: 100%;
  text-align: left;
  border:solid 1px rgb(51, 51, 51);
}
.accordion__button:hover {
  background-color: rgb(30, 30, 30);
}
.accordion__button:before {
  display: inline-block;
  content: '';
  height: 10px;
  width: 10px;
  margin-right: 12px;
  border-bottom: 2px solid currentColor;
  border-right: 2px solid currentColor;
  transform: rotate(-45deg);
}
.accordion__button[aria-expanded='true']::before,
.accordion__button[aria-selected='true']::before {
  transform: rotate(45deg);
}
.accordion__panel {
  padding: 20px;
  animation: fadein 0.35s ease-in;
}
/* -------------------------------------------------- */
/* ---------------- Animation part ------------------ */
/* -------------------------------------------------- */
@keyframes fadein {
  0% {
      opacity: 0;
  }

  100% {
      opacity: 1;
  }
}
`;

export interface YamlWriterUploadProps {
  sendEndpoints: (endpoints: HarEndpoint[]) => void,
}

interface OutputRecord {
  index: { iter: number, id: string }[];
  selected: string;
}
interface Output {
  types: Record<string, OutputRecord | undefined>;
  urls: Record<string, OutputRecord | undefined>;
  endpoints: ParsedEndpoint[];
}

interface YamlWriterUploadState {
  file: File | undefined,
  output: Record<string, Output | undefined>
}

interface ParsedEndpoint extends Omit<HarEndpoint, "url"> {
  url: URL;
}

interface IndexType {
  iter: number,
  id: string
}

export const YamlWriterUpload = (props: YamlWriterUploadProps) => {
  const defaultState: YamlWriterUploadState = {
    file: undefined,
    output: {}
  };

  const defaultFilename: string = "";
  const [filename, setFilename] = useState(defaultFilename);
  const [state, setState] = useState(defaultState);
  const fileModalRef = useRef<ModalObject| null>(null);
  useEffectModal(fileModalRef);
  const endpointModalRef = useRef<ModalObject| null>(null);
  useEffectModal(endpointModalRef);

  // Function to open and close customize modal
  // JSON file will be present after upload modal is used
  // Closing upload modal will send the file to here
  const toggleCustomizeModal = (jsonFile?: Har) => {
    if (jsonFile) {
      try {
        /* log("jsonFile", LogLevel.DEBUG, jsonFile); */
        createFileArray(jsonFile);
        log("createFileArray finished", LogLevel.DEBUG);
        endpointModalRef.current?.openModal();
        log("endpointModalRef openModal", LogLevel.DEBUG);
      } catch (error) {
        log("Error parsing file", LogLevel.ERROR, error, "Make sure the upload is a valid HAR file");
        alert("Error parsing files, make sure uploads are valid HAR file");
      }
    }
  };

  // Called when upload modal is closed
  // Passed to modal
  const submitEvent = async (): Promise<void> => {
    // Sends file to App.js for record
    log("state.files", LogLevel.DEBUG, state.file);
    if (!state.file) { return Promise.resolve(); }
    // Parses file
    const file: File = state.file;
    log("file", LogLevel.DEBUG, file);

    const reader = new FileReader();

    // When reader loads, parse file, and toggle customize modal
    const returnPromise = new Promise<void>((resolve, reject) => {
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const readerTarget = event.target as FileReader;
        const text = readerTarget.result as string;
        try {
          const output = JSON.parse(text);
          toggleCustomizeModal(output);
          resolve();
        } catch (error) {
          log("Error parsing file: " + file?.name, LogLevel.ERROR, error, "Make sure the upload is a valid HAR file");
          alert("Error parsing files, make sure uploads are valid HAR files");
          reject(error);
        }
      };
    });

    reader.readAsText(file);
    await returnPromise;
  };

  // Sends endpoints to App.js to send to Content.js
  const finalizeEndpoints = () => {
    props.sendEndpoints(
      (state.output[filename]?.endpoints || [])
      // Convert a ParsedEndpoint to a HarEndpoint
      .map(({ url, ...parsedEndpoint }: ParsedEndpoint): HarEndpoint => ({ ...parsedEndpoint, url: url.href }))
    );
    return Promise.resolve();
  };

  // Used if file is removed from upload list
  const clearFile = () => {
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({ ...prevState, file: undefined }));
    setFilename("");
  };

  // Checks both current state, and parent state to see if file has already been uploaded
  const handleFileInput = (newFiles: File[]) => {
    const file = newFiles.length >= 1 ? newFiles[0] : undefined;
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({
      ...prevState,
      file
    }));
  };

  // When file is uploaded, create an array from all the endpoints
  const createFileArray = (jsonFile: Har) => {
    // Used to keep track of the unique return types
    const types: Record<string, { index: { iter: number, id: string }[], selected: string } | undefined> = {};
    // Used to keep track of the unique urls
    const urls: Record<string, { index: { iter: number, id: string }[], selected: string } | undefined> = {};
    // Used to keep track of endpoints
    const endpoints: ParsedEndpoint[] = [];
    for (let i = 0; i < jsonFile.log.entries.length; i++) {
      const id = uniqueId();
      const entry = jsonFile.log.entries[i];
      log("entry", LogLevel.DEBUG, { id, entry });
      // Firefox doesn't have a mimeType
      const mimeTypeArray = entry.response.content?.mimeType?.split(";") as string[] | undefined;
      const mimeType = mimeTypeArray && mimeTypeArray?.length > 0 ? mimeTypeArray[0] : "";
      const url: URL = new URL(entry.request.url);
      const hostUrl = url.hostname;

      // Adds a reference to an endpoint with given url
      // If the url is already in the url object, add a reference under that object
      // If url does not exist in object, create a new object in url, with the key being the url
      if (types[mimeType] !== undefined) {
        types[mimeType]!.index.push({ iter: i, id });
      } else {
				types[mimeType] = { index: [{ iter: i, id }], selected: "partial"};
      }

      // Adds a reference to an endpoint with given response type
      // If the response type is already in type object, add a reference under that object
      // If response type does not exist in object, create a new object in type, with the key being the response type
      if (urls[hostUrl] !== undefined) {
        urls[hostUrl]!.index.push({ iter: i, id });
      } else {
        urls[hostUrl] = { index: [{ iter: i, id }], selected: "yes"};
      }
			endpoints.push({ selected: "yes", url, type: mimeType, id, method: entry.request.method, headers: [...entry.request.headers] });
    }

    const typesTemp = types;
    const typeKeys = Object.keys(typesTemp);
    const indices: ParsedEndpoint[] = [...endpoints];

    // Updates the host endpoints with the correct values for their default
    for (const key of typeKeys ) {
    let typeCheck = 0;
    const type = types[key]!;
      for (const typeIndex of type.index) {
         if (indices[typeIndex.iter].selected === "yes") { typeCheck++; }
      }
       if (typeCheck === type.index.length) { typesTemp[key]!.selected = "yes"; }
       else if (typeCheck === 0) { typesTemp[key]!.selected = "no"; }
       else { typesTemp[key]!.selected = "partial"; }
    }
    const output: Record<string, Output | undefined> = {
      [filename]: {
        types,
        urls,
        endpoints
    }};
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({...prevState, output }));
  };

  // This is in the Cutomize HAR File pop up window
  // Any time an item is clicked in the choose endpoints, update all objects for if they are selected
  const handleChange = (type: string, ident: string | ParsedEndpoint) => {
    const outputName: Output | undefined = state.output[filename];
    if (!outputName) {
      log("No output found for " + filename, LogLevel.WARN, state.output);
      return;
    }
    // TODO: Should all of this be inside the setState() function?
    const indices = [...outputName.endpoints];
    const urlTypeIdent = ident as string;
    switch (type) {
      // If the item clicked was a url header, make all endpoints with references in given url checked or unchecked
      case "url": {
        outputName.urls[urlTypeIdent]?.index.forEach((url: IndexType) => {
          indices.forEach(item => {
            if (url.id === item.id) { item.selected = outputName.urls[urlTypeIdent]?.selected === "no" ? "yes" : "no"; }
          });
        });
        break;
      }
      // If the item clicked was a type header, make all endpoints with references in given type checked or unchecked
      case "type": {
        outputName.types[urlTypeIdent]?.index.forEach((indexType: IndexType) => {
          indices.forEach(item => {
            if (indexType.id === item.id) { item.selected = outputName.types[urlTypeIdent]?.selected === "no" ? "yes" : "no"; }
          });
        });
        break;
      }
      // If item clicked was an endpoint, make that endpoint checked or unchecked
      case "point": {
        indices.forEach(item => {
          const pointIdent = ident as ParsedEndpoint;
          if (pointIdent.id === item.id) { item.selected = item.selected === "yes" ? "no" : "yes"; }
        });
        break;
      }
    }

    const urlsTemp = outputName.urls;
    const urlKeys = Object.keys(urlsTemp);

    const typesTemp = outputName.types;
    const typeKeys = Object.keys(typesTemp);

    // Updates all url and type headers depending on the status of the endpoints they have reference to;
    for (const key of urlKeys) {
      let urlCheck = 0;
      const url: OutputRecord | undefined = outputName.urls[key];
      const urlTemp = urlsTemp[key];
      if (!url || !urlTemp) { continue; }
      for (const urlIndex of url.index) {
        if (indices[urlIndex.iter].selected === "yes") { urlCheck++; }
      }
      if (urlCheck === url.index.length) { urlTemp.selected = "yes"; }
      else if (urlCheck === 0) { urlTemp.selected = "no"; }
      else { urlTemp.selected = "partial"; }
    }

    for (const key of typeKeys) {
      let typeCheck = 0;
      const outputType = outputName.types[key];
      const typeTemp = typesTemp[key];
      if (!outputType || !typeTemp) { continue; }
      for (const typeIndex of outputType.index) {
        if (indices[typeIndex.iter].selected === "yes") { typeCheck++; }
      }
      if (typeCheck === outputType.index.length) { typeTemp.selected = "yes"; }
      else if (typeCheck === 0) { typeTemp.selected = "no"; }
      else { typeTemp.selected = "partial"; }
    }

    const newOutput: Output = {
        types: typesTemp,
        urls: urlsTemp,
        endpoints: indices
    };
    setState(({ output, ...prevState }: YamlWriterUploadState) => {
      return {
        ...prevState,
        output: { ...output, [filename]: newOutput }
      };
    });
  };

  return (
    <HeaderMain>
      <h2> Create from Har File </h2>
      <Div style={{ marginTop: "0px", justifyContent: "space-between"}}>
        <UploadHarButton onClick={() => fileModalRef.current?.openModal()}>
          Upload Har File
        </UploadHarButton>
          <h3 style={{paddingRight: "100px"}}>
            <a href="https://familysearch.github.io/pewpew/" target="_blank">
            Help
            </a>
          </h3>
      </Div>
      {/* This is the upload file modal */}
      <Modal
        ref={fileModalRef}
        title="Upload Files"
        submitText="Load"
        onSubmit={submitEvent}
        closeText="Cancel"
        onClose={clearFile}
        isReady={state.file !== undefined}
      >
        <div style={{color: "rgb(242, 241, 239)"}}>
          Drag file to drop zone or click to select file to load. Currently will only load one file at a time.
        </div>
        <div style={{ width: "90%", height: "250px" }}>
          <DropFile onDropFile={handleFileInput} multiple={false}></DropFile>
        </div>
        <div>
          {state.file && (
            <div style={{paddingTop: "13px"}}>
              <button style={{marginRight: "5px"}} onClick={clearFile}>X</button>
              {state.file.name}
            </div>
          )}
        </div>
      </Modal>
      {/* This is the endpoint customize modal */}
      <Modal
        ref={endpointModalRef}
        title="Customize HAR File"
        submitText="Submit"
        onSubmit={finalizeEndpoints}
        closeText="Cancel"
        isReady={true}
      >
        <AccordianStyleDiv style={{paddingRight: "20px"}}>
          <div>
            <Span>
              <h2>Urls</h2>&nbsp;&nbsp;&nbsp;
            </Span>
            <Accordion allowMultipleExpanded={true} allowZeroExpanded={true}>
              {state.output[filename]?.urls && Object.keys(state.output[filename]!.urls).map((key, index) => {
                const url: OutputRecord = state.output[filename]!.urls[key]!;
                return (
                  <AccordionItem key={index}>
                    <AccHeadingDiv>
                      <button
                        onClick={() => handleChange("url", key)}
                        className={"accButton" +
                          (url.selected === "yes" ? " accUrlButtonYes" : "") +
                          (url.selected === "partial" ? " accUrlButtonPartial" : "") +
                          (url.selected === "no" ? " accUrlButtonNo" : "")}
                      >
                        {/* This is the display of the button */}
                        {"" + (url.selected === "yes" ? "✔" : "") +
                          (url.selected === "partial" ? "/" : "") +
                          (url.selected === "no" ? "X" : "")}
                      </button>
                      <AccordionItemHeading className="accUrlHead">
                        <AccordionItemButton>
                          <AccHeadingText>
                            {`${key} {${url.index.length}}`}
                          </AccHeadingText>
                        </AccordionItemButton>
                      </AccordionItemHeading>
                    </AccHeadingDiv>
                    <AccordionItemPanel>
                      {state.output[filename] && url.index.map((inx: IndexType, i: number) => {
                        const point = state.output[filename]!.endpoints.find((obj: ParsedEndpoint) => obj.id === inx.id);
                        return (
                          point && <p
                            key={i}
                            onClick={() => handleChange("point", point)}
                            className={"accItem" + (point.selected === "yes" ? " accPointButtonYes" : "") +
                              (point.selected === "no" ? " accPointButtonNo" : "")}
                          >
                            {point.url.toString()}
                          </p>
                        );
                      })}
                    </AccordionItemPanel>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
          <div style={{marginTop: "25px"}}>
            <h2>Return Types</h2>
            <Accordion allowMultipleExpanded={true} allowZeroExpanded={true}>
              {state.output[filename]?.types && Object.keys(state.output[filename]!.types).map((key, index) => {
                const type = state.output[filename]!.types[key];
                return (
                  type && <AccordionItem key={index}>
                    <AccHeadingDiv>
                      <button
                        onClick={() => handleChange("type", key)}
                        className={"accButton" + (type.selected === "yes" ? " accTypeButtonYes" : "") +
                          (type.selected === "partial" ? " accTypeButtonPartial" : "") +
                          (type.selected === "no" ? " accTypeButtonNo" : "")}
                      >
                        {"" + (type.selected === "yes" ? "✔" : "") +
                          (type.selected === "partial" ? "/" : "") +
                          (type.selected === "no" ? "X" : "")}
                      </button>
                      <AccordionItemHeading className="accTypeHead">
                        <AccordionItemButton>
                          <AccHeadingText>
                            {`${key} {${type.index.length}}`}
                          </AccHeadingText>
                        </AccordionItemButton>
                      </AccordionItemHeading>
                    </AccHeadingDiv>
                    <AccordionItemPanel>
                      {type.index.map((inx: IndexType, i: number) => {
                        const point = state.output[filename]?.endpoints.find((obj: ParsedEndpoint) => obj.id === inx.id);
                        return (
                          point && <p
                            key={i}
                            onClick={() => handleChange("point", point)}
                            className={"accItem" + (point.selected === "yes" ? " accPointButtonYes" : "") +
                              (point.selected === "no" ? " accPointButtonNo" : "")}
                          >
                            {point.url.toString()}
                          </p>
                        );
                      })}
                    </AccordionItemPanel>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </AccordianStyleDiv>
      </Modal>
    </HeaderMain>
  );
};

export default YamlWriterUpload;
