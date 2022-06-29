import { LogLevel, log } from "../../util/log";
import { Modal, ModalObject, useEffectModal } from ".";
import React, { useRef, useState } from "react";
import { DisplayDivMain } from "../YamlWriterForm";
import DropFile from "../DropFile";
import { GlobalStyle } from "../Global";
import { HeaderMain } from "../YamlWriterUpload";
import { Label } from "../YamlStyles";
import LoggerModal from "../YamlLoggers/LoggerModal";
import { ProviderListEntry } from "../../util/yamlwriter";
import { storiesOf } from "@storybook/react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Modal component.
 * Source: https://storybook.js.org
 */

 const ModalUploadHarDemo = () => {
  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef, LogLevel.INFO);

  const defaultFiles: File[] = [];
  const [files, setFiles] = useState(defaultFiles);
  const [isReady, setIsReady] = useState(false);

  const submitEvent = () => {
    log("submitting event and creating yaml file", LogLevel.INFO);
    return Promise.resolve();
  };
  const handleFileInput = (fileList: File[]) => {
    log("handling file input", LogLevel.INFO, fileList);
    setIsReady(files.length > 0 || fileList.length > 0);
    setFiles((oldFiles: File[]) => ([...oldFiles, ...fileList]));
  };
  const onRemoveFile = (index: number) => {
    log("handling file remove: " + index, LogLevel.INFO, index);
    setIsReady(files.length > 1);
    setFiles((oldFiles: File[]) => {
      oldFiles.splice(index);
      return [...oldFiles];
    });
  };

  return (
    <div>
      <GlobalStyle />
      <HeaderMain>
        <button onClick={() => modalRef.current?.openModal()}>Upload Har File</button>
        <Modal
          ref={modalRef}
          title={"Upload Files"}
          submitText={"Load"}
          onSubmit={submitEvent}
          closeText={"Cancel"}
          isReady={isReady}
        >
          <div style={{color: "rgb(242, 241, 239)"}}>
            Drag file to drop zone or click to select file to load. Currently will only load one file at a time.
          </div>
          <div style={{ width: "90%", height: "250px" }}>
            <DropFile onDropFile={handleFileInput}></DropFile>
          </div>
          <div>
            {files.map((file, index) => (
              <div style={{paddingTop: "13px"}} key={index}>
                <button name={`remove${index}`} style={{marginRight: "5px", marginTop:"40px"}} onClick={() => onRemoveFile(index)}>X</button>
                {file.name}
              </div>
            ))}
          </div>
        </Modal>
      </HeaderMain>
    </div>
  );
};

const ModalListDemo = () => {
  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef, LogLevel.INFO);

  const list = [ {id: "50", name: "list", value: "10"} ];
  const onChange = () => {
    // eslint-disable-next-line no-console
    console.log("changing value");
  };
  return (
    <div>
      <GlobalStyle />
      <button onClick={() => modalRef.current?.openModal()}>Edit List</button>
      <DisplayDivMain>
        <Modal
          ref={modalRef}
          title={"Edit List"}
          closeText={"Close"}
          >
          <div>
            Add values to your List provider&nbsp;&nbsp;
              <input id="providerList" name="" value="" onChange={onChange}/>
              <button id="providerList" name="" value="" >
                  Add
              </button>
          </div>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>List</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item: ProviderListEntry, index: number) => {
                return (
                  <tr key={index}>
                    <td className="tableButton"><button id="providerList" name="list item" value={item.id}>X</button></td>
                    <td className="tableListItem">{item.value}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </Modal>
      </DisplayDivMain>
    </div>
  );
};

const ModalLoggerDemo = () => {
  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef, LogLevel.INFO);

  const logger = { id: "0", name: "", select: [], where: "", to: "", pretty: false, limit: "", kill: false, ready: false};
  const changeLoggerSelect = () => {
    // eslint-disable-next-line no-console
    console.log("changing logger select");
  };
  return (
    <div>
      <GlobalStyle />
      <button onClick={() => modalRef.current?.openModal()}>Edit List</button>
      <DisplayDivMain>
      <LoggerModal ref={modalRef} data={logger} changeLogger={changeLoggerSelect}></LoggerModal>
      </DisplayDivMain>
    </div>
  );
};

const ModalCreateYamlDemo = () => {
  const modalRef = useRef<ModalObject| null>(null);
  useEffectModal(modalRef, LogLevel.INFO);

  const changeFileName = () => {
    // eslint-disable-next-line no-console
    console.log("changing logger select");
  };
  const submitEvent = () => {
    // eslint-disable-next-line no-console
    console.log("submitting event and creating yaml file");
    return Promise.resolve();
  };
  return (
    <div>
      <GlobalStyle />
      <button onClick={() => modalRef.current?.openModal()}>Create Yaml</button>
      <DisplayDivMain>
        <Modal
          ref={modalRef}
          title={"File Name"}
          onSubmit={submitEvent}
          submitText={"Process"}
          closeText={"Cancel"}
        >
          <Label>
            File Name:&nbsp;
            <input style={{width: "150px"}} onChange={changeFileName} value="" />.yaml
          </Label>
        </Modal>
      </DisplayDivMain>
    </div>
  );
};

storiesOf("Modal", module).add("Upload Har Modal", () => (
  <ModalUploadHarDemo/>
));

storiesOf("Modal", module).add("List Modal", () => (
  <ModalListDemo/>
));

storiesOf("Modal", module).add("Logger Modal", () => (
  <ModalLoggerDemo/>
));

storiesOf("Modal", module).add("Create Yaml Modal", () => (
  <ModalCreateYamlDemo/>
));
