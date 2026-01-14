import Dropzone, { DropzoneInputProps, DropzoneRootProps} from "react-dropzone";
import { Div } from "../Div";
import React from "react";
import styled from "styled-components";

const FileDiv = styled(Div)`
`;
const DropzoneDiv = styled(Div)`
  flex: 1 1 auto;
  height: 200px;
  width: 200px;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  border-width: 10px;
  border-radius: 2px;
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

// What this returns or calls from the parents
export interface DropFileProps {
  onDropFile: (filelist: File[]) => Promise<void> | void;
  /** Default: true */
  multiple?: boolean;
}

const DropFile = ({ onDropFile, multiple = true }: DropFileProps) => {
  return (
    <FileDiv className="file-div">
      <Dropzone onDrop={onDropFile} multiple={multiple} >
        {({getRootProps, getInputProps}: {getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps, getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps }) => (
          // <section>
            <DropzoneDiv className="dropzone" {...getRootProps()}>
              <input {...getInputProps()} />
              <p>Drop files here, or click to select files</p>
            </DropzoneDiv>
          // </section>
        )}
      </Dropzone>
    </FileDiv>
  );
};

export default DropFile;
