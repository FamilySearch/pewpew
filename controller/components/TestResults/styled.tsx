import styled from "styled-components";

export const EndpointDiv = styled.div`
  margin-bottom: 1em;
  padding: 0;
`;

export const H3 = styled.h3`
  text-align: left;
  word-break: break-all;
`;

export const EndpointDiv1 = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

export const RttDiv = styled(EndpointDiv1)`
  margin-bottom: 2em;
`;

export const FlexRow = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
`;

export const EndpointDiv2 = styled(FlexRow)`
  align-items: center;
`;

export const RttTable = styled(EndpointDiv1)`
  max-width: 400px;
  margin-right: 15px;
`;

export const StyledUl = styled.ul`
  list-style: none;
`;