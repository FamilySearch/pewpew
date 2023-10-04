import { AuthPermission, AuthPermissions, ErrorResponse, PewPewVersionsResponse, TestManagerError } from "../types";
import type { File, Files } from "formidable";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { ParsedForm, createFormidableFile, unzipFile } from "../pages/api/util/util";
import { deletePewPew, getPewPewVersionsInS3, getPewpew, postPewPew } from "../pages/api/util/pewpew";
import { expect } from "chai";
import { latestPewPewVersion } from "../pages/api/util/clientutil";
import path from "path";
import semver from "semver";
import { waitForSecrets } from "../pages/api/util/secrets";

logger.config.LogFileName = "ppaas-controller";

const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
const PEWPEW_LEGACY_FILEPATH = path.join(UNIT_TEST_FOLDER, "pewpew.zip");
const PEWPEW_SCRIPTING_FILEPATH = path.join(UNIT_TEST_FOLDER, "scripting/pewpew.zip");

const authAdmin: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1"
};

let sharedPewPewVersions: string[] | undefined;
let uploadedPewPewVersion: string | undefined; // Used for delete

describe("PewPew Util Integration", () => {
  let filesLegacyPewpew: Files = {};
  let filesScriptingPewpew: Files = {};

  before(async () => {
    // Legacy Pewpew binary
    const legacyPewpewZipFile: File = createFormidableFile(
      path.basename(PEWPEW_LEGACY_FILEPATH),
      PEWPEW_LEGACY_FILEPATH,
      "unittest",
      1,
      null
    );
    try {
      const filename: string = legacyPewpewZipFile.originalFilename!;
      const unzippedFiles: File[] = await unzipFile(legacyPewpewZipFile);
      log("unzipped " + filename, LogLevel.DEBUG, unzippedFiles);
      filesLegacyPewpew = {
        additionalFiles: unzippedFiles as any as File
      };
      log("legacy files " + filename, LogLevel.DEBUG, filesLegacyPewpew);
    } catch (error) {
      log("Error unzipping " + legacyPewpewZipFile.originalFilename, LogLevel.ERROR, error);
      throw error;
    }

    // Scripting Pewpew binary
    const scriptingPewpewZipFile: File = createFormidableFile(
      path.basename(PEWPEW_SCRIPTING_FILEPATH),
      PEWPEW_SCRIPTING_FILEPATH,
      "unittest",
      1,
      null
    );
    try {
      const filename: string = scriptingPewpewZipFile.originalFilename!;
      const unzippedFiles: File[] = await unzipFile(scriptingPewpewZipFile);
      log("unzipped " + filename, LogLevel.DEBUG, unzippedFiles);
      filesScriptingPewpew = {
        additionalFiles: unzippedFiles as any as File
      };
      log("scripting files " + filename, LogLevel.DEBUG, filesScriptingPewpew);
    } catch (error) {
      log("Error unzipping " + scriptingPewpewZipFile.originalFilename, LogLevel.ERROR, error);
      throw error;
    }

    await waitForSecrets();
  });

  describe("getPewPewVersionsInS3", () => {
    it("getPewPewVersionsInS3() should return array with elements", (done: Mocha.Done) => {
      getPewPewVersionsInS3().then((result: string[]) => {
        log("getPewPewVersionsInS3()", LogLevel.DEBUG, result);
        expect(result).to.not.equal(undefined);
        expect(Array.isArray(result), JSON.stringify(result)).to.equal(true);
        expect(result.length).to.be.greaterThan(0);
        for (const version of result) {
          if (version !== latestPewPewVersion) {
            log(`semver.valid(${version}) = ${semver.valid(version)}`, LogLevel.DEBUG);
            expect(semver.valid(version), `semver.valid(${version})`).to.not.equal(null);
          }
        }
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = result;
        }
        done();
      }).catch((error) => done(error));
    });
  });

  describe("postPewPew", () => {
    it("postPewPew legacy should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: filesLegacyPewpew
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        // If this runs before the other acceptance tests populate the shared pewpew versions
        uploadedPewPewVersion = version;
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [version];
        } else if (!sharedPewPewVersions.includes(version)) {
          sharedPewPewVersions.push(version);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew as latest should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {
          latest: "true"
        },
        files: filesLegacyPewpew
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.include("as latest");
        const version = latestPewPewVersion;
        // If this runs before the other acceptance tests populate the shared pewpew versions
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [version];
        } else if (!sharedPewPewVersions.includes(version)) {
          sharedPewPewVersions.push(version);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("postPewPew scripting should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files: filesScriptingPewpew
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then((res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        // If this runs before the other acceptance tests populate the shared pewpew versions
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [version];
        } else if (!sharedPewPewVersions.includes(version)) {
          sharedPewPewVersions.push(version);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("getPewpew", () => {
    it("getPewpew should respond 200 OK", (done: Mocha.Done) => {
      expect(sharedPewPewVersions, "sharedPewPewVersions").to.not.equal(undefined);
      getPewpew().then((res: ErrorResponse | PewPewVersionsResponse) => {
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const pewpewVersions: TestManagerError | string[] = res.json;
        log("pewpewVersions: " + pewpewVersions, LogLevel.DEBUG, pewpewVersions);
        expect(pewpewVersions).to.not.equal(undefined);
        expect(Array.isArray(pewpewVersions)).to.equal(true);
        if (Array.isArray(pewpewVersions)) {
          expect(pewpewVersions.length).to.be.greaterThan(0);
          sharedPewPewVersions = pewpewVersions;
        }
        done();
      }).catch((error) => done(error));
    });
  });

  describe("deletePewPew", () => {
    const uploadLegacyPewpew = async () => {
      try {
        const parsedForm: ParsedForm = {
          fields: {},
          files: filesLegacyPewpew
        };
        log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
        const res: ErrorResponse = await postPewPew(parsedForm, authAdmin);
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        uploadedPewPewVersion = version;
        log("uploadedPewPewVersion: " + uploadedPewPewVersion, LogLevel.DEBUG);
        const s3Versions: string[] = await getPewPewVersionsInS3();
        expect(s3Versions).to.not.equal(undefined);
        expect(Array.isArray(s3Versions), JSON.stringify(s3Versions)).to.equal(true);
        expect(s3Versions.length).to.be.greaterThan(0);
        sharedPewPewVersions = s3Versions;
        expect(s3Versions).to.include(version);
      } catch (error) {
        log("deletePewPew uploadLegacyPewpew error", LogLevel.ERROR, error);
        throw error;
      }
    };

    beforeEach(async () => {
      if (uploadedPewPewVersion) {
        return;
      }
      await uploadLegacyPewpew();
    });

    after(async () => {
      await uploadLegacyPewpew();
    });

    it("deletePewPew should respond 200 OK", (done: Mocha.Done) => {
      expect(uploadedPewPewVersion).to.not.equal(undefined);
      const query = {
        version: uploadedPewPewVersion!
      };
      // It's been deleted, reset it
      uploadedPewPewVersion = undefined;
      sharedPewPewVersions = undefined;
      log("deletePewPew query", LogLevel.DEBUG, query);
      deletePewPew(query, authAdmin).then((res: ErrorResponse) => {
        log("deletePewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew deleted, version: " + query.version);
        getPewPewVersionsInS3().then((s3Versions: string[]) => {
          expect(s3Versions).to.not.equal(undefined);
          expect(Array.isArray(s3Versions), JSON.stringify(s3Versions)).to.equal(true);
          expect(s3Versions.length).to.be.greaterThan(0);
          sharedPewPewVersions = s3Versions;
          expect(s3Versions).to.not.include(query.version);
          done();
        }).catch((error) => {
          log("getPewPewVersionsInS3 error", LogLevel.ERROR, error);
          done(error);
        });
      }).catch((error) => {
        log("deletePewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
