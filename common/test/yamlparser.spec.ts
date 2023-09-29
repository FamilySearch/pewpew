import { YamlParser } from "../src/index";
import { expect } from "chai";
import path from "path";

const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BAD_FILEPATH = path.join(UNIT_TEST_FOLDER, "s3test.txt");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const EMPTY_FILEPATH = path.join(UNIT_TEST_FOLDER, "empty.yaml");
const BASIC_FILEPATH = path.join(UNIT_TEST_FOLDER, "basic.yaml");
const BASIC_FILEPATH_WITH_VARS = path.join(UNIT_TEST_FOLDER, "basicwithvars.yaml");
const BASIC_FILEPATH_WITH_ENV = path.join(UNIT_TEST_FOLDER, "basicwithenv.yaml");
const BASIC_FILEPATH_WITH_FILES = path.join(UNIT_TEST_FOLDER, "basicwithfiles.yaml");
const BASIC_FILEPATH_NO_PEAK_LOAD = path.join(UNIT_TEST_FOLDER, "basicnopeakload.yaml");
const BASIC_FILEPATH_HEADERS_ALL = path.join(UNIT_TEST_FOLDER, "basicnopeakload.yaml");

describe("YamlParser", () => {
  describe("parseYamlFile should throw on non-existant files", () => {
    it("doesnotexist.yaml should not exist", (done: Mocha.Done) => {
      YamlParser.parseYamlFile("doesnotexist.yaml", {})
      .then((_yamlParser: YamlParser) => done(new Error("This file Should not exist")))
      .catch((error) => {
        expect(error).to.not.equal(undefined);
        expect(error.code, JSON.stringify(error)).to.equal("ENOENT");
        done();
      });
    });
  });

  describe("parseYamlFile should throw on invalid files", () => {
    it(BAD_FILEPATH + " should throw", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BAD_FILEPATH, {})
      .then((_yamlParser: YamlParser) => done(new Error("This should not parse")))
      .catch((error) => {
        try {
        expect(`${error}`).to.include("UnrecognizedKey");
        } catch (err) {
          done(err);
          return;
        }
        done();
      });
    });

    it(EMPTY_FILEPATH + " should be invalid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(EMPTY_FILEPATH, {})
      .then((_yamlParser: YamlParser) => done(new Error("This should not parse")))
      .catch((error) => {
        try {
        expect(`${error}`).to.include("YamlDeserialize");
        } catch (err) {
          done(err);
          return;
        }
        done();
      });
    });

    it(BASIC_FILEPATH_WITH_ENV + " should be invalid without our env variable", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_WITH_ENV, {})
      .then((_yamlParser: YamlParser) => done(new Error("This should not parse")))
      .catch((error) => {
        try {
        expect(`${error}`).to.include("missingEnvironmentVariables=SERVICE_URL_AGENT,TEST");
        } catch (err) {
          done(err);
          return;
        }
        done();
      });
    });
  });

  describe("parseYamlFile should parse valid files", () => {
    it(BASIC_FILEPATH + " should be valid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH, {})
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH_WITH_VARS + " should be valid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_WITH_VARS, {})
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH + " should be valid with extra variables", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH, { NOT_NEEDED: "true", ALSO_NOT_NEEDED: "false" })
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH_WITH_ENV + " should be valid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_WITH_ENV, { SERVICE_URL_AGENT: "127.0.0.1", TEST: "true" })
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH_WITH_ENV + " should be valid with extra variables", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_WITH_ENV, { SERVICE_URL_AGENT: "127.0.0.1", TEST: "true", NOT_NEEDED: "true", ALSO_NOT_NEEDED: "false" })
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH_WITH_FILES + " should be valid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_WITH_FILES, { SPLUNK_PATH: UNIT_TEST_FOLDER })
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(1);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(2);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH_NO_PEAK_LOAD + " should be valid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_NO_PEAK_LOAD, {})
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });

    it(BASIC_FILEPATH_HEADERS_ALL + " should be valid", (done: Mocha.Done) => {
      YamlParser.parseYamlFile(BASIC_FILEPATH_HEADERS_ALL, {})
      .then((yamlParser: YamlParser) => {
        expect(yamlParser).to.not.equal(undefined);
        expect(yamlParser.getBucketSizeMs(), "getBucketSizeMs").to.equal(60000);
        expect(yamlParser.getTestRunTimeMn(), "getTestRunTimeMn").to.equal(2);
        expect(yamlParser.getInputFileNames().length, "getInputFileNames().length").to.equal(0);
        expect(yamlParser.getLoggerFileNames().length, "getLoggerFileNames().length").to.equal(0);
        done();
      })
      .catch((error) => done(error));
    });
  });
});
