import { DEV_KEY_BETA, DEV_KEY_PROD } from "../../util/yamlwriter";
import React from "react";
import styled from "styled-components";

const DropboxLabel = styled.label`
  margin-right: 5px;
  margin-top: 5px;
  margin-bottom: 0px;
  font-size: 11px;
  display: flex;
  flex-direction: row;
`;

const DropDownSelect = styled.select`
  margin-top: 0px;
  margin-bottom: 0px;
  font-size: 10px;
  display: flex;
  flex-direction: row;
`;

interface VarsDropDownProps {
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  display: boolean;
}

// Drop down window for devKey
export default function VarsDropDown (props: VarsDropDownProps) {

  const changeEnvironment = (event: React.ChangeEvent<HTMLSelectElement>) => {
    props.onChange(event);
  };

  return (
    <div>
      {props.display &&
        <DropboxLabel>
          Enviornment:&nbsp;&nbsp;
          <DropDownSelect id="dropDownValue" onChange={changeEnvironment}>
              <option value={DEV_KEY_BETA}>Beta</option>
              <option value={DEV_KEY_PROD}>Prod</option>
              <option value={DEV_KEY_BETA}>Integ</option>
          </DropDownSelect>
        </DropboxLabel>
      }
    </div>
  );
}
