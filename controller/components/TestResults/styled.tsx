import styled from "styled-components";

export const ENDPOINT = styled.div`
  margin-bottom: 1em;
  padding: 0;
`;

export const H3 = styled.h3`
  text-align: left;
  word-break: break-all;
`;

export const ENDPOINTDIV1 = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

export const RTTDIV = styled(ENDPOINTDIV1)`
  margin-bottom: 2em;
`;

export const FLEXROW = styled.div`
  display: flex;
  flex-direction: row;
`;

export const ENDPOINTDIV2 = styled(FLEXROW)`
  align-items: center;
`;

export const RTTTABLE = styled(ENDPOINTDIV1)`
  max-width: 400px;
  margin-right: 15px;
`;

export const UL = styled.ul`
  list-style: none;
`;