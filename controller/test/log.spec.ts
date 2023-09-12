import { LogLevel, log } from "../pages/api/util/log";
import { expect } from "chai";

describe("Log", () => {
  describe("Testing Log Levels", () => {
    it("Should log at DEBUG", (done: Mocha.Done) => {
      log("LogLevel.DEBUG", LogLevel.DEBUG);
      done();
    });

    it("Should log at INFO", (done: Mocha.Done) => {
      log("LogLevel.INFO", LogLevel.INFO);
      done();
    });

    it("Should log at WARN", (done: Mocha.Done) => {
      log("LogLevel.WARN", LogLevel.WARN);
      done();
    });

    it("Should log at ERROR", (done: Mocha.Done) => {
      log("LogLevel.ERROR", LogLevel.ERROR);
      done();
    });
  });

  describe("Testing Log Object", () => {
    it("Should not log data if there's only a testId", (done: Mocha.Done) => {
      const origObject = { testId: "onlytestId" };
      log("Only testId", LogLevel.INFO, origObject);
      expect(origObject.testId).to.equal("onlytestId");
      done();
    });

    it("Should not log data if there's only a yamlFile", (done: Mocha.Done) => {
      const origObject = { yamlFile: "onlyyamlFile" };
      log("Only yamlFile", LogLevel.INFO, origObject);
      expect(origObject.yamlFile).to.equal("onlyyamlFile");
      done();
    });

    it("Should not log data if there's only a testId and yamlFile", (done: Mocha.Done) => {
      log("TestId and YamlFile", LogLevel.INFO, { testId: "testId", yamlFile: "yamlFile" });
      done();
    });

    it("Should log data if there's a testId", (done: Mocha.Done) => {
      log("TestId and More", LogLevel.INFO, { testId: "testId", yamlFile: "yamlFile", other: "other", more: "more" });
      done();
    });

    it("Should log string data", (done: Mocha.Done) => {
      log("string data", LogLevel.INFO, "string data");
      done();
    });

    it("Should log error", (done: Mocha.Done) => {
      log("Only error", LogLevel.INFO, new Error("error"));
      done();
    });

    it("Should log Map", (done: Mocha.Done) => {
      const map = new Map<string, string>([["key1", "value1"],["key2","value2"],["key3","value3"]]);
      log("Only Map", LogLevel.INFO, map);
      done();
    });

    it("Should log string data and error", (done: Mocha.Done) => {
      log("string data and error", LogLevel.INFO, "string data", new Error("error"));
      done();
    });

    it("Should log string data and testId object", (done: Mocha.Done) => {
      log("string data and object", LogLevel.INFO, "string data", { testId: "testId", yamlFile: "yamlFile", other: "other", more: "more" });
      done();
    });

    it("Should log string data, error, and testId object", (done: Mocha.Done) => {
      log("string data, error, and object", LogLevel.INFO, "string data", new Error("error"), { testId: "testId", yamlFile: "yamlFile", other: "other", more: "more" });
      done();
    });

    it("Should log string data, error, map, and testId object", (done: Mocha.Done) => {
      const map = new Map<string, string>([["key1", "value1"],["key2","value2"],["key3","value3"]]);
      log("string data, error, Map, and object", LogLevel.INFO, "string data", new Error("error"), map, { testId: "testId", yamlFile: "yamlFile", other: "other", more: "more" });
      done();
    });
  });
});
