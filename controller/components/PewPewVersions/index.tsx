import React, { JSX } from "react";
import { Danger } from "../Alert";
import { Div } from "../Div";
import { Toaster }  from "../Toaster";
import styled from "styled-components";

const VersionDiv = styled(Div)`
  flex-flow: row wrap;
  border: 1;
`;
const VersionDivLabel = styled(Div)`
  flex: 1;
  justify-content: flex-end;
  padding: 1rem;
  border: 1;
`;
const VersionDivSelect = styled(Div)`
  flex: 1;
  justify-content: flex-start;
  padding: 1rem;
  border: 1;
`;

/** Props returned by getServerSideProps */
export interface VersionInitalProps {
  pewpewVersion: string;
  pewpewVersions: string[];
  latestPewPewVersion: string;
  loading: boolean;
  error: boolean;
}

/** Props passed in by the parent object */
export interface VersionProps extends VersionInitalProps {
  name?: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export const PewPewVersions = ({
  name,
  pewpewVersion,
  onChange,
  latestPewPewVersion: latestPewPewTag,
  pewpewVersions = [],
  loading,
  error
}: VersionProps) => {
  // console.log("PewPewVersions state", { pewpewVersions, loading, error });
  let optionItems: JSX.Element[] | undefined;
  const toasterMessage: string = "IMPORTANT: Please configure your YAML properly!!! The latest version of Pewpew is set to: " + latestPewPewTag;
  if (pewpewVersions && pewpewVersions.length > 0) {
    optionItems = pewpewVersions.map((version: string) => (<option value={version} key={version}>{version}</option>));
  }
  return (
    <VersionDiv>
      <VersionDivLabel><label>PewPew Version </label></VersionDivLabel>
      {loading && <VersionDivSelect>Loading...</VersionDivSelect>}
      {!loading && !error && <VersionDivSelect><select name={name} value={pewpewVersion} onChange={onChange}>{optionItems} </select></VersionDivSelect>}
      {error && <VersionDivSelect><Danger>Could not load the current PewPew Versions</Danger></VersionDivSelect>}
      <Toaster id="toaster" message={toasterMessage}/>
    </VersionDiv>
  );
};

export default PewPewVersions;
