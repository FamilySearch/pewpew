import {
  LogLevel,
  log
} from "@fs/ppaas-common";
import {
  publicRuntimeConfig as clientPublicRuntimeConfig,
  formatAssetHref,
  formatError,
  formatPageHref,
  getBasePath,
  getMaxVersion,
  latestPewPewVersion,
  versionSort
} from "../src/clientutil";
import { expect } from "chai";

describe("Client Utils", () => {
  const publicRuntimeConfig: Record<string, string | undefined> = clientPublicRuntimeConfig;
  let savedBasePath: string | undefined;
  let savedAssetPrefix: string | undefined;

  before(() => {
    // Save off the publicRuntimeConfig
    savedBasePath = publicRuntimeConfig.BASE_PATH;
    savedAssetPrefix = publicRuntimeConfig.ASSET_PREFIX;
  });

  after(() => {
    delete publicRuntimeConfig.BASE_PATH;
    delete publicRuntimeConfig.ASSET_PREFIX;
    // Restore publicRuntimeConfig
    if (savedBasePath !== undefined) { publicRuntimeConfig.BASE_PATH = savedBasePath; }
    if (savedAssetPrefix !== undefined) { publicRuntimeConfig.ASSET_PREFIX = savedAssetPrefix; }
  });

  describe("versionSort", () => {
    it("array.sort(versionSort) should sort empty", (done: Mocha.Done) => {
      const actual: string[] = [];
      const expected: string[] = [];
      try {
        actual.sort(versionSort);
        expect(JSON.stringify(actual)).to.equal(JSON.stringify(expected));
        done();
      } catch (error) {
        log("versionSort error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("array.sort(versionSort) should sort latest only", (done: Mocha.Done) => {
      const actual: string[] = [latestPewPewVersion];
      const expected: string[] = [latestPewPewVersion];
      try {
        actual.sort(versionSort);
        expect(JSON.stringify(actual)).to.equal(JSON.stringify(expected));
        done();
      } catch (error) {
        log("versionSort error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("array.sort(versionSort) should sort latest first", (done: Mocha.Done) => {
      const actual: string[] = ["0.5.10", latestPewPewVersion];
      const expected: string[] = [latestPewPewVersion, "0.5.10"];
      try {
        actual.sort(versionSort);
        expect(JSON.stringify(actual)).to.equal(JSON.stringify(expected));
        done();
      } catch (error) {
        log("versionSort error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("array.sort(versionSort) should sort latest first large", (done: Mocha.Done) => {
      const actual: string[] = [
        "0.5.1",
        "0.5.0",
        "0.5.2",
        "0.5.10",
        "0.5.4",
        "0.5.3",
        "0.4.0",
        "0.5.5-preview1",
        "0.5.5",
        "invalid3",
        "0.5.6",
        latestPewPewVersion,
        "0.5.7",
        "0.9.3",
        "invalid",
        "0.6.0",
        "0.5.10-preview1",
        "0.5.10-unique",
        "invalid2",
        "0.5.10-preview2",
        "0.5.10-preview3",
        "0.5.8",
        "0.4.9"
      ];
      // Latest should be first followed by newest versions (so reverse at the end)
      const expected: string[] = [
        "invalid3",
        "invalid2",
        "invalid",
        "0.4.0",
        "0.4.9",
        "0.5.0",
        "0.5.1",
        "0.5.2",
        "0.5.3",
        "0.5.4",
        "0.5.5-preview1",
        "0.5.5",
        "0.5.6",
        "0.5.7",
        "0.5.8",
        "0.5.10-preview1",
        "0.5.10-preview2",
        "0.5.10-preview3",
        "0.5.10-unique",
        "0.5.10",
        "0.6.0",
        "0.9.3",
        latestPewPewVersion
      ].reverse();
      try {
        actual.sort(versionSort);
        expect(JSON.stringify(actual)).to.equal(JSON.stringify(expected));
        done();
      } catch (error) {
        log("versionSort error", LogLevel.ERROR, error);
        done(error);
      }
    });
  });

  describe("getMaxVersion", () => {
    const maxVersion = "0.1.3";
    const versionList: string [] = [
      "0.1.1",
      "0.1.0",
      maxVersion,
      "0.1.4-preview1", // Will be sorted newer than maxVersion, but should be excluded
      "0.1.4-scripting", // Will be sorted newer than maxVersion, but should be excluded
      latestPewPewVersion,
      "0.1.2"
    ];

    it("Should return latest on empty", (done: Mocha.Done) => {
      const testArray: string[] = [];
      try {
        const result: string = getMaxVersion(testArray);
        log("getMaxVersion result: " + result, LogLevel.DEBUG, testArray);
        expect(result).to.equal(latestPewPewVersion);
        done();
      } catch (error) {
        log("getMaxVersion error", LogLevel.ERROR, testArray, error);
        done(error);
      }
    });

    it("Should return latest on empty string", (done: Mocha.Done) => {
      const testArray: string[] = [""];
      try {
        const result: string = getMaxVersion(testArray);
        log("getMaxVersion result: " + result, LogLevel.DEBUG, testArray);
        expect(result).to.equal(latestPewPewVersion);
        done();
      } catch (error) {
        log("getMaxVersion error", LogLevel.ERROR, testArray, error);
        done(error);
      }
    });

    it("Should return latest on only latest", (done: Mocha.Done) => {
      const testArray: string[] = [latestPewPewVersion];
      try {
        const result: string = getMaxVersion(testArray);
        log("getMaxVersion result: " + result, LogLevel.DEBUG, testArray);
        expect(result).to.equal(latestPewPewVersion);
        done();
      } catch (error) {
        log("getMaxVersion error", LogLevel.ERROR, testArray, error);
        done(error);
      }
    });

    it("Should return correct maxVersion", (done: Mocha.Done) => {
      const testArray: string[] = versionList;
      try {
        const result: string = getMaxVersion(testArray);
        log("getMaxVersion result: " + result, LogLevel.DEBUG, testArray);
        expect(result).to.equal(maxVersion);
        done();
      } catch (error) {
        log("getMaxVersion error", LogLevel.ERROR, testArray, error);
        done(error);
      }
    });

    it("Should return correct maxVersion reversed", (done: Mocha.Done) => {
      const testArray: string[] = versionList.reverse();
      try {
        const result: string = getMaxVersion(testArray);
        log("getMaxVersion result: " + result, LogLevel.DEBUG, testArray);
        expect(result).to.equal(maxVersion);
        done();
      } catch (error) {
        log("getMaxVersion error", LogLevel.ERROR, testArray, error);
        done(error);
      }
    });
  });

  describe("getBasePath", () => {
    beforeEach(() => delete publicRuntimeConfig.BASE_PATH);

    it("should handle undefined", (done: Mocha.Done) => {
      delete publicRuntimeConfig.BASE_PATH;
      const basePath = getBasePath();
      expect(basePath).to.equal("");
      done();
    });

    it("should handle empty string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "";
      const basePath = getBasePath();
      expect(basePath).to.equal("");
      done();
    });

    it("should handle base path", (done: Mocha.Done) => {
      const expected = "/pewpew/unittest";
      publicRuntimeConfig.BASE_PATH = expected;
      const basePath = getBasePath();
      expect(basePath).to.equal(expected);
      done();
    });

    it("should handle long strings", (done: Mocha.Done) => {
      const expected = "/kjsdklfjaskdlfjsdklfajsdkfljsdkfljsdfksdjafklsadjfksadjfksadljfkas/skljdfksdajfdkslajfksdljfkljafkdsljaskdlfjskldfjasdklfjsakdlfjslkdfjaskdlfjsdlfjka/jklsdfjkasldjfksdljafklsadjfklsdjfksldajfklsajdfklsjdfklsdjfklsajf/jaskdfljsdalkjfksladjfsdklajfsa";
      publicRuntimeConfig.BASE_PATH = expected;
      const basePath = getBasePath();
      expect(basePath).to.equal(expected);
      done();
    });
  });

  describe("formatAssetHref", () => {
    beforeEach(() => {
      delete publicRuntimeConfig.BASE_PATH;
      delete publicRuntimeConfig.ASSET_PREFIX;
    });

    it("should handle empty BASE_PATH string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "";
      const path = "/bogus";
      const expected = path;
      const actual = formatAssetHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle empty ASSET_PREFIX string", (done: Mocha.Done) => {
      publicRuntimeConfig.ASSET_PREFIX = "";
      const path = "/bogus";
      const expected = path;
      const actual = formatAssetHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle BASE_PATH string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "/bogus";
      const expected = publicRuntimeConfig.BASE_PATH + path;
      const actual = formatAssetHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle ASSET_PREFIX string", (done: Mocha.Done) => {
      publicRuntimeConfig.ASSET_PREFIX = "/pewpew/unittest";
      const path = "/bogus";
      const expected = publicRuntimeConfig.ASSET_PREFIX + path;
      const actual = formatAssetHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should override BASE_PATH with ASSET_PREFIX", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/wrong/path";
      publicRuntimeConfig.ASSET_PREFIX = "/pewpew/unittest";
      const path = "/bogus";
      const expected = publicRuntimeConfig.ASSET_PREFIX + path;
      const actual = formatAssetHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle long strings", (done: Mocha.Done) => {
      publicRuntimeConfig.ASSET_PREFIX = "/kjsdklfjaskdlfjsdklfajsdkfljsdkfljsdfksdjafklsadjfksadjfksadljfkas/skljdfksdajfdkslajfksdljfkljafkdsljaskdlfjskldfjasdklfjsakdlfjslkdfjaskdlfjsdlfjka/jklsdfjkasldjfksdljafklsadjfklsdjfksldajfklsajdfklsjdfklsdjfklsajf/jaskdfljsdalkjfksladjfsdklajfsa";
      const path = "/bogus";
      const expected = publicRuntimeConfig.ASSET_PREFIX + path;
      const actual = formatAssetHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });
  });

  describe("formatPageHref", () => {
    beforeEach(() => {
      delete publicRuntimeConfig.BASE_PATH;
    });

    it("should handle undefined BASE_PATH string", (done: Mocha.Done) => {
      delete publicRuntimeConfig.BASE_PATH;
      const path = "/bogus";
      const expected = path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle empty BASE_PATH string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "";
      const path = "/bogus";
      const expected = path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle BASE_PATH string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "/bogus";
      const expected = publicRuntimeConfig.BASE_PATH + path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle empty path string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "";
      const expected = publicRuntimeConfig.BASE_PATH + path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle slash only path string", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "/";
      const expected = publicRuntimeConfig.BASE_PATH + path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should not add BASE_PATH if path is http://", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "http://bogus.com/";
      const expected = path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should not add BASE_PATH if path is https://", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "https://bogus.com/";
      const expected = path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should not add BASE_PATH if path has it", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = publicRuntimeConfig.BASE_PATH + "/bogus";
      const expected = path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should not add BASE_PATH if path has it without the slash", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "pewpew/unittest/bogus/";
      const expected = path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should add BASE_PATH without the slash if path has it without the slash", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/pewpew/unittest";
      const path = "bogus/";
      const expected = "pewpew/unittest/bogus/";
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });

    it("should handle long strings", (done: Mocha.Done) => {
      publicRuntimeConfig.BASE_PATH = "/kjsdklfjaskdlfjsdklfajsdkfljsdkfljsdfksdjafklsadjfksadjfksadljfkas/skljdfksdajfdkslajfksdljfkljafkdsljaskdlfjskldfjasdklfjsakdlfjslkdfjaskdlfjsdlfjka/jklsdfjkasldjfksdljafklsadjfklsdjfksldajfklsajdfklsjdfklsdjfklsajf/jaskdfljsdalkjfksladjfsdklajfsa";
      const path = "/bogus";
      const expected = publicRuntimeConfig.BASE_PATH + path;
      const actual = formatPageHref(path);
      expect(actual, "actual").to.equal(expected);
      done();
    });
  });

  describe("formatError", () => {
    it("should handle empty string", (done: Mocha.Done) => {
      const error = "";
      const errorMessage: string = formatError(error);
      expect(errorMessage).to.equal("");
      done();
    });

    it("should handle error string", (done: Mocha.Done) => {
      const error = "test error";
      const errorMessage: string = formatError(error);
      expect(errorMessage).to.equal(error);
      done();
    });

    it("should handle Error object", (done: Mocha.Done) => {
      const error = new Error("test error");
      const errorMessage: string = formatError(error);
      expect(errorMessage).to.equal(error.message);
      done();
    });

    it("should handle error.msg", (done: Mocha.Done) => {
      const error = { msg: "test error" };
      const errorMessage: string = formatError(error);
      expect(errorMessage).to.equal(error.msg);
      done();
    });

    it("should handle object", (done: Mocha.Done) => {
      const error = { other: "stuff" };
      const errorMessage: string = formatError(error);
      expect(errorMessage).to.equal("[object Object]");
      done();
    });
  });
});
