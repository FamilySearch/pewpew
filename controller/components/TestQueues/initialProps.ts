import { AgentQueueDescription, LogLevel, PpaasTestMessage, log } from "@fs/ppaas-common";
import { API_QUEUES } from "../../types";
import { QueueInitialProps } from ".";

export const getServerSideProps = (): QueueInitialProps => {
  try {
    const testQueues: AgentQueueDescription = PpaasTestMessage.getAvailableQueueMap();
    // Grab the response
    // console.log("TestQueues testQueues: " + JSON.stringify(testQueues), testQueues);
    const keys: string[] = Object.keys(testQueues);
    let queueName: string;
    if (keys.length > 0) {
      queueName = keys[0];
      // console.log("TestQueues firstQueue: " + queueName);
    } else {
      throw new Error(`No queues returned by ${API_QUEUES}: ${JSON.stringify(testQueues)}`);
    }
    return {
      queueName,
      testQueues,
      loading: false,
      error: false
    };
  } catch (error) {
    // We need this error on the client and the server
    log("Error loading queues", LogLevel.ERROR, error);
    return {
      queueName: "",
      testQueues: {},
      loading: false,
      error: true
    };
  }
};

export default getServerSideProps;
