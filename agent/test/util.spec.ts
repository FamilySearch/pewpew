import { LogLevel, log, logger, util } from "@fs/ppaas-common";
import { expect } from "chai";
import { getHostname } from "../src/util/util";

logger.config.LogFileName = "ppaas-agent";

describe("Util", () => {
  let ipAddress: string | undefined;

  describe("getLocalIpAddress", () => {
    it("getLocalIpAddress should retrieve an ipaddress", (done: Mocha.Done) => {
      ipAddress = util.getLocalIpAddress();
      log("ipAddress = " + ipAddress, LogLevel.DEBUG);
      expect(ipAddress).to.not.equal(undefined);
      expect(/\d+\.\d+\.\d+\.\d+/.test(ipAddress), ipAddress).to.equal(true);
      done();
    });
  });

  describe("getHostName", () => {
    it("getHostName should create the hostname from the Ip", (done: Mocha.Done) => {
      if (ipAddress) {
        const hostname = getHostname();
        log("hostname = " + hostname, LogLevel.DEBUG);
        expect(/\w+-\w+-app-\d+-\d+-\d+/.test(hostname), hostname).to.equal(true);
        done();
      } else {
        done(new Error("ipAddress was not set"));
      }
    });
  });
});
