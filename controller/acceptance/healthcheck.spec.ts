import { API_HEALTHCHECK, API_HEALTHCHECK_HEARTBEAT, API_HEALTHCHECK_S3, API_HEALTHCHECK_SQS } from "../types";
import { LogLevel, log } from "@fs/ppaas-common";
import _axios, { AxiosResponse as Response } from "axios";
import { expect } from "chai";

const fetch = _axios.get;

// Beanstalk <SYSTEM_NAME>_<SERVICE_NAME>_URL
const integrationUrl = "http://" + (process.env.BUILD_APP_URL || `localhost:${process.env.PORT || "8081"}`);

describe("Healthcheck Integration", () => {
  let url: string;

  before(() => {
    url = integrationUrl + API_HEALTHCHECK;
    log("smoke tests url=" + url, LogLevel.DEBUG);
  });

  it("GET healthcheck should respond 200 OK", (done: Mocha.Done) => {
    fetch(integrationUrl + API_HEALTHCHECK).then((res: Response) => {
      expect(res.status).to.equal(200);
      done();
    }).catch((error) => done(error));
  });

  it("GET healthcheck/heartbeat should respond 200 OK", (done: Mocha.Done) => {
    fetch(integrationUrl + API_HEALTHCHECK_HEARTBEAT).then((res: Response) => {
      expect(res.status).to.equal(200);
      done();
    }).catch((error) => done(error));
  });

  it("GET healthcheck/s3 should respond 200 OK", (done: Mocha.Done) => {
    fetch(integrationUrl + API_HEALTHCHECK_S3).then((res: Response) => {
      expect(res.status).to.equal(200);
      done();
    }).catch((error) => done(error));
  });

  it("GET healthcheck/sqs should respond 200 OK", (done: Mocha.Done) => {
    fetch(integrationUrl + API_HEALTHCHECK_SQS).then((res: Response) => {
      expect(res.status).to.equal(200);
      done();
    }).catch((error) => done(error));
  });
});
