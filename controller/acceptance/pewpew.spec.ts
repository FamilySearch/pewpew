import {
  API_PEWPEW,
  FormDataPewPew,
  TestManagerError
} from "../types";
import { LogLevel, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import FormData from "form-data";
import { createReadStream } from "fs";
import { expect } from "chai";
import { latestPewPewVersion } from "../pages/api/util/clientutil";
import path from "path";
import semver from "semver";

async function fetch (
  url: string,
  config?: AxiosRequestConfig
): Promise<Response> {
  try {
    const response: Response = await _axios({
      method: config?.method || "get",
      url,
      maxRedirects: 0,
      validateStatus: (status) => status < 500, // Resolve only if the status code is less than 500
      ...(config || {})
    });
    return response;
  } catch (error) {
    throw error;
  }
}

// Re-create these here so we don't have to run yamlparser.spec by importing it
const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
const PEWPEW_LEGACY_FILEPATH = path.join(UNIT_TEST_FOLDER, "pewpew.zip");
const PEWPEW_SCRIPTING_FILEPATH = path.join(UNIT_TEST_FOLDER, "scripting/pewpew.zip");

// Beanstalk	<SYSTEM_NAME>_<SERVICE_NAME>_URL
const integrationUrl = "http://" + (process.env.BUILD_APP_URL || `localhost:${process.env.PORT || "8081"}`);

let sharedPewPewVersions: string[] | undefined;
let uploadedPewPewVersion: string | undefined;

export async function getPewPewVersions (): Promise<string[]> {
  if (sharedPewPewVersions) { return sharedPewPewVersions; }
  await initSharedPewPewVersions();
  return sharedPewPewVersions!;
}

async function initSharedPewPewVersions (): Promise<void> {
  if (sharedPewPewVersions) { return; }
  const url: string = integrationUrl + API_PEWPEW;
  log("smoke tests url=" + url, LogLevel.DEBUG);
  try {
    const res = await fetch(url);
    expect(res.status, JSON.stringify(res.data)).to.equal(200);
    const body = res.data;
    log("/pewpew: " + body, LogLevel.DEBUG, body);
    expect(body).to.not.equal(undefined);
    expect(Array.isArray(body)).to.equal(true);
    expect(body.length).to.be.greaterThan(0);
    expect(typeof body[0]).to.equal("string");
    sharedPewPewVersions = body as string[];
  } catch (error) {
    log("Could not load queuenames", LogLevel.ERROR, error);
    throw error;
  }
}

function convertFormDataPewPewToFormData (formDataPewPew: FormDataPewPew): FormData {
  const formData: FormData = new FormData();
  if (formDataPewPew.additionalFiles) {
    if (Array.isArray(formDataPewPew.additionalFiles)) {
      for (const additionalFile of formDataPewPew.additionalFiles) {
        formData.append("additionalFiles", additionalFile.value, additionalFile.options.filename);
      }
    } else {
      formData.append("additionalFiles", formDataPewPew.additionalFiles.value, formDataPewPew.additionalFiles.options);
    }
  }
  if (formDataPewPew.latest) {
    formData.append(latestPewPewVersion, formDataPewPew.latest);
  }

  return formData;
}

describe("PewPew API Integration", () => {
  let url: string;

  before(() => {
    url = integrationUrl + API_PEWPEW;
    log("smoke tests url=" + url, LogLevel.DEBUG);
  });

  describe("POST /pewpew", () => {
    it("POST /pewpew legacy should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(PEWPEW_LEGACY_FILEPATH);
      const formData: FormDataPewPew = {
        additionalFiles: {
          value: createReadStream(PEWPEW_LEGACY_FILEPATH),
          options: { filename }
        }
      };
      const form = convertFormDataPewPewToFormData(formData);
      const headers = form.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data: form,
        headers
      }).then((res: Response) => {
        log("POST /pewpew res", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        expect(res.data).to.not.equal(undefined);
        expect(res.data.message).to.not.equal(undefined);
        expect(typeof res.data.message).to.equal("string");
        const body: TestManagerError = res.data;
        log("body: " + body, LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        expect(semver.valid(version), `semver.valid(${version})`).to.not.equal(null);
        uploadedPewPewVersion = version;
        // If this runs before the other acceptance tests populate the shared pewpew versions
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [version];
        } else if (!sharedPewPewVersions.includes(version)) {
          sharedPewPewVersions.push(version);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
        done();
      }).catch((error) => {
        log("POST /pewpew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /pewpew as latest should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(PEWPEW_LEGACY_FILEPATH);
      const formData: FormDataPewPew = {
        additionalFiles: [{
          value: createReadStream(PEWPEW_LEGACY_FILEPATH),
          options: { filename }
        }],
        latest: "true"
      };
      const form = convertFormDataPewPewToFormData(formData);
      const headers = form.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data: form,
        headers
      }).then((res: Response) => {
        log("POST /pewpew res", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        expect(res.data).to.not.equal(undefined);
        expect(res.data.message).to.not.equal(undefined);
        expect(typeof res.data.message).to.equal("string");
        const body: TestManagerError = res.data;
        log("body: " + body, LogLevel.DEBUG, body);
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
        log("POST /pewpew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("POST /pewpew scripting should respond 200 OK", (done: Mocha.Done) => {
      const filename: string = path.basename(PEWPEW_SCRIPTING_FILEPATH);
      const formData: FormDataPewPew = {
        additionalFiles: {
          value: createReadStream(PEWPEW_SCRIPTING_FILEPATH),
          options: { filename }
        }
      };
      const form = convertFormDataPewPewToFormData(formData);
      const headers = form.getHeaders();
      log("POST formData", LogLevel.DEBUG, { test: formData, headers });
      fetch(url, {
        method: "POST",
        data: form,
        headers
      }).then((res: Response) => {
        log("POST /pewpew res", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        expect(res.data).to.not.equal(undefined);
        expect(res.data.message).to.not.equal(undefined);
        expect(typeof res.data.message).to.equal("string");
        const body: TestManagerError = res.data;
        log("body: " + body, LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        expect(semver.valid(version), `semver.valid(${version})`).to.not.equal(null);
        // If this runs before the other acceptance tests populate the shared pewpew versions
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [version];
        } else if (!sharedPewPewVersions.includes(version)) {
          sharedPewPewVersions.push(version);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
        done();
      }).catch((error) => {
        log("POST /pewpew error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("GET /pewpew", () => {
    before(() => getPewPewVersions());

    it("GET /pewpew should respond 200 OK", (done: Mocha.Done) => {
      fetch(url).then((res: Response) => {
        expect(res.status).to.equal(200);
        const pewpewVersions = res.data;
        log("pewpewVersions: " + pewpewVersions, LogLevel.DEBUG, pewpewVersions);
        expect(pewpewVersions).to.not.equal(undefined);
        expect(Array.isArray(pewpewVersions)).to.equal(true);
        expect(pewpewVersions.length).to.be.greaterThan(0);
        expect(typeof pewpewVersions[0]).to.equal("string");
        sharedPewPewVersions = pewpewVersions;
        done();
      }).catch((error) => done(error));
    });
  });

  describe("DELETE /pewpew", () => {
    const uploadLegacyPewpew = async () => {
      try {
        const filename: string = path.basename(PEWPEW_LEGACY_FILEPATH);
        const formData: FormDataPewPew = {
          additionalFiles: {
            value: createReadStream(PEWPEW_LEGACY_FILEPATH),
            options: { filename }
          }
        };
        const form = convertFormDataPewPewToFormData(formData);
        const headers = form.getHeaders();
        log("POST formData", LogLevel.DEBUG, { test: formData, headers });
        const res: Response = await fetch(url, {
          method: "POST",
          data: form,
          headers
        });
        log("POST /pewpew res", LogLevel.DEBUG, res);
        expect(res.status, JSON.stringify(res.data)).to.equal(200);
        const body: TestManagerError = res.data;
        log("body", LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(typeof body.message).to.equal("string");
        expect(body.message).to.include("PewPew uploaded, version");
        expect(body.message).to.not.include("as latest");
        const match: RegExpMatchArray | null = body.message.match(/PewPew uploaded, version: (\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?)/);
        log(`pewpew match: ${match}`, LogLevel.DEBUG, match);
        expect(match, "pewpew match").to.not.equal(null);
        expect(match!.length, "pewpew match.length").to.be.greaterThan(1);
        const version: string = match![1];
        expect(semver.valid(version), `semver.valid(${version})`).to.not.equal(null);
        uploadedPewPewVersion = version;
        // If this runs before the other acceptance tests populate the shared pewpew versions
        if (!sharedPewPewVersions) {
          sharedPewPewVersions = [version];
        } else if (!sharedPewPewVersions.includes(version)) {
          sharedPewPewVersions.push(version);
        }
        log("sharedPewPewVersions: " + sharedPewPewVersions, LogLevel.DEBUG);
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
      // Put the version back
      await uploadLegacyPewpew();
    });

    it("DELETE /pewpew should respond 200 OK", (done: Mocha.Done) => {
      expect(uploadedPewPewVersion).to.not.equal(undefined);
      const deleteVersion = uploadedPewPewVersion;
      const deleteURL = `${url}?version=${deleteVersion}`;
      log("DELETE URL", LogLevel.DEBUG, { deleteURL });
      // Reset it since it's been deleted
      uploadedPewPewVersion = undefined;
      fetch(deleteURL, { method: "DELETE" }).then((res: Response) => {
        log("DELETE /pewpew res", LogLevel.DEBUG, res);
        expect(res.status).to.equal(200);
        const body: TestManagerError = res.data;
        log("body: " + res.data, LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(typeof body.message).to.equal("string");
        expect(body.message).to.include("PewPew deleted, version: " + deleteVersion);
        done();
      }).catch((error) => {
        log("DELETE /pewpew error", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("DELETE /pewpew as latest should respond 400 Bad Request", (done: Mocha.Done) => {
      const deleteVersion = latestPewPewVersion;
      const deleteURL = `${url}?version=${deleteVersion}`;
      log("DELETE URL", LogLevel.DEBUG, { deleteURL });
      fetch(deleteURL, { method: "DELETE" }).then((res: Response) => {
        log("DELETE /pewpew res", LogLevel.DEBUG, res);
        expect(res.status).to.equal(400);
        const body: TestManagerError = res.data;
        log("body: " + res.data, LogLevel.DEBUG, body);
        expect(body).to.not.equal(undefined);
        expect(body.message).to.not.equal(undefined);
        expect(typeof body.message).to.equal("string");
        expect(body.message).to.include(`Pewpew version ${latestPewPewVersion} cannot be deleted`);
        done();
      }).catch((error) => {
        log("DELETE /pewpew error", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

});
