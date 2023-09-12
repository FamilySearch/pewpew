import { LogLevel, log } from "@fs/ppaas-common";
import axios, { AxiosResponse as Response } from "axios";
import { expect } from "chai";

const integrationUrl = process.env.BUILD_APP_URL || "http://localhost:8080";
log("integrationUrl = " + integrationUrl);

describe("Healthcheck Integration", () => {
  let url: string;

  before(() => {
    url = integrationUrl;
    log("smoke tests url=" + url, LogLevel.DEBUG);
  });

  describe(integrationUrl + "/healthcheck/", () => {
    it("GET healthcheck/ should respond 200 OK", (done: Mocha.Done) => {
      axios.get(integrationUrl + "/healthcheck/").then((res: Response) => {
        expect(res.status).to.equal(200);
        const data = res.data;
        expect(data, "data").to.not.equal(undefined);
        expect(data?.s3, "data.s3").to.equal(true);
        expect(data?.sqs, "data.sqs").to.equal(true);
        expect(data?.failHealthCheck, "data.failHealthCheck").to.equal(false);
        expect(typeof data?.lastS3Access, "typeof data.lastS3Access").to.equal("string");
        expect(typeof data?.lastSQSAccess, "typeof data.lastSQSAccess").to.equal("string");
        expect(typeof data?.ipAddress, "typeof data.ipAddress").to.equal("string");
        expect(typeof data?.hostname, "typeof data.hostname").to.equal("string");
        expect(typeof data?.instanceId, "typeof data.instanceId").to.equal("string");
        done();
      }).catch((error) => done(error));
    });
  });

  describe(integrationUrl + "/healthcheck/heartbeat", () => {
    it("GET healthcheck/heartbeat should respond 200 OK", (done: Mocha.Done) => {
      axios.get(integrationUrl + "/healthcheck/heartbeat").then((res: Response) => {
        expect(res.status).to.equal(200);
        const data = res.data;
        expect(data, "data").to.not.equal(undefined);
        expect(data?.s3, "data.s3").to.equal(true);
        expect(data?.sqs, "data.sqs").to.equal(true);
        expect(data?.failHealthCheck, "data.failHealthCheck").to.equal(undefined);
        expect(data?.lastS3Access, "data.lastS3Access").to.equal(undefined);
        expect(data?.lastSQSAccess, "data.lastSQSAccess").to.equal(undefined);
        expect(data?.ipAddress, "data.ipAddress").to.equal(undefined);
        expect(data?.hostname, "data.hostname").to.equal(undefined);
        expect(data?.instanceId, "data.instanceId").to.equal(undefined);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("/healthcheck/s3", () => {
    it("GET healthcheck/s3 should respond 200 OK", (done: Mocha.Done) => {
      axios.get(integrationUrl + "/healthcheck/s3").then((res: Response) => {
        expect(res.status).to.equal(200);
        const data = res.data;
        expect(data, "data").to.not.equal(undefined);
        expect(data?.s3, "data.s3").to.equal(true);
        expect(data?.sqs, "data.sqs").to.equal(undefined);
        expect(data?.failHealthCheck, "data.failHealthCheck").to.equal(false);
        expect(typeof data?.lastS3Access, "typeof data.lastS3Access").to.equal("string");
        expect(typeof data?.lastSQSAccess, "typeof data.lastSQSAccess").to.equal("string");
        expect(typeof data?.ipAddress, "typeof data.ipAddress").to.equal("string");
        expect(typeof data?.hostname, "typeof data.hostname").to.equal("string");
        expect(typeof data?.instanceId, "typeof data.instanceId").to.equal("string");
        done();
      }).catch((error) => done(error));
    });
  });

  describe("/healthcheck/sqs", () => {
    it("GET healthcheck/sqs should respond 200 OK", (done: Mocha.Done) => {
      axios.get(integrationUrl + "/healthcheck/sqs").then((res: Response) => {
        expect(res.status).to.equal(200);
        const data = res.data;
        expect(data, "data").to.not.equal(undefined);
        expect(data?.s3, "data.s3").to.equal(undefined);
        expect(data?.sqs, "data.sqs").to.equal(true);
        expect(data?.failHealthCheck, "data.failHealthCheck").to.equal(false);
        expect(typeof data?.lastS3Access, "typeof data.lastS3Access").to.equal("string");
        expect(typeof data?.lastSQSAccess, "typeof data.lastSQSAccess").to.equal("string");
        expect(typeof data?.ipAddress, "typeof data.ipAddress").to.equal("string");
        expect(typeof data?.hostname, "typeof data.hostname").to.equal("string");
        expect(typeof data?.instanceId, "typeof data.instanceId").to.equal("string");
        done();
      }).catch((error) => done(error));
    });
  });
});
