import type { Meta, StoryFn } from "@storybook/react";
import {
  statsdiscoverywicffamilybeta20200311T194618937,
  statsdiscoverywicffamilybeta20200311T200153210,
  statsdiscoverywicffamilybeta20200311T221932362
} from "./storyData";
import { GlobalStyle } from "../Global";
import React from "react";
import { TestResults } from ".";

const statsIntegration = "{\"test\":\"integration\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"http://localhost:9001/\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAYAAAAAAAAAAwAAAAAAAAABAAAAAAAAD/8/8AAAAAAAAP8VAqkTAg\",\"statusCounts\":{\"200\":2}}}}";
// eslint-disable-next-line quotes
const statsIntOnDemand = `{"test":"int_on_demand","bin":"0.5.10","bucketSize":60}{"index":0,"tags":{"_id":"0","method":"GET","url":"http://localhost:9001"}}{"index":1,"tags":{"_id":"1","method":"GET","url":"http://localhost:9001?*"}}{"time":1656339120,"entries":{"0":{"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAALkVAtkBAjkCEwI","statusCounts":{"204":4}},"1":{"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAANUSAmsCvQECVQI","statusCounts":{"204":4}}}}`;

export default {
  title: "TestResults"
} as Meta<typeof TestResults>;

export const EmptyResults: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults resultsText={""} />
  </React.Fragment>
);

export const IntegrationResult: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults resultsText={statsIntegration} />
  </React.Fragment>
);

export const IntOnDemandResult: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults resultsText={statsIntOnDemand} />
  </React.Fragment>
);

IntOnDemandResult.story = {
  name: "IntOnDemand Result"
};

export const Discovery1Result: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults resultsText={statsdiscoverywicffamilybeta20200311T194618937} />
  </React.Fragment>
);

export const Discovery2Result: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults resultsText={statsdiscoverywicffamilybeta20200311T200153210} />
  </React.Fragment>
);

export const Discovery3Result: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <TestResults resultsText={statsdiscoverywicffamilybeta20200311T221932362} />
  </React.Fragment>
);
