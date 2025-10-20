import { LogLevel, log } from "../../src/log";
import type { Meta, StoryFn } from "@storybook/react";
import { Modal, ModalObject, TestsListModal, useEffectModal } from ".";
import React, { useRef, useState } from "react";
import TestsList, { TestListProps } from "../TestsList";
import { Button } from "../LinkButton";
import { Div } from "../Div";
import DropFile from "../DropFile";
import { GlobalStyle } from "../Layout";
import { PpaasTestId } from "@fs/ppaas-common/dist/src/ppaastestid";
import { TestData } from "../../types/testmanager";
import { TestStatus } from "@fs/ppaas-common/dist/types";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Modal component.
 * Source: https://storybook.js.org
 */
 let counter = 0;
 const makeTestData = (status: TestStatus, testName: string = "Story"): TestData => {
   counter++;
   const date: Date = new Date();
   date.setTime(date.getTime() - counter * 235 * 60000);
   let ppaasTestId: PpaasTestId;
   try {
     ppaasTestId = PpaasTestId.makeTestId("Story" + counter, {
       dateString: PpaasTestId.getDateString(date)
     });
   } catch (error) { // eslint-disable-line  @typescript-eslint/no-unused-vars
     // For some reason newer versions of storybook do not have path.extname()
     ppaasTestId = PpaasTestId.getFromS3Folder(`${testName}${counter}/` + PpaasTestId.getDateString(date));
   }
   const basicTest: TestData = {
     testId: ppaasTestId.testId,
     s3Folder: ppaasTestId.s3Folder,
     startTime: ppaasTestId.date.getTime(),
     status,
     resultsFileLocation: [""]
   };
   return basicTest;
 };

const ModalUploadDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
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
     <Div>
       <button onClick={() => modalRef.current?.openModal()}>Upload File</button>
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
               <button name={`remove${index}`} style={{marginRight: "5px", marginTop: "40px"}} onClick={() => onRemoveFile(index)}>X</button>
               {file.name}
             </div>
           ))}
         </div>
       </Modal>
     </Div>
   </div>
 );
};

const propsLoaded: TestListProps = {
  tests: Object.values(TestStatus).map((status: string) => makeTestData(status as TestStatus))
};

const propsLoadedLarge: TestListProps = {
  tests: [
    ...Object.values(TestStatus),
    ...Object.values(TestStatus),
    ...Object.values(TestStatus),
    ...Object.values(TestStatus),
    ...Object.values(TestStatus),
    ...Object.values(TestStatus),
    ...Object.values(TestStatus),
    ...Object.values(TestStatus)
  ].map((status: string) => makeTestData(status as TestStatus, "ReallyReallyReallyLongStory"))
};

const ModalFileListDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
 useEffectModal(modalRef, LogLevel.INFO);

 return (
   <div>
     <GlobalStyle />
     <Div>
       Compare results with:&nbsp;<Button onClick={() => modalRef.current?.openModal()}>Prior Test</Button>
       <Modal
         ref={modalRef}
         title={"Compare With"}
         closeText={"Cancel"}
       >
        <TestsList {...propsLoaded} />
       </Modal>
     </Div>
   </div>
 );
};

const ModalFileListLargeDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
 useEffectModal(modalRef, LogLevel.INFO);

 return (
   <div>
     <GlobalStyle />
     <Div>
       Compare results with:&nbsp;<Button onClick={() => modalRef.current?.openModal()}>Prior Test</Button>
       <Modal
         ref={modalRef}
         title={"Compare With"}
         closeText={"Cancel"}
       >
        <TestsList {...propsLoadedLarge} />
       </Modal>
     </Div>
   </div>
 );
};

const TestsListModalUndefinedDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
 useEffectModal(modalRef, LogLevel.INFO);

 const handleClick = (event: React.MouseEvent<HTMLButtonElement>, test: TestData) => {
   log("Test clicked", LogLevel.INFO, test);
 };

 return (
   <div>
     <GlobalStyle />
     <Div>
       Compare results with:&nbsp;<Button onClick={() => modalRef.current?.openModal()}>Prior Test</Button>
       <TestsListModal
         ref={modalRef}
         tests={undefined}
         onClick={handleClick}
       />
     </Div>
   </div>
 );
};

const TestsListModalEmptyDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
 useEffectModal(modalRef, LogLevel.INFO);
 const [tests, setTests] = useState<TestData[] | undefined>(undefined);

 const handleClick = (event: React.MouseEvent<HTMLButtonElement>, test: TestData) => {
   log("Test clicked", LogLevel.INFO, test);
 };

 const handleOpenModal = () => {
   setTests(undefined);
   modalRef.current?.openModal();
   setTimeout(() => {
     setTests([]);
   }, 1000);
 };

 return (
   <div>
     <GlobalStyle />
     <Div>
       Compare results with:&nbsp;<Button onClick={handleOpenModal}>Prior Test</Button>
       <TestsListModal
         ref={modalRef}
         tests={tests}
         onClick={handleClick}
       />
     </Div>
   </div>
 );
};

const TestsListModalLoadedDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
 useEffectModal(modalRef, LogLevel.INFO);
 const [tests, setTests] = useState<TestData[] | undefined>(undefined);

 const handleClick = (event: React.MouseEvent<HTMLButtonElement>, test: TestData) => {
   log("Test clicked", LogLevel.INFO, test);
 };

 const handleOpenModal = () => {
   setTests(undefined);
   modalRef.current?.openModal();
   setTimeout(() => {
     setTests(propsLoaded.tests);
   }, 1000);
 };

 return (
   <div>
     <GlobalStyle />
     <Div>
       Compare results with:&nbsp;<Button onClick={handleOpenModal}>Prior Test</Button>
       <TestsListModal
         ref={modalRef}
         tests={tests}
         onClick={handleClick}
       />
     </Div>
   </div>
 );
};

const TestsListModalLoadedLargeDemo = () => {
 const modalRef = useRef<ModalObject | null>(null);
 useEffectModal(modalRef, LogLevel.INFO);
 const [tests, setTests] = useState<TestData[] | undefined>(undefined);

 const handleClick = (event: React.MouseEvent<HTMLButtonElement>, test: TestData) => {
   log("Test clicked", LogLevel.INFO, test);
 };

 const handleOpenModal = () => {
   setTests(undefined);
   modalRef.current?.openModal();
   setTimeout(() => {
     setTests(propsLoadedLarge.tests);
   }, 1000);
 };

 return (
   <div>
     <GlobalStyle />
     <Div>
       Compare results with:&nbsp;<Button onClick={handleOpenModal}>Prior Test</Button>
       <TestsListModal
         ref={modalRef}
         tests={tests}
         onClick={handleClick}
       />
     </Div>
   </div>
 );
};


export default {
  title: "Modal"
} as Meta<typeof Modal>;

export const UploadModal: StoryFn = () => (
  <ModalUploadDemo/>
);

export const FileList: StoryFn = () => (
  <ModalFileListDemo/>
);

export const FileListLarge: StoryFn = () => (
  <ModalFileListLargeDemo/>
);

export const TestsListModalUndefined: StoryFn = () => (
  <TestsListModalUndefinedDemo/>
);

export const TestsListModalEmpty: StoryFn = () => (
  <TestsListModalEmptyDemo/>
);

export const TestsListModalLoaded: StoryFn = () => (
  <TestsListModalLoadedDemo/>
);

export const TestsListModalLoadedLarge: StoryFn = () => (
  <TestsListModalLoadedLargeDemo/>
);
