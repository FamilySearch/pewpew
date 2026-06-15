import styled from "styled-components";

export const EndpointDiv = styled.div`
  margin-bottom: 1em;
  padding: 0;
`;

export const HashAnchorLink = styled.a`
  margin-left: 0.4em;
  color: #666;
  text-decoration: none;
  font-size: 0.75em;
  vertical-align: middle;
  opacity: 0;
  transition: opacity 0.15s;

  &:hover {
    color: #6a7bb4;
  }
`;

export const H3 = styled.h3`
  text-align: left;
  word-break: break-all;

  &:hover ${HashAnchorLink} {
    opacity: 1;
  }
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