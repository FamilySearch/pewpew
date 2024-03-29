import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  PewPewVersionsResponse,
  TestManagerError
} from "../types";
import type { File, Files } from "formidable";
import {
  LogLevel,
  PEWPEW_BINARY_EXECUTABLE,
  PEWPEW_BINARY_FOLDER,
  PpaasS3File,
  log,
  logger,
  sleep
} from "@fs/ppaas-common";
import { ParsedForm, createFormidableFile, unzipFile } from "../pages/api/util/util";
import {
  VERSION_TAG_NAME,
  deletePewPew,
  getCurrentPewPewLatestVersion,
  getPewPewVersionsInS3,
  getPewpew,
  postPewPew
} from "../pages/api/util/pewpew";
import { expect } from "chai";
import { latestPewPewVersion } from "../pages/api/util/clientutil";
import path from "path";
import { platform } from "os";
import semver from "semver";
import { waitForSecrets } from "../pages/api/util/secrets";

logger.config.LogFileName = "ppaas-controller";

const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
const PEWPEW_ZIP_FILEPATH = process.env.PEWPEW_ZIP_FILEPATH || path.join(UNIT_TEST_FOLDER, PEWPEW_BINARY_EXECUTABLE + ".zip");

const authAdmin: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1"
};

const pewpewZipFile: File = createFormidableFile(
  path.basename(PEWPEW_ZIP_FILEPATH),
  PEWPEW_ZIP_FILEPATH,
  "unittest",
  1,
  null
);
let sharedPewPewVersions: string[] | undefined;
let uploadedPewPewVersion: string | undefined; // Used for delete
let currentPewPewLatestVersion: string | undefined;

describe("PewPew Util Integration", () => {
  let files: Files = {};
  before(async () => {
    const filename: string = pewpewZipFile.originalFilename!;
    try {
      const unzippedFiles: File[] = await unzipFile(pewpewZipFile);
      log("unzipped " + filename, LogLevel.DEBUG, unzippedFiles);
      files = {
        additionalFiles: unzippedFiles as any as File
      };
      log("new files " + filename, LogLevel.DEBUG, files);
      if (platform() === "win32") {
        // Windows gets EBUSY trying to run pewpew --version since the unzip still hasn't released
        await sleep(100);
      }
    } catch (error) {
      log("Error unzipping " + filename, LogLevel.ERROR, error);
      throw error;
    }
    await waitForSecrets();
  });

  after(async () => {
    try {
      const parsedForm: ParsedForm = {
        fields: {},
        files
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
      const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+)/);
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
      log("deletePewPew after error", LogLevel.ERROR, error);
      throw error;
    }
  });

  describe("postPewPew", () => {
    it("postPewPew should respond 200 OK", (done: Mocha.Done) => {
      const parsedForm: ParsedForm = {
        fields: {},
        files
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then(async (res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+)/);
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
        try {
          const pewpewFiles = await PpaasS3File.getAllFilesInS3({
            s3Folder: `${PEWPEW_BINARY_FOLDER}/${version}/`,
            localDirectory: process.env.TEMP || "/tmp",
            extension: PEWPEW_BINARY_EXECUTABLE
          });
          expect(pewpewFiles).to.not.equal(undefined);
          expect(pewpewFiles.length).to.be.greaterThan(0);
          const pewpewFile = pewpewFiles.find((file) => file.filename === PEWPEW_BINARY_EXECUTABLE);
          expect(pewpewFile).to.not.equal(undefined);
          expect(pewpewFile?.tags).to.not.equal(undefined);
          expect(pewpewFile?.tags?.get(VERSION_TAG_NAME)).to.equal(version);
        } catch (error) {
          log("postPewPew error while checking latest tag: ", LogLevel.ERROR, error);
          throw error;
        }
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
        files
      };
      log("postPewPew parsedForm", LogLevel.DEBUG, parsedForm);
      postPewPew(parsedForm, authAdmin).then(async (res: ErrorResponse) => {
        log("postPewPew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.json)).to.equal(200);
        const body: TestManagerError = res.json;
        log("body: " + JSON.stringify(body), LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        expect(global.currentLatestVersion, "global.currentLatestVersion").to.equal(version);
        // If this runs before the other acceptance tests populate the shared pewpew versions
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [latestPewPewVersion];
        } else if (!sharedPewPewVersions.includes(latestPewPewVersion)) {
          sharedPewPewVersions.push(latestPewPewVersion);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
        try {
          const pewpewFiles = await PpaasS3File.getAllFilesInS3({
            s3Folder: `${PEWPEW_BINARY_FOLDER}/${latestPewPewVersion}/`,
            localDirectory: process.env.TEMP || "/tmp",
            extension: PEWPEW_BINARY_EXECUTABLE
          });
          expect(pewpewFiles).to.not.equal(undefined);
          expect(pewpewFiles.length).to.be.greaterThan(0);
          const pewpewFile = pewpewFiles.find((file) => file.filename === PEWPEW_BINARY_EXECUTABLE);
          expect(pewpewFile).to.not.equal(undefined);
          expect(pewpewFile?.tags).to.not.equal(undefined);
          expect(pewpewFile?.tags?.get(VERSION_TAG_NAME)).to.equal(version);
        } catch (error) {
          log("postPewPew error while checking latest tag: ", LogLevel.ERROR, error);
          throw error;
        }
        currentPewPewLatestVersion = version;
        done();
      }).catch((error) => {
        log("postPewPew error", LogLevel.ERROR, error);
        done(error);
      });
    });
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

  describe("getPewpew", () => {
    before(async () => {
      try {
        const pewpewFiles = await PpaasS3File.getAllFilesInS3({
          s3Folder: `${PEWPEW_BINARY_FOLDER}/${latestPewPewVersion}/`,
          localDirectory: process.env.TEMP || "/tmp",
          extension: PEWPEW_BINARY_EXECUTABLE
        });
        expect(pewpewFiles).to.not.equal(undefined);
        const pewpewFile = pewpewFiles.find((file) => file.filename === PEWPEW_BINARY_EXECUTABLE);
        expect(pewpewFile).to.not.equal(undefined);
      } catch (error) {
        log(latestPewPewVersion + " Pewpew executable not found in S3. failed: ", LogLevel.ERROR, error);
        throw error;
      }
    });

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

    it("getCurrentPewPewLatestVersion", async () => {
      expect(currentPewPewLatestVersion, "currentPewPewLatestVersion").to.not.equal(undefined);
      // We need to reset this to force it to go to S3. Otherwise it just returns the value
      global.currentLatestVersion = undefined;
      const result = await getCurrentPewPewLatestVersion();
      log("getCurrentPewPewLatestVersion: " + result, LogLevel.DEBUG, result);
      expect(result, "result").to.equal(currentPewPewLatestVersion);
    });
  });

  describe("deletePewPew", () => {
    const uploadPewpew = async () => {
      try {
        const parsedForm: ParsedForm = {
          fields: {},
          files
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
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+)/);
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
        log("deletePewPew beforeEach error", LogLevel.ERROR, error);
        throw error;
      }
    };

    beforeEach(async () => {
      if (uploadedPewPewVersion) {
        return;
      }
      await uploadPewpew();
    });

    after(async () => {
      await uploadPewpew();
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
