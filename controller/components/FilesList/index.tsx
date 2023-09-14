import Div from "../Div";
import React from "react";
import styled from "styled-components";

const FilesDiv = styled(Div)`
  flex: initial;
`;

// What this returns or calls from the parents
export interface FileListProps {
  files: (File | string)[];
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

const FileList = ({
  files,
  onClick
}: FileListProps) => {
  const additionalFileJsx: JSX.Element[] = files.map((file: File | string) => (typeof file === "string") ? file : file.name)
    .map((filename: string) => <li key={filename}>{filename} <button name={filename} onClick={onClick}>X</button></li>);
  return (
    <React.Fragment>
      {additionalFileJsx.length > 0 && <FilesDiv className="files-div"><ul>{additionalFileJsx}</ul></FilesDiv>}
    </React.Fragment>
  );
};

export default FileList;
