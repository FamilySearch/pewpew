import { AgentQueueDescription } from "@fs/ppaas-common/dist/types";
import { Danger } from "../Alert";
import Div from "../Div";
import React from "react";
import styled from "styled-components";

const QueueDiv = styled(Div)`
  flex-flow: row wrap;
  border: 1;
`;
const QueueDivLabel = styled(Div)`
  flex: 1;
  justify-content: flex-end;
  padding: 1rem;
  border: 1;
`;
const QueueDivSelect = styled(Div)`
  flex: 1;
  justify-content: flex-start;
  padding: 1rem;
  border: 1;
`;

/** Props returned by getServerSideProps */
export interface QueueInitialProps {
  queueName: string;
  testQueues: AgentQueueDescription;
  loading: boolean;
  error: boolean;
}

/** Props passed in by the parent object */
export interface QueueProps extends QueueInitialProps {
  name?: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export const TestQueues = ({
  name,
  queueName,
  onChange,
  testQueues = {},
  loading,
  error
}: QueueProps) => {
  // console.log("TestQueues state", { testQueues, loading, error });
  let optionItems: JSX.Element[] | undefined;
  if (testQueues && Object.keys(testQueues).length > 0) {
    optionItems = Object.entries(testQueues).map((entry) => (<option value={entry[0]} key={entry[0]}>{entry[1]} - {entry[0]}</option>));
  }
  return (
    <QueueDiv className="queue-div">
      <QueueDivLabel className="queue-div-label"><label>Test Queue </label></QueueDivLabel>
      {loading && <QueueDivSelect className="queue-div-loading">Loading...</QueueDivSelect>}
      {!loading && !error && <QueueDivSelect className="queue-div-select"><select name={name} value={queueName} onChange={onChange}>{optionItems} </select></QueueDivSelect>}
      {error && <QueueDivSelect className="queue-div-error"><Danger>Could not load the current Test Queues</Danger></QueueDivSelect>}
    </QueueDiv>
  );
};

export default TestQueues;
