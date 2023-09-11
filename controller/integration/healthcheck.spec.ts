import { getGlobalHealthcheckConfig, pingS3 } from "../pages/api/util/healthcheck";
import { expect } from "chai";
import { logger } from "@fs/ppaas-common";

logger.config.LogFileName = "ppaas-controller";

describe("Healthcheck Integration", () => {
  it("Pinging s3 should succeed and update config on success", (done: Mocha.Done) => {
    const dateBefore: Date = new Date(0);
    getGlobalHealthcheckConfig().lastS3Access = dateBefore;
    pingS3().then((result) => {
      expect(result).to.equal(true);
      expect(getGlobalHealthcheckConfig().lastS3Access.getTime()).to.greaterThan(dateBefore.getTime());
      done();
    })
    .catch((error) => {
      done(error);
    });
  });
});
