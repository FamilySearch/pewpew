import { S3_ALLOWED_LAST_ACCESS_MS, SQS_ALLOWED_LAST_ACCESS_MS, accessS3Pass, accessSqsPass } from "../src/healthcheck";
import { expect } from "chai";
import { logger } from "@fs/ppaas-common";

logger.config.LogFileName = "ppaas-agent";

describe("Healthcheck", () => {
  describe("S3 Healthcheck should check last s3 access", () => {
    it("Should pass if we have a recent access", (done: Mocha.Done) => {
      expect(accessS3Pass(new Date(Date.now() - S3_ALLOWED_LAST_ACCESS_MS + 10000))).to.equal(true);
      done();
    });
  });

  describe("S3 Healthcheck should check last s3 access", () => {
    it("Should fail if we don't have a recent access", (done: Mocha.Done) => {
      expect(accessS3Pass(new Date(Date.now() - S3_ALLOWED_LAST_ACCESS_MS - 10000))).to.equal(false);
      done();
    });
  });

  describe("SQS Healthcheck should check last sqs access", () => {
    it("Should pass if we have a recent access", (done: Mocha.Done) => {
      expect(accessSqsPass(new Date(Date.now() - SQS_ALLOWED_LAST_ACCESS_MS + 10000))).to.equal(true);
      done();
    });
  });

  describe("SQS Healthcheck should check last sqs access", () => {
    it("Should fail if we don't have a recent access", (done: Mocha.Done) => {
      expect(accessSqsPass(new Date(Date.now() - SQS_ALLOWED_LAST_ACCESS_MS - 10000))).to.equal(false);
      done();
    });
  });
});
