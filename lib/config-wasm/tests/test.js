const { expect } = require("chai");
const { Config } = require("../pkg/config_wasm");
const { readFile: _readFile } = require("fs");
const { join: joinPath } = require("path");
const { promisify } = require("util");

const  readFile = promisify(_readFile);
const yamlPath = "../../../tests";
const integrationYaml = "integration.yaml";
const onDemandYaml = "int_on_demand.yaml";

describe("config-wasm", () => {
  let config;
  let integrationFile;
  let onDemandFile;
  const varMap = new Map();

  before(async () => {
    try {
      integrationFile = await readFile(joinPath(yamlPath, integrationYaml));
      onDemandFile = await readFile(joinPath(yamlPath, onDemandYaml));
    } catch (error) {
      console.error("before error", error);
      throw error;
    }
  });

  afterEach(() => {
    varMap.clear();
    if (config) {
      config.free();
    }
    config = undefined;
  });

  // The ERROR tests must be first. Once it's initialized, the log setup doesn't fire
  it("should throw error on invalid log_level", (done) => {
    try {
      config = new Config(integrationFile, varMap, "bogus");
      done(new Error("bogus should have failed"));
    } catch (error) {
      expect(`${error}`).to.include("attempted to convert a string that doesn't match an existing log level");
      done();
    }
  });

  // Once we've set the logs once, we can never change it
  it("should change log_level to warn", (done) => {
    try {
      varMap.set("PORT","8081");
      config = new Config(integrationFile, varMap, "warn");
      expect(config).to.not.equal(undefined);
      config.checkOk();
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });

  // Once we've set the logs once, we can never change it
  it("should not require a log level", (done) => {
    try {
      varMap.set("PORT","8081");
      config = new Config(integrationFile, varMap);
      expect(config).to.not.equal(undefined);
      config.checkOk();
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });

  it(integrationYaml + " should require variables", (done) => {
    try {
      config = new Config(integrationFile, varMap);
      done(new Error(integrationYaml + " should require variables"));
    } catch (error) {
      expect(`${error}`).to.include("MissingEnvironmentVariable(\"PORT\"");
      done();
    }
  });

  it(integrationYaml + " should pass with variables", (done) => {
    try {
      varMap.set("PORT","8081");
      config = new Config(integrationFile, varMap);
      expect(config).to.not.equal(undefined);
      config.checkOk();
      expect(config.getBucketSize(), "getBucketSize").to.not.equal(undefined);
      expect(config.getBucketSize().toString(), "getBucketSize").to.equal("60");
      expect(config.getDuration(), "getDuration").to.not.equal(undefined);
      expect(config.getDuration().toString(), "getDuration").to.equal("5");
      expect(config.getInputFiles(), "getInputFiles").to.not.equal(undefined);
      expect(config.getInputFiles().length, "getInputFiles.length").to.equal(1);
      expect(config.getInputFiles()[0], "getInputFiles[0]").to.equal("integration.data");
      expect(config.getLoggerFiles(), "getLoggerFiles").to.not.equal(undefined);
      expect(config.getLoggerFiles().length, "getLoggerFiles.length").to.equal(2);
      expect(config.getLoggerFiles()[0], "getLoggerFiles[0]").to.equal("stderr");
      expect(config.getLoggerFiles()[1], "getLoggerFiles[1]").to.include("test-");
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });

  it(onDemandYaml + " should pass with variables", (done) => {
    try {
      varMap.set("PORT","8081");
      config = new Config(onDemandFile, varMap);
      expect(config).to.not.equal(undefined);
      config.checkOk();
      expect(config.getBucketSize(), "getBucketSize").to.not.equal(undefined);
      expect(config.getBucketSize().toString(), "getBucketSize").to.equal("60");
      expect(config.getDuration(), "getDuration").to.not.equal(undefined);
      expect(config.getDuration().toString(), "getDuration").to.equal("5");
      expect(config.getInputFiles(), "getInputFiles").to.not.equal(undefined);
      expect(config.getInputFiles().length, "getInputFiles.length").to.equal(0);
      expect(config.getLoggerFiles(), "getLoggerFiles").to.not.equal(undefined);
      expect(config.getLoggerFiles().length, "getLoggerFiles.length").to.equal(1);
      expect(config.getLoggerFiles()[0], "getLoggerFiles[0]").to.equal("stderr");
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });
});
