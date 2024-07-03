import { BASIC_FILEPATH, getPpaasTestId } from "./test.spec";
import { LogLevel, PpaasTestId, log } from "@fs/ppaas-common";
import _axios, { AxiosRequestConfig, AxiosResponse as Response } from "axios";
import { API_YAML } from "../types";
import { expect } from "chai";
import { integrationUrl } from "./util";
import path from "path";

const REDIRECT_TO_S3: boolean = process.env.REDIRECT_TO_S3 === "true";

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

describe("YamlFile API Integration", function () {
  let url: string;
  let yamlFile: string | undefined;
  let dateString: string | undefined;
  let yamlFilename: string | undefined;

  // We can't use an arrow function here if we want to increase the timeout
  // https://stackoverflow.com/questions/41949895/how-to-set-timeout-on-before-hook-in-mocha
  before(async function (): Promise<void> {
    this.timeout(60000);
    url = integrationUrl + API_YAML;
    log("smoke tests url=" + url, LogLevel.DEBUG);
    const ppaasTestId: PpaasTestId = await getPpaasTestId();
    yamlFile = ppaasTestId.yamlFile;
    dateString = ppaasTestId.dateString;
    yamlFilename = path.basename(BASIC_FILEPATH); // The yaml file for the shared getPpaasTestId()
    expect(yamlFile, "yamlFile").to.not.equal(undefined);
    expect(dateString, "dateString").to.not.equal(undefined);
    expect(yamlFilename, "yamlFilename").to.not.equal(undefined);
  });

  it("GET yaml should respond 404 Not Found", (done: Mocha.Done) => {
    fetch(url).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET yaml/yamlFile should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined) { done(new Error("No yamlFile")); return; }
    fetch(url + `/${yamlFile}`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET yaml/yamlFile/dateString should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET yaml/yamlFile/dateString/notyaml should respond 400 Bad Request", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}/${yamlFile}.json`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(400);
      done();
    }).catch((error) => done(error));
  });

  it("GET yaml/yamlFile/dateString/notins3.yaml should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}/notins3.yaml`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET yaml/yamlFile/dateString/notins3.yml should respond 404 Not Found", (done: Mocha.Done) => {
    if (yamlFile === undefined || dateString === undefined) { done(new Error("No yamlFile or dateString")); return; }
    fetch(url + `/${yamlFile}/${dateString}/notins3.yml`).then((res: Response) => {
      expect(res, "res").to.not.equal(undefined);
      expect(res.status, "status").to.equal(404);
      done();
    }).catch((error) => done(error));
  });

  it("GET yaml/yamlFile/datestring/yaml-ins3.yaml should respond 200", (done: Mocha.Done) => {
    if (yamlFilename === undefined) { done(new Error("No yamlFilename")); return; }
    log(url + `/${yamlFile}/${dateString}/${yamlFilename}`, LogLevel.WARN);
    fetch(url + `/${yamlFile}/${dateString}/${yamlFilename}`).then((res: Response) => {
      log(`GET ${url}/${yamlFile}/${dateString}/${yamlFilename}`, LogLevel.DEBUG, { status: res.status, data: res.data });
      expect(res, "res").to.not.equal(undefined);
      if (REDIRECT_TO_S3) {
        expect(res.status, "status").to.equal(302);
        expect(res.headers.location, "location").to.not.equal(undefined);
        expect(typeof res.headers.location, "typeof location").to.equal("string");
        const location = res.headers.location;
        log(`GET ${location}`, LogLevel.DEBUG);
        fetch(location).then((redirectResponse: Response) => {
          log(`GET ${location} response`, LogLevel.DEBUG, { status: redirectResponse?.status, headers: redirectResponse.headers, data: redirectResponse.data });
          expect(redirectResponse.status, "status").to.equal(200);
          expect(redirectResponse.data, "body").to.not.equal(undefined);
          expect(typeof redirectResponse.data, "typeof redirectResponse.data").to.equal("string");
          expect(redirectResponse.data, "redirectResponse.data").to.include("load_pattern:");
          expect(redirectResponse.data, "redirectResponse.data").to.include("endpoints:");
          done();
        }).catch((error) => done(error));
      } else {
        expect(res.status, "status").to.equal(200);
        expect(res.data, "data").to.not.equal(undefined);
        expect(typeof res.data, "typeof data").to.equal("string");
        expect(res.data, "res.data").to.include("load_pattern:");
        expect(res.data, "res.data").to.include("endpoints:");
        done();
      }
    }).catch((error) => done(error));
  });
});
