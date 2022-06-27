import * as React from "react";
import { TestResults } from "./components/TestResults";

const statsIntegration = "{\"test\":\"integration\",\"bin\":\"0.5.10\",\"bucketSize\":60}{\"index\":0,\"tags\":{\"_id\":\"0\",\"method\":\"POST\",\"url\":\"http://localhost:9001/\"}}{\"time\":1656339120,\"entries\":{\"0\":{\"rttHistogram\":\"HISTEwAAAAYAAAAAAAAAAwAAAAAAAAABAAAAAAAAD/8/8AAAAAAAAP8VAqkTAg\",\"statusCounts\":{\"200\":2}}}}";
// const statsIntOnDemand = `{"test":"int_on_demand","bin":"0.5.10","bucketSize":60}{"index":0,"tags":{"_id":"0","method":"GET","url":"http://localhost:9001"}}{"index":1,"tags":{"_id":"1","method":"GET","url":"http://localhost:9001?*"}}{"time":1656339120,"entries":{"0":{"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAALkVAtkBAjkCEwI","statusCounts":{"204":4}},"1":{"rttHistogram":"HISTEwAAAAoAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAI/8AAAAAAAANUSAmsCvQECVQI","statusCounts":{"204":4}}}}`;

const App = () => {
    return (<>
        <h3> Welcome to React Boilerplate </h3>
        <TestResults resultsText={statsIntegration} />
    </>);
};

export default App;