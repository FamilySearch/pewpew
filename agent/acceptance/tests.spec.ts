import {
  LogLevel,
  log,
  logger,
  util
} from "@fs/ppaas-common";
import axios, { AxiosError, AxiosResponse as Response } from "axios";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-agent";

const integrationUrl = "http://" + (process.env.BUILD_APP_URL || `localhost:${process.env.PORT || "8080"}`);
log("integrationUrl = " + integrationUrl);

describe("Tests Integration", () => {
  let url: string;

  before(() => {
    url = integrationUrl;
    log("smoke tests url=" + url, LogLevel.DEBUG);
  });

  describe(integrationUrl + "/tests/", () => {
    it("GET tests/ should respond 404 Not Found", (done: Mocha.Done) => {
      axios.get(integrationUrl + "/tests/").then((res: Response) => {
        log(integrationUrl + "/tests/", LogLevel.WARN, { status: res.status, data: res.data });
        done(new Error("Should have returned a 404"));
      }).catch((error: unknown) => {
        log(integrationUrl + "/tests/ error", LogLevel.DEBUG, error, { status: (error as AxiosError)?.response?.status });
        if ((error as AxiosError)?.response?.status === 404) {
          done();
        } else {
          done(error);
        }
      });
    });
  });

  const waitForSuccess = async () => {
    let jobId: string | undefined;
    try {
      const startResponse: Response = await axios.get(integrationUrl + "/tests/build");
      log("startResponse", LogLevel.WARN, { status: startResponse.status, data: startResponse.data });
      if (startResponse.status !== 200) {
        throw new Error("start /tests/build returned " + startResponse.status);
      }
      const data = startResponse.data;
      expect(data, "data").to.not.equal(undefined);
      expect(data.jobId, "jobId: " + JSON.stringify(data)).to.not.equal(undefined);
      expect(typeof data.jobId, "typeof jobId").to.equal("string");
      jobId = startResponse.data.jobId;
      log("buildTest jobId: " + jobId, LogLevel.INFO, { jobId, data: startResponse.data });
      const statusUrl = integrationUrl + "/tests/build?jobId=" + jobId;
      await util.poll(async () => {
        const statusResponse: Response = await axios.get(statusUrl);
        log("statusResponse", statusResponse.status === 200 ? LogLevel.WARN : LogLevel.INFO, { status: statusResponse.status, data: statusResponse.data });
        return (statusResponse.status === 200 && statusResponse.data && statusResponse.data.build === true);
      }, 120000); // Lighthouse has been taking longer than 60 seconds on build
    } catch (error: unknown) {
      log("buildTest failed: " + jobId, LogLevel.ERROR, error, { jobId });
      throw error;
    }
  };

  describe("/tests/build", () => {
    it("GET tests/build should respond 200 OK", (done: Mocha.Done) => {
      waitForSuccess().then(() => done()).catch((error) => done(error));
    });
  });
});
