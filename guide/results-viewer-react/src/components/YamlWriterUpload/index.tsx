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
const UploadSwaggerHTMLButton = styled.button`
  justify-content: left;
  padding: 2px;
  width: fit-content;
  height: fit-content;
  min-width: 115px;
  margin-top: 1.2%
`;
const UploadSwaggerURLButton = styled.button`
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
  htmlFile: File | undefined,
  swaggerUrl: string,
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
    htmlFile: undefined,
    swaggerUrl: '',
    output: {}
  };

  const defaultFilename: string = "";
  const [filename, setFilename] = useState(defaultFilename);
  const [state, setState] = useState(defaultState);
  const fileModalRef = useRef<ModalObject| null>(null);
  useEffectModal(fileModalRef);
  const endpointModalRef = useRef<ModalObject| null>(null);
  useEffectModal(endpointModalRef);
  const htmlFileModalRef = useRef<ModalObject| null>(null);
  useEffectModal(htmlFileModalRef);
  const swaggerUrlModalRef = useRef<ModalObject| null>(null);
  useEffectModal(swaggerUrlModalRef);

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

  const toggleHTMLModal = (doc?: Document) => {
    if (doc) {
      try {
        const serverOption = doc.querySelector('div.servers option') as HTMLOptionElement;
        let serverUrl = serverOption ? serverOption.value : '';
        // If in the case that the serverUrl is blank we will grab that url from user input
        if (serverUrl === '/') {
          let inputURL = '';
          // Only acceptable string is a valid url. Nothing else.
          while (true) {
            inputURL = window.prompt('Swagger Page is missing server URL\nPlease enter the server URL:', 'https://changeme.com') || '';
            try {
              new URL(inputURL);
              break;
            } catch (e) {
              alert('Invalid URL. Please enter a valid server URL.');
            }
          }
          if (!inputURL) {
            alert('Server URL is required');
            return;
          }
          serverUrl = inputURL;
        }
        createHTMLFileArray(doc, serverUrl);
        log("createFileArray finished", LogLevel.DEBUG);
        endpointModalRef.current?.openModal();
        log("endpointModalRef openModal", LogLevel.DEBUG);
        
      } catch (error) {
        log("Error parsing file", LogLevel.ERROR, error, "Make sure the upload is a valid HTML file");
        alert("Error parsing files, make sure uploads are valid HTML file");
      }
    }
  };
  const toggleSwaggerUrlModal = (swaggerData: any) => {
    try {
      let serverUrl = swaggerData.servers && swaggerData.servers[0] && swaggerData.servers[0].url ? swaggerData.servers[0].url : '';
      if (serverUrl === '/') {
        let inputURL = '';
        while (true) {
          inputURL = window.prompt('Swagger Page is missing server URL\nPlease enter the server URL:', 'https://changeme.com') || '';
          try {
            new URL(inputURL);
            break;
          } catch (e) {
            alert('Invalid URL please enter a valid server URL.')
          }
        }
        if (!inputURL) {
          alert('Serer URL is required');
          return;
        }
        serverUrl = inputURL;
      }
      swaggerData.servers[0].url = serverUrl;
      createSwaggerUrlFileArray(swaggerData);
      log("createSwaggerUrlFileArray finished", LogLevel.DEBUG);
      endpointModalRef.current?.openModal();
      log("endpointModalRef openModal", LogLevel.DEBUG);
    } catch (error) {
      log("Error parsing Swagger URL", LogLevel.ERROR, error);
      alert("Error parsing Swagger URL. Please input a valid Swagger");
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

  const isValidHTMLDocument = (doc: Document): boolean => {
    const hasSwaggerUIElements = doc.querySelector('div.servers option') !== null;
    return hasSwaggerUIElements;
  };

  const submitHTMLEvent = async (): Promise<void> => {
    log("state.htmlFile", LogLevel.DEBUG, state.htmlFile);
    if (!state.htmlFile) { return Promise.resolve(); }
    const file: File = state.htmlFile;
    log("file", LogLevel.DEBUG, file);
    if (file.type !== 'text/html') {
      alert("The file is not acceptable. Please upload a valid HTML file.");
      setState((prevState) => ({ ...prevState, htmlFile: undefined }));
      return;
    }
    const reader = new FileReader();
    const returnPromise = new Promise<void>((resolve, reject) => {
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const readerTarget = event.target as FileReader;
        const text = readerTarget.result as string;
        try {
          // Parse the HTML content using DOMParser
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, 'text/html');
          if (!isValidHTMLDocument(doc)) {
            throw new Error('Invalid HTML Swagger UI document');
          }
          toggleHTMLModal(doc);
          resolve();
        } catch (error) {
          log("Error parsing file: " + file?.name, LogLevel.ERROR, error, "Make sure the upload is a valid HTML file");
          alert("Error parsing files, make sure uploads are valid HTML files");
          reject(error);
        }
      };
    });

    reader.readAsText(file);
    await returnPromise;
  };

  const isValidSwaggerDocument = (swaggerData: any): boolean => {
    return (
      (swaggerData.openapi || swaggerData.swagger) && 
      swaggerData.paths &&
      swaggerData.info &&
      (swaggerData.servers || swaggerData.host)
    );
  };
  const submitUrlEvent = async (): Promise<void> => {
    try {
      const response = await fetch(state.swaggerUrl);
      if (!response.ok) {
        throw new Error('Network failed');
      }
      const swaggerData = await response.json();
      if (!isValidSwaggerDocument(swaggerData)) {
        throw new Error('Invalid Swagger/OpenAPI document');
      }
      toggleSwaggerUrlModal(swaggerData);
    } catch (error) {
      log("Error fetching or parsing URL:", LogLevel.ERROR, error);
      alert("Error fetching or parsing URL. Please enter only valid url");
    }
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

  const clearHtmlFile = () => {
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({ ...prevState, htmlFile: undefined }));
    setFilename("");
  };

  const clearSwaggerUrl = () => {
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({ ...prevState, swaggerUrl: '' }));
  };

  // Checks both current state, and parent state to see if file has already been uploaded
  const handleFileInput = (newFiles: File[]) => {
    const file = newFiles.length >= 1 ? newFiles[0] : undefined;
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({
      ...prevState,
      file
    }));
  };

  const handleHtmlFileInput = (newFiles: File[]) => {
    const file = newFiles.length >= 1 ? newFiles[0] : undefined;
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({
      ...prevState,
      htmlFile: file
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

  const createHTMLFileArray = (doc : Document, serverUrl: string) => {
    const types: Record<string, { index: { iter: number, id: string }[], selected: string } | undefined> = {};
    const urls: Record<string, { index: { iter: number, id: string }[], selected: string } | undefined> = {};
    const parsedEndpoints: ParsedEndpoint[] = [];

    const baseUrl = serverUrl;

    // Extracting the URLs, method types, and accept headers
    doc.querySelectorAll('div[id^="operations-"]').forEach((element, index) => {
      const urlElement = element.querySelector('.opblock-summary-path a') as HTMLElement;
      const methodElement = element.querySelector('.opblock-summary-method') as HTMLElement;
      const selectElement = element.querySelector('.response-control-media-type select') as HTMLSelectElement;

      if (!urlElement || !methodElement) return; // If in any case where the endpoint is not filled out

      const url = urlElement.innerText.trim();
      const cleanUrl = url.replace(/%7B/g, '{').replace(/%7D/g, '}');
      const method = methodElement.innerText.trim();
      const selectedOption = selectElement?.querySelector('option[selected]') as HTMLOptionElement;
      const accept = selectedOption?.value || (selectElement ? selectElement.options[0].value : '*/*');
          
      // For keeping track of endpoints
      const id = uniqueId();
      const mimeType = accept;
      const parsedUrl = new URL(cleanUrl, baseUrl);
      const hostUrl = parsedUrl.hostname;

      if (types[mimeType] !== undefined) {
        types[mimeType]!.index.push({ iter: index, id });
      } else {
        types[mimeType] = { index: [{ iter: index, id }], selected: "partial"};
      }

      if (urls[hostUrl] !== undefined) {
        urls[hostUrl]!.index.push({ iter: index, id });
      } else {
        urls[hostUrl] = { index: [{ iter: index, id }], selected: "yes"};
      }

      parsedEndpoints.push({
        selected: "yes",
        url: parsedUrl,
        type: mimeType,
        id,
        method,
        headers: []
      });
    });
    
    const output: Record<string, Output | undefined> = {
      [filename]: {
        types,
        urls,
        endpoints: parsedEndpoints
      }
      
    };
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({...prevState, output }));
  };
  const createSwaggerUrlFileArray = (swaggerData: any) => {
    const types: Record<string, { index: { iter: number, id: string }[], selected: string } | undefined> = {};
    const urls: Record<string, { index: { iter: number, id: string }[], selected: string } | undefined> = {};
    const parsedEndpoints: ParsedEndpoint[] = [];

    const serverUrl = swaggerData.servers && swaggerData.servers[0] && swaggerData.servers[0].url ? swaggerData.servers[0].url : 'http://changeme.com';

    Object.keys(swaggerData.paths).forEach((pathKey, index) => {
      const pathItem = swaggerData.paths[pathKey];
      let fullPath = serverUrl.endsWith('/') || pathKey.startsWith('/') ? `${serverUrl}${pathKey}` : `${serverUrl}/${pathKey}`;
      fullPath = fullPath.replace(/\{([^}]+)\}/g, '${$1}');
      Object.keys(pathItem).forEach((method) => {
        const operation = pathItem[method];
        const id = uniqueId();
        const mimeType = operation.produces ? operation.produces[0] : '*/*';
        console.log(fullPath);
        const url = new URL(fullPath);
        const hostUrl = url.hostname;

        if (types[mimeType]) {
          types[mimeType]!.index.push({ iter: index, id });
        } else {
          types[mimeType] = { index: [{ iter: index, id }], selected: "partial"};
        }

        if (urls[hostUrl]) {
          urls[hostUrl]!.index.push({ iter: index, id });
        } else {
          urls[hostUrl] = { index: [{ iter: index, id }], selected: "yes"};
        }

        parsedEndpoints.push({
          selected: 'yes',
          url,
          type: mimeType,
          id,
          method: method.toUpperCase(),
          headers: []
        });
      });
    });

    const output: Record<string, Output | undefined> = {
      [filename]: {
        types,
        urls,
        endpoints: parsedEndpoints
      }
    };
    
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({ ...prevState, output }));
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
        <UploadSwaggerHTMLButton onClick={() => htmlFileModalRef.current?.openModal()}>
          Upload Swagger HTML File
        </UploadSwaggerHTMLButton>
        <UploadSwaggerURLButton onClick={() => swaggerUrlModalRef.current?.openModal()}>
          Upload Swagger URL File
        </UploadSwaggerURLButton>
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
      <Modal
        ref={htmlFileModalRef}
        title="Upload HTML File"
        submitText="Load"
        onSubmit={submitHTMLEvent}
        closeText="Cancel"
        onClose={clearHtmlFile}
        isReady={state.htmlFile !== undefined}
      >
        <div style={{color: "rgb(242, 241, 239)"}}>
          Drag file to drop zone or click to select file to load. Currently will only load one HTML file at a time.
        </div>
        <div style={{ width: "90%", height: "250px" }}>
          <DropFile onDropFile={handleHtmlFileInput} multiple={false}></DropFile>
        </div>
        <div>
          {state.htmlFile && (
            <div style={{paddingTop: "13px"}}>
              <button style={{marginRight: "5px"}} onClick={clearFile}>X</button>
              {state.htmlFile.name}
            </div>
          )}
        </div>
      </Modal>
      <Modal
        ref={swaggerUrlModalRef}
        title="Enter Swagger URL"
        submitText="Submit"
        closeText="Cancel"
        onSubmit={submitUrlEvent}
        onClose={clearSwaggerUrl}
        isReady={true}
      >
        <div style={{color: "rgb(242, 241, 239)"}}>
          Enter URL from Swagger JSON doc.
        </div>
        <div style={{ width: "90%", height: "auto", display: 'flex', justifyContent: 'center', alignItems: "center", flexDirection: 'column' }}>
          <input type="text" placeholder="Enter Swagger URL" value={state.swaggerUrl} onChange={(e) => setState({ ...state, swaggerUrl: e.target.value })} />
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
