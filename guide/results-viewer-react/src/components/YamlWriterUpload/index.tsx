import {
  Accordion,
  AccordionItem,
  AccordionItemButton,
  AccordionItemHeading,
  AccordionItemPanel
} from "react-accessible-accordion";
import { Button, Input, Span } from "../YamlStyles";
import { Har, HarEndpoint } from "../../util/yamlwriter";
import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from "../Modal";
import type { OpenAPIV2, OpenAPIV3} from "openapi-types";
import React, { useRef, useState } from "react";
import { DeleteIcon } from "../Icons/DeleteIcon";
import { Div } from "../Div";
import DropFile from "../DropFile";
import { convertObj } from "swagger2openapi";
import styled from "styled-components";
import { uniqueId } from "../../util/clientutil";

type SwaggerDoc2 = OpenAPIV2.Document;
type SwaggerDoc3 = OpenAPIV3.Document;
type SwaggerDoc = SwaggerDoc2 | SwaggerDoc3;

export const HeaderMain = styled.div`
  width: 100%;
  border-bottom: 2px solid black;
  margin: 0px;
  padding-left: 2%;
  padding-bottom: 10px;
  font: 14px "Century Gothic", Futura, sans-serif;
  text-align: left;
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
  sendEndpoints: (endpoints: HarEndpoint[]) => void;
}

type SelectionState = "yes" | "no" | "partial";

interface OutputRecord {
  index: { iter: number, id: string }[];
  selected: SelectionState;
}
interface Output {
  types: Record<string, OutputRecord | undefined>;
  urls: Record<string, OutputRecord | undefined>;
  endpoints: ParsedEndpoint[];
}

interface YamlWriterUploadState {
  file: File | undefined,
  swaggerUrl: string,
  serverUrl: string,
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
    swaggerUrl: "",
    serverUrl: "",
    output: {}
  };

  const defaultFilename: string = "";
  const [filename, setFilename] = useState(defaultFilename);
  const [state, setState] = useState(defaultState);
  const [urlFilter, setUrlFilter] = useState("");
  const fileModalRef = useRef<ModalObject| null>(null);
  useEffectModal(fileModalRef);
  const endpointModalRef = useRef<ModalObject| null>(null);
  useEffectModal(endpointModalRef);
  const swaggerUrlModalRef = useRef<ModalObject| null>(null);
  useEffectModal(swaggerUrlModalRef);
  const serverUrlModalRef = useRef<ModalObject| null>(null);
  useEffectModal(serverUrlModalRef);
  const [serverUrlCallback, setServerUrlCallback] = useState<((url: string) => void) | null>(null);
  const [foundVariables, setFoundVariables] = useState<string[]>([]);
  const variableModalRef = useRef<ModalObject | null>(null);
  useEffectModal(variableModalRef);

  const handleFileUpload = async (
    file: Har | Document | OpenAPIV3.Document | OpenAPIV2.Document,
    type: "HAR" | "HTML" | "Swagger",
    modalRef: React.RefObject<ModalObject | null>
  ) => {
    try {
      switch (type) {
        case "HAR":
          if (file && "log" in file && Array.isArray(file.log.entries)) {
            log("Creating file array for HAR", LogLevel.DEBUG);
            createFileArray(file);
          } else {
            throw new Error("Invalid Har file");
          }
          break;
        case "HTML":
          if (file instanceof Document) {
            await handleHTMLfile(file);
          } else {
            throw new Error("Invalid HTML file");
          }
          break;
        case "Swagger":
          if (file && "openapi" in file && "paths" in file) {
            await handleSwaggerfile(file as OpenAPIV3.Document);
          } else {
            throw new Error("Invalid Swagger file");
          }
          break;
      }
      modalRef.current?.openModal();
    } catch (error) {
      log(`Error processing ${type} file`, LogLevel.ERROR, error);
      alert(`Error processing ${type} file. Please make sure it's a valid file.`);
    }
  };

  const handleHTMLfile = async (doc: Document) => {
    const serverOption = doc.querySelector("div.servers option") as HTMLOptionElement;
    const serverUrl = serverOption ? serverOption.value : "";

    if (serverUrl === "/") {
      await promptForServerUrl();
    }
    log("Creating HTML file array", LogLevel.DEBUG);
    createHTMLFileArray(doc);
    clearStateValue("serverUrl");
  };

  const handleSwaggerfile = async (swaggerData: SwaggerDoc3) => {
    let serverUrl = swaggerData.servers?.[0]?.url || "";

    if (serverUrl === "/") {
      serverUrl = await promptForServerUrl();
    }
    log("Creating Swagger URL file array", LogLevel.DEBUG);
    createSwaggerUrlFileArray(swaggerData, serverUrl);
    clearStateValue("serverUrl");
  };

  // Opens the server URL modal and returns a promise that resolves with the entered URL
  const promptForServerUrl = (): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      setServerUrlCallback(() => (inputUrl: string) => {
        if (inputUrl && inputUrl !== "/") {
          resolve(inputUrl);
        } else {
          alert("Server URL is required. It cannot be '/'");
          reject("Invalid server URL");
        }
      });
      serverUrlModalRef.current?.openModal();
    });
  };

  const toggleCustomizeModal = (jsonFile?: Har) => {
    if (jsonFile) {
      handleFileUpload(jsonFile, "HAR", endpointModalRef);
    }
  };

  const toggleHTMLModal = async (doc?: Document) => {
    if (doc) {
      await handleFileUpload(doc, "HTML", endpointModalRef);
    }
  };


  const toggleSwaggerUrlModal = async (swaggerData: SwaggerDoc3) => {
    if (swaggerData) {
      await handleFileUpload(swaggerData, "Swagger", endpointModalRef);
    }
  };

  const submitEvent = async (): Promise<void> => {
    log("state.files", LogLevel.DEBUG, state.file);
    if (!state.file) { return Promise.resolve(); }
    const file: File = state.file;
    log("file", LogLevel.DEBUG, file);

    const reader = new FileReader();

    try {
      const returnPromise = new Promise<void>((resolve, reject) => {
        reader.onload = async (event: ProgressEvent<FileReader>) => {
          const text = (event.target as FileReader).result as string;
          try {
            const output = JSON.parse(text);
            if (output.log && output.log.entries) {
              toggleCustomizeModal(output);
            } else {
              throw new Error("Not a HAR file");
            }
            resolve();
          } catch (jsonError) {
            log("submitEvent error", LogLevel.WARN, jsonError);
            try {
              const parser = new DOMParser();
              const doc = parser.parseFromString(text, "text/html");
              if (isValidHTMLDocument(doc)) {
                await toggleHTMLModal(doc);
                resolve();
              } else {
                throw new Error("Invalid HTML Swagger UI document", { cause: jsonError });
              }
            } catch (htmlError) {
              log("Error parsing file: Unsupported file type. Accepting HAR files and Swagger UI HTML");
              alert("Error parsing file: Unsupported file type. Accepting HAR files and Swagger UI HTML");
              reject(htmlError);
            }
          }
        };
      });

      reader.readAsText(file);
      await returnPromise;
    } catch (error) {
      log("Unexpected file processing error:", LogLevel.ERROR, error);
    }
  };

  const isValidHTMLDocument = (doc: Document): boolean => {
    const hasSwaggerUIRoot = doc.querySelector("div#swagger-ui") != null;
    const hasServersDropDown = doc.querySelector("div.servers select") !== null;
    const hasOperations = doc.querySelectorAll("div[id^=\"operations-\"]").length > 0;
    const hasSwaggerTitle = doc.querySelector("title")?.innerText.match(/swagger|api/i) !== null;

    return hasSwaggerUIRoot && hasServersDropDown && hasOperations && hasSwaggerTitle;
  };

  const isValidSwaggerDocument = (unknownData: unknown): boolean => {
    if (unknownData === null || unknownData === undefined || typeof unknownData !== "object") {
      return false;
    }
    const swaggerData: SwaggerDoc = unknownData as SwaggerDoc;
    const versionRegex = /^\d+\.\d+\.\d+$/;
    let hasValidServers: boolean = false;
    let hasValidVersion: boolean;
    let hasValidHost: boolean = false;
    if ("openapi" in swaggerData) {
      hasValidServers = Array.isArray(swaggerData.servers) && swaggerData.servers.length > 0;
      hasValidVersion = typeof swaggerData.openapi === "string" && versionRegex.test(swaggerData.openapi);
    } else if ("swagger" in swaggerData) {
      hasValidHost = typeof swaggerData.host === "string";
      hasValidVersion = typeof swaggerData.swagger === "string" && versionRegex.test(swaggerData.swagger);
    } else {
      return false;
    }
    const hasValidPaths = swaggerData.paths && Object.keys(swaggerData.paths).length > 0;
    const hasValidEndpoints = hasValidPaths && Object.values(swaggerData.paths).some(
      (path: OpenAPIV2.PathItemObject | OpenAPIV3.PathItemObject) =>
      ["get", "post", "put", "delete"].some((method) => method in path)
    );
    const hasValidInfo = swaggerData.info && typeof swaggerData.info.title === "string" && typeof swaggerData.info.version === "string";


    return (
      hasValidVersion &&
      hasValidPaths && hasValidEndpoints &&
      hasValidInfo && (hasValidServers || hasValidHost)
    );
  };

  const submitUrlEvent = async (): Promise<void> => {
    try {
      const response = await fetch(state.swaggerUrl);
      if (!response.ok) {
        throw new Error("Network failed");
      }

      let swaggerData = await response.json();

      if (!isValidSwaggerDocument(swaggerData)) {
        throw new Error("Invalid Swagger/OpenAPI document");
      }
      // Convert Swagger 2.x to OpenAPI 3.x
      if ("swagger" in swaggerData) {
        const { openapi } = await convertObj(swaggerData, {});
        swaggerData = openapi as SwaggerDoc3;
      }
      toggleSwaggerUrlModal(swaggerData);
    } catch (error) {
      log("Error fetching or parsing URL:", LogLevel.ERROR, error);
      alert("Error fetching or parsing URL. Please enter a valid URL.");
    }
  };

  const finalizeEndpoints = () => {
    props.sendEndpoints(
      (state.output[filename]?.endpoints || [])
      .map(({ url, ...parsedEndpoint }: ParsedEndpoint): HarEndpoint => ({ ...parsedEndpoint, url: url.href }))
    );
    return Promise.resolve();
  };

  const clearStateValue = (key: keyof YamlWriterUploadState) => {
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({
      ...prevState,
      [key]: key === "file" ? undefined : ""
    }));
    if (key === "file") {
      setFilename("");
    }
  };

  const handleFileInput = (newFiles: File[]) => {
    const file = newFiles.length >= 1 ? newFiles[0] : undefined;
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({
      ...prevState,
      file
    }));
  };

  const handleServerUrlSubmit = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const serverUrl = state.serverUrl.trim();

      try {
        new URL(serverUrl);
      } catch {
        alert("Please enter a valid URL.");
        return reject("Invalid URL");
      }
      if (serverUrlCallback) {
        try {
          setState((prev) => ({ ...prev, serverUrl }));
          serverUrlCallback(serverUrl);
          serverUrlModalRef.current?.closeModal();
          setServerUrlCallback(null);
          resolve();
        } catch (error) {
          reject(error);
        }
      } else {
        reject("No callback found");
      }
    });
  };

  const addToRecord = (
    record: Record<string, OutputRecord | undefined>,
    key: string, iter: number, id: string,
    defaultSelected: SelectionState
  ) => {
    if (record[key]) {
      record[key]!.index.push({ iter, id });
    } else {
      record[key] = { index: [{ iter, id }], selected: defaultSelected };
    }
  };

  const collectVariables = (path: string, variables: Set<string>) => {
    const matches = path.match(/\{([^}]+)\}/g);
    if (matches) {
      matches.forEach((v) => variables.add(v.replace(/[{}]/g, "")));
    }
  };

  const recalcTypeSelections = (types: Record<string, OutputRecord | undefined>, endpoints: ParsedEndpoint[]) => {
    for (const key of Object.keys(types)) {
      const type = types[key]!;
      const selectedCount = type.index.filter((t) => endpoints[t.iter].selected === "yes").length;
      if (selectedCount === type.index.length) { type.selected = "yes"; }
      else if (selectedCount === 0) { type.selected = "no"; }
      else { type.selected = "partial"; }
    }
  };

  const setOutputState = (
    types: Record<string, OutputRecord | undefined>,
    urls: Record<string, OutputRecord | undefined>,
    endpoints: ParsedEndpoint[],
    variables?: Set<string>
  ) => {
    if (variables && variables.size > 0) {
      setFoundVariables(Array.from(variables));
      variableModalRef.current?.openModal();
    }
    const output: Record<string, Output | undefined> = {
      [filename]: { types, urls, endpoints }
    };
    setState((prevState: YamlWriterUploadState): YamlWriterUploadState => ({ ...prevState, output }));
  };

  const createFileArray = (jsonFile: Har) => {
    const types: Record<string, OutputRecord | undefined> = {};
    const urls: Record<string, OutputRecord | undefined> = {};
    const endpoints: ParsedEndpoint[] = [];
    for (let i = 0; i < jsonFile.log.entries.length; i++) {
      const id = uniqueId();
      const entry = jsonFile.log.entries[i];
      log("entry", LogLevel.DEBUG, { id, entry });
      const mimeTypeArray = entry.response.content?.mimeType?.split(";") as string[] | undefined;
      const mimeType = mimeTypeArray && mimeTypeArray?.length > 0 ? mimeTypeArray[0] : "";
      const url: URL = new URL(entry.request.url);
      const hostUrl = url.hostname;

      addToRecord(types, mimeType, i, id, "partial");
      addToRecord(urls, hostUrl, i, id, "yes");
      endpoints.push({ selected: "yes", url, type: mimeType, id, method: entry.request.method, headers: [...entry.request.headers] });
    }

    recalcTypeSelections(types, endpoints);
    setOutputState(types, urls, endpoints);
  };

  const createHTMLFileArray = (doc: Document) => {
    const types: Record<string, OutputRecord | undefined> = {};
    const urls: Record<string, OutputRecord | undefined> = {};
    const parsedEndpoints: ParsedEndpoint[] = [];
    const uniqueVariables = new Set<string>();
    const baseUrl = state.serverUrl || "http://changeme.com";

    doc.querySelectorAll("div[id^=\"operations-\"]").forEach((element, index) => {
      const urlElement = element.querySelector(".opblock-summary-path a") as HTMLElement;
      const methodElement = element.querySelector(".opblock-summary-method") as HTMLElement;
      const selectElement = element.querySelector(".response-control-media-type select") as HTMLSelectElement;

      if (!urlElement || !methodElement) { return; }

      let url = urlElement.innerText.trim();
      collectVariables(url, uniqueVariables);
      url = url.replace(/\{([^}]+)\}/g, "${$1}");

      const method = methodElement.innerText.trim();
      const selectedOption = selectElement?.querySelector("option[selected]") as HTMLOptionElement;
      const accept = selectedOption?.value || (selectElement ? selectElement.options[0].value : "*/*");
      const id = uniqueId();
      const mimeType = accept;

      const fullPath = baseUrl.endsWith("/") || url.startsWith("/") ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
      const hostUrl = new URL(baseUrl).hostname;

      // URL-like object to avoid encoding `{}` into `%7B`/`%7D` for template variables
      const parsedUrl = {
        href: fullPath,
        toString: () => fullPath
      };

      addToRecord(types, mimeType, index, id, "partial");
      addToRecord(urls, hostUrl, index, id, "yes");

      parsedEndpoints.push({
        selected: "yes",
        url: parsedUrl as unknown as URL,
        type: mimeType,
        id,
        method,
        headers: []
      });
    });

    setOutputState(types, urls, parsedEndpoints, uniqueVariables);
  };

  const createSwaggerUrlFileArray = (swaggerData: SwaggerDoc3, serverUrl: string) => {
    const types: Record<string, OutputRecord | undefined> = {};
    const urls: Record<string, OutputRecord | undefined> = {};
    const parsedEndpoints: ParsedEndpoint[] = [];
    const uniqueVariables = new Set<string>();
    const serverHost = new URL(serverUrl).hostname;

    Object.keys(swaggerData.paths).forEach((pathKey, index) => {
      const pathItem = swaggerData.paths[pathKey];

      if (pathItem !== undefined) {
        collectVariables(pathKey, uniqueVariables);

        const formattedPathKey = pathKey.replace(/\{([^}]+)\}/g, "${$1}");
        const fullPath = serverUrl.endsWith("/") || formattedPathKey.startsWith("/")
          ? `${serverUrl}${formattedPathKey}`
          : `${serverUrl}/${formattedPathKey}`;
        Object.keys(pathItem).forEach((method) => {
          const operation = pathItem[method as keyof OpenAPIV3.PathItemObject] as OpenAPIV3.OperationObject;
          if (operation) {
            const id = uniqueId();
            let mimeType = "*/*";
            if (operation.responses) {
              for (const responseCode in operation.responses) {
                const response = operation.responses[responseCode];
                if ("$ref" in response) {
                  break;
                } else {
                  const responseObj = response as OpenAPIV3.ResponseObject;
                  if (responseObj.content) {
                    mimeType = Object.keys(responseObj.content)[0] || "*/*";
                    break;
                  }
                }
              }
            }

            // URL-like object to avoid encoding `{}` into `%7B`/`%7D` for template variables
            const parsedUrl = {
              href: fullPath,
              toString: () => fullPath
            } as unknown as URL;

            addToRecord(types, mimeType, index, id, "partial");
            addToRecord(urls, serverHost, index, id, "yes");

            parsedEndpoints.push({
              selected: "yes",
              url: parsedUrl,
              type: mimeType,
              id,
              method: method.toUpperCase(),
              headers: []
            });
          }
        });
      }
    });

    setOutputState(types, urls, parsedEndpoints, uniqueVariables);
  };

  const handleChange = (type: string, ident: string | ParsedEndpoint) => {
    const outputName: Output | undefined = state.output[filename];
    if (!outputName) {
      log("No output found for " + filename, LogLevel.WARN, state.output);
      return;
    }
    const indices = [...outputName.endpoints];
    const urlTypeIdent = ident as string;
    switch (type) {
      case "url": {
        outputName.urls[urlTypeIdent]?.index.forEach((url: IndexType) => {
          indices.forEach(item => {
            if (url.id === item.id) { item.selected = outputName.urls[urlTypeIdent]?.selected === "no" ? "yes" : "no"; }
          });
        });
        break;
      }
      case "type": {
        outputName.types[urlTypeIdent]?.index.forEach((indexType: IndexType) => {
          indices.forEach(item => {
            if (indexType.id === item.id) { item.selected = outputName.types[urlTypeIdent]?.selected === "no" ? "yes" : "no"; }
          });
        });
        break;
      }
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

  const handleSelectUrls = (selected?: "yes" | "no") => {
    const outputName = state.output[filename];
    if (!outputName) { return; }

    const updatedUrls = { ...outputName.urls };
    const updatedEndpoints = [...outputName.endpoints];

    Object.keys(updatedUrls).forEach((key) => {
      if (selected) {
        updatedUrls[key]!.selected = selected;
        updatedUrls[key]!.index.forEach((url) => {
          const endpoint = updatedEndpoints.find((ep) => ep.id === url.id);
          if (endpoint) { endpoint.selected = selected; }
        });
      } else if (urlFilter) {
        const selectedByFilter = key.includes(urlFilter) ? "yes" : "no";
        updatedUrls[key]!.selected = selectedByFilter;
        updatedUrls[key]!.index.forEach((url) => {
          const endpoint = updatedEndpoints.find((ep) => ep.id === url.id);
          if (endpoint) { endpoint.selected = selectedByFilter; }
        });
      }
    });

    setState(({ output, ...prevState }: YamlWriterUploadState) => ({
      ...prevState,
      output: {
        ...output,
        [filename]: {
          ...outputName,
          urls: updatedUrls,
          endpoints: updatedEndpoints
        }
      }
    }));
  };

  const handleSelectAllHeaders = (selected: "yes" | "no") => {
    const outputName = state.output[filename];
    if (!outputName) { return; }

    const updatedTypes = { ...outputName.types };
    const updatedEndpoints = [...outputName.endpoints];

    Object.keys(updatedTypes).forEach((key) => {
      updatedTypes[key]!.selected = selected;
      updatedTypes[key]!.index.forEach((type) => {
        const endpoint = updatedEndpoints.find((ep) => ep.id === type.id);
        if (endpoint) { endpoint.selected = selected; }
      });
    });

    setState(({ output, ...prevState }: YamlWriterUploadState) => ({
      ...prevState,
      output: {
        ...output,
        [filename]: {
          ...outputName,
          types: updatedTypes,
          endpoints: updatedEndpoints
        }
      }
    }));
  };

  return (
    <HeaderMain>
      <h2> Create from Upload </h2>
      <Div style={{ marginTop: "0px", justifyContent: "space-between", height: "30px" }}>
        <Button onClick={() => fileModalRef.current?.openModal()}>
          Upload File
        </Button>
        <Button onClick={() => swaggerUrlModalRef.current?.openModal()}>
          Upload From Swagger URL
        </Button>
        <h3 style={{paddingRight: "100px"}}>
          <a href="https://familysearch.github.io/pewpew/" target="_blank">
          Help
          </a>
        </h3>
      </Div>
      <Modal
        ref={fileModalRef}
        title="Upload Files"
        submitText="Load"
        closeText="Cancel"
        onSubmit={submitEvent}
        onClose={() => clearStateValue("file")}
        isReady={state.file !== undefined}
      >
        <div style={{color: "rgb(242, 241, 239)"}}>
          Drag file to drop zone or click to select file to load. Currently will only load one file at a time. Accepts either Har file or Swagger HTML file.
        </div>
        <div style={{color: "rgb(242, 241, 239)"}}>
          IMPORTANT! Swagger HTML files must have all collapsible endpoints opened
        </div>
        <DropFile onDropFile={handleFileInput} multiple={false}></DropFile>
        <div>
          {state.file && (
            <div style={{paddingTop: "13px"}}>
              <Button style={{marginRight: "5px"}} onClick={() => clearStateValue("file")}><DeleteIcon /></Button>
              {state.file.name}
            </div>
          )}
        </div>
      </Modal>
      <Modal
        ref={swaggerUrlModalRef}
        title="Enter Swagger URL"
        submitText="Submit"
        closeText="Cancel"
        isReady={true}
        onSubmit={submitUrlEvent}
        onClose={() => clearStateValue("swaggerUrl")}
      >
        <div style={{color: "rgb(242, 241, 239)"}}>
          Enter URL from Swagger JSON doc.
        </div>
        <div style={{ width: "90%", height: "auto", display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
          <input type="text" style={{ width: "80%", padding: "10px", marginTop: "10px" }} placeholder="Enter Swagger URL" value={state.swaggerUrl} onChange={(e) => setState({ ...state, swaggerUrl: e.target.value })} />
        </div>
      </Modal>
      <Modal
        ref={serverUrlModalRef}
        title="Insert Server URL"
        submitText="Submit"
        onSubmit={async () => {
          try {
            await handleServerUrlSubmit();
          } catch (error) {
            log("Error: improper URL", LogLevel.ERROR, error, "Make sure the input is a valid URL");
          }
        }}
        closeText="Cancel"
        onClose={() => clearStateValue("serverUrl")}
        isReady={true}
      >
        <div style={{color: "rgb(242, 241, 239)"}}>
          Swagger Page is missing server URL please enter one now.
        </div>
        <div style={{ width: "90%", height: "auto", display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
          <input
            type="text"
            placeholder="Enter server URL. https://CHANGETHIS.com"
            style={{ width: "80%", padding: "10px", marginTop: "10px" }}
            value={state.serverUrl}
            onChange={(e) => setState((prev) => ({ ...prev, serverUrl: e.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        ref={variableModalRef}
        title="Required Variables"
        submitText="Close"
        closeText="Close"
        isReady={true}
        onSubmit={() => {
          return new Promise<void>((resolve) => {
            variableModalRef.current?.closeModal();
            setFoundVariables([]);
            resolve();
          });
        }}
      >
        <div style={{ padding: "20px" }}>
          <h3>These variables were found in the swagger and must be filled out:</h3>
          {foundVariables.length > 0 ? (
            <ul>
              {foundVariables.map((variable, index) => (
                <li key={index}>{variable}</li>
              ))}
            </ul>
          ) : (
            <p>No variables found.</p>
          )}
        </div>
      </Modal>
      <Modal
        ref={endpointModalRef}
        title="Customize File"
        submitText="Submit"
        onSubmit={finalizeEndpoints}
        closeText="Cancel"
        isReady={true}
        scrollable={true}
      >
        <AccordianStyleDiv style={{paddingRight: "20px"}}>
          <div>
            <Span>
              <h2>Urls</h2>
              <div style={{ display: "flex", alignItems: "center", marginLeft: "10px" }}>
                <Input
                  type="text"
                  placeholder="Filter URLs"
                  value={urlFilter}
                  onChange={(e) => setUrlFilter(e.target.value)}
                />
                <Button
                  onClick={() => handleSelectUrls()}
                  style={{ marginLeft: "0"}}
                  disabled={!urlFilter.length}
                >
                  Filter
                </Button>
                <Button
                  onClick={() => handleSelectUrls("yes")}
                  disabled={
                  state.output[filename]?.urls &&
                  Object.values(state.output[filename]!.urls).every((url) => url?.selected === "yes")
                  }
                >
                  Select All
                </Button>
                <Button
                  onClick={() => handleSelectUrls("no")}
                  disabled={
                  state.output[filename]?.urls &&
                  Object.values(state.output[filename]!.urls).every((url) => url?.selected === "no")
                  }
                >
                  Deselect All
                </Button>
              </div>
            </Span>
            <Accordion allowMultipleExpanded={true} allowZeroExpanded={true}>
              {state.output[filename]?.urls && Object.keys(state.output[filename]!.urls).map((key, index) => {
                const url: OutputRecord = state.output[filename]!.urls[key]!;
                return (
                  <AccordionItem key={index}>
                    <AccHeadingDiv>
                      <Button
                        onClick={() => handleChange("url", key)}
                        className={"accButton" +
                          (url.selected === "yes" ? " accUrlButtonYes" : "") +
                          (url.selected === "partial" ? " accUrlButtonPartial" : "") +
                          (url.selected === "no" ? " accUrlButtonNo" : "")}
                      >
                        {"" + (url.selected === "yes" ? "✔" : "") +
                          (url.selected === "partial" ? "/" : "") +
                          (url.selected === "no" ? "X" : "")}
                      </Button>
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
            <Span>
              <h2>Return Types</h2>
              <div style={{ display: "flex", alignItems: "center", marginLeft: "10px" }}>
                  <Button
                  onClick={() => handleSelectAllHeaders("yes")}
                  disabled={
                    state.output[filename]?.types &&
                    Object.values(state.output[filename]!.types).every((type) => type?.selected === "yes")
                  }
                  >
                  Select All
                  </Button>
                <Button
                  onClick={() => handleSelectAllHeaders("no")}
                  disabled={
                    state.output[filename]?.types &&
                    Object.values(state.output[filename]!.types).every((type) => type?.selected === "no")
                  }
                >
                  Deselect All
                </Button>
              </div>
            </Span>
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