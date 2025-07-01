import { expect } from "chai";
import { util } from "../src/index.js";

const {
  CONTROLLER_ENV,
  CONTROLLER_APPLICATION_PREFIX,
  PREFIX_DEFAULT,
  createStatsFileName,
  getLocalIpAddress,
  getPrefix,
  poll,
  sleep
} = util;

describe("Util", () => {
  describe("getPrefix", () => {
    it("Should default to the agent", (done: Mocha.Done) => {
      const prefix: string = getPrefix(undefined);
      expect(prefix).to.equal(PREFIX_DEFAULT);
      done();
    });

    it("Should override to the controller", (done: Mocha.Done) => {
      const prefix: string = getPrefix(true);
      expect(prefix).to.equal(CONTROLLER_ENV ? `${CONTROLLER_APPLICATION_PREFIX}${CONTROLLER_ENV.toUpperCase()}` : PREFIX_DEFAULT);
      done();
    });

    it("Should override to the controller", (done: Mocha.Done) => {
      const controllerEnv = "override";
      const prefix: string = getPrefix(controllerEnv);
      expect(prefix).to.equal(CONTROLLER_APPLICATION_PREFIX + controllerEnv.toUpperCase());
      done();
    });
  });

  describe("createStatsFileName", () => {
    it("should have the testId in the name", (done: Mocha.Done) => {
      const testId: string = "unittest";
      const filename: string = createStatsFileName(testId);
      expect(filename).to.include("stats");
      expect(filename).to.include(testId);
      done();
    });

    it("should have the iteration in the name", (done: Mocha.Done) => {
      const testId: string = "unittest";
      const filename: string = createStatsFileName(testId, 5000);
      expect(filename).to.include("stats");
      expect(filename).to.include(testId);
      expect(filename).to.include("5000");
      done();
    });
  });

  describe("getLocalIpAddress", () => {
    it("should be an ipv4 address", (done: Mocha.Done) => {
      const ipmatch: RegExp = /^\d+\.\d+\.\d+\.\d+$/;
      const ipaddress: string = getLocalIpAddress();
      expect(ipmatch.test(ipaddress), ipaddress + " is ipv4").to.equal(true);
      done();
    });

    if (!process.env.TRAVIS) {
      it("should be an ipv6 address", (done: Mocha.Done) => {
        // eslint-disable-next-line no-useless-escape
        const ipmatch: RegExp = /^[a-z0-9]+\:\:[a-z0-9]+\:[a-z0-9]+\:[a-z0-9]+\:/;
        const ipaddress: string = getLocalIpAddress(6);
        expect(ipmatch.test(ipaddress), ipaddress + " is ipv6").to.equal(true);
        done();
      });
    }

    it("should be a hostname address", (done: Mocha.Done) => {
      const ipmatch: RegExp = /^\d+\.\d+\.\d+\.\d+$/;
      const ipaddress: string = getLocalIpAddress(2 as any);
      expect(ipmatch.test(ipaddress), ipaddress + " is not ipv4").to.equal(false);
      expect(/\w/.test(ipaddress), ipaddress + " has a letter").to.equal(true);
      done();
    });
  });

  describe("poll", () => {
    it("should poll until finished", (done: Mocha.Done) => {
      const timeBefore: number = Date.now();
      let counter: number = 0;
      // eslint-disable-next-line require-await
      poll(async (): Promise<boolean> => ++counter > 1, 300, (errMsg: string) => errMsg).then((result: boolean) => {
        const timeAfter: number = Date.now();
        expect(counter).to.equal(2);
        expect(result).to.equal(true);
        expect(timeAfter - timeBefore).to.be.lessThan(300);
        done();
      }).catch((error) => done(error));
    });

    it("should poll until timeout", (done: Mocha.Done) => {
      const timeBefore: number = Date.now();
      let counter: number = 0;
      // eslint-disable-next-line require-await
      poll(async (): Promise<boolean> => ++counter > 10, 300, (errMsg: string) => errMsg).then((_result: boolean) => {
        done(new Error("Should have timed out"));
      }).catch((error) => {
        const timeAfter: number = Date.now();
        try {
          expect(counter).to.equal(3);
          expect(`${error}`).to.equal("Error: Promise timed out after 300ms.");
          expect(timeAfter - timeBefore).to.be.greaterThan(298);
          expect(timeAfter - timeBefore).to.be.lessThan(400);
          done();
        } catch (error2) {
          done(error2);
        }
      });
    });
  });

  describe("sleep", () => {
    it("should sleep for 100ms", (done: Mocha.Done) => {
      const startTime: number = Date.now();
      sleep(100).then(() => {
        const endTime: number = Date.now();
        expect(endTime - startTime).to.be.greaterThan(98);
        expect(endTime - startTime).to.be.lessThan(150);
        done();
      }).catch((error) => done(error));
    });

    it("should sleep for 300ms", (done: Mocha.Done) => {
      const startTime: number = Date.now();
      sleep(300).then(() => {
        const endTime: number = Date.now();
        expect(endTime - startTime).to.be.greaterThan(298);
        expect(endTime - startTime).to.be.lessThan(350);
        done();
      }).catch((error) => done(error));
    });
  });
});
