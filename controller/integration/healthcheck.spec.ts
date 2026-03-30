import { s3, sqs } from "@fs/ppaas-common";
import { expect } from "chai";
import { getGlobalHealthcheckConfig } from "../src/healthcheck";

describe("Healthcheck Integration", () => {
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

  it("Pinging sqs should succeed and update config on success", (done: Mocha.Done) => {
    const dateBefore: Date = new Date(0);
    getGlobalHealthcheckConfig().lastSQSAccess = dateBefore;
    sqs.healthCheck().then((result) => {
      expect(result).to.equal(true);
      expect(getGlobalHealthcheckConfig().lastSQSAccess.getTime()).to.greaterThan(dateBefore.getTime());
      done();
    })
    .catch((error) => {
      done(error);
    });
  });
});
