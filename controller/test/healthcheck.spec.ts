import {
  S3_ALLOWED_LAST_ACCESS_MS,
  SQS_ALLOWED_LAST_ACCESS_MS,
  accessS3Pass,
  accessSqsPass,
  getGlobalHealthcheckConfig
} from "../src/healthcheck";
import { mockListObjects, mockS3, resetMockS3 } from "./mock";
import { expect } from "chai";
import { s3 } from "@fs/ppaas-common";

describe("Healthcheck", () => {
  before(() => {
    mockS3();
    mockListObjects([]);
  });

  after(() => {
    resetMockS3();
  });

  it("S3 Healthcheck should pass if we have a recent access", (done: Mocha.Done) => {
    expect(accessS3Pass(new Date(Date.now() - S3_ALLOWED_LAST_ACCESS_MS + 10000))).to.equal(true);
    done();
  });

  it("S3 Healthcheck should fail if we don't have a recent access", (done: Mocha.Done) => {
    expect(accessS3Pass(new Date(Date.now() - S3_ALLOWED_LAST_ACCESS_MS - 10000))).to.equal(false);
    done();
  });

  it("SQS Healthcheck should pass if we have a recent access", (done: Mocha.Done) => {
    expect(accessSqsPass(new Date(Date.now() - SQS_ALLOWED_LAST_ACCESS_MS + 10000))).to.equal(true);
    done();
  });

  it("SQS Healthcheck should fail if we don't have a recent access", (done: Mocha.Done) => {
    expect(accessSqsPass(new Date(Date.now() - SQS_ALLOWED_LAST_ACCESS_MS - 10000))).to.equal(false);
    done();
  });

  it("Pinging s3 should succeed and update config on success", (done: Mocha.Done) => {
    const dateBefore: Date = new Date(0);
    getGlobalHealthcheckConfig().lastS3Access = dateBefore;
    s3.healthCheck().then((result) => {
      expect(result).to.equal(true);
      expect(getGlobalHealthcheckConfig().lastS3Access.getTime()).to.greaterThan(dateBefore.getTime());
      done();
    })
    .catch((error) => {
      done(error);
    });
  });
});
