import styled from "styled-components";

export const Div = styled.div`
  margin-top: 15px;
  display: flex;
  flex-direction: row;
`;

export const Label = styled.label`
  margin-right: 8px;
  display: flex;
  flex-direction: row;
`;

export const Span = styled.span`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  margin-right: 15px;
`;

export const NonFlexSpan = styled.span`
  display: flex;
  flex-direction: row;
  flex-wrap: no-wrap;
  align-items: center;
  margin-right: 15px;
`;

export const Checkbox = styled.input`
margin-right: 15px;
`;

export const InputsDiv = styled.div`
  display: inline-block;
  border-right: 2px solid black;
  border-bottom: 2px solid black;
  margin-right: 40px;
  padding-right: 40px;
  padding-bottom: 40px;
  padding-top: 5px;
  margin-bottom: 10px;
`;

export const Button = styled.button`
  border-radius: 5px;
  background: gray;
  border: none;
  padding: 5px 10px;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
  margin-right: 5px;
  color: white;
  &:disabled {
    cursor: not-allowed;
    color: black;
    background: none;
  }
  &[data-emphasis="low"] {
    background: none;
    border: 2px solid gray;
  }
`;

export const Input = styled.input`
  border-radius: 5px;
  border: 2px solid gray;
  padding: 5px 10px;
`;

export const Select = styled.select`
  border-radius: 5px;
  border: 2px solid gray;
  padding: 5px 10px;
`;
