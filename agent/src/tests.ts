import {
  LogLevel,
  PEWPEW_BINARY_FOLDER,
  PEWPEW_VERSION_LATEST,
  PpaasTestId,
  PpaasTestMessage,
  TestMessage,
  log,
  logger,
  s3,
  util
} from "@fs/ppaas-common";
import { NextFunction, Request, Response, Router } from "express";
import ExpiryMap from "expiry-map";
import { PewPewTest } from "./pewpewtest";
import { config as healthcheckConfig } from "./healthcheck";
import { join as pathJoin } from "path";

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-agent";

const UNIT_TEST_FOLDER = process.env.UNIT_TEST_FOLDER || "test";
export const yamlFile = "basicwithenv.yaml";
export const version = PEWPEW_VERSION_LATEST;
export const PEWPEW_PATH = process.env.PEWPEW_PATH || pathJoin(UNIT_TEST_FOLDER, util.PEWPEW_BINARY_EXECUTABLE);
export const buildTestContents = `
vars:
  rampTime: 10s
  loadTime: 10s
  serviceUrlAgent: \${SERVICE_URL_AGENT}
load_pattern:
  - linear:
      from: 1%
      to: 100%
      over: \${rampTime}
  - linear:
      from: 100%
      to: 100%
      over: \${loadTime}
config:
  client:
    headers:
      TestTime: '\${epoch("ms")}'
      Accept: application/json
      User-Agent: PPAAS Agent Performance Test
  general:
    bucket_size: 5s
    log_provider_stats: 5s
endpoints:
  - method: GET
    url: http://\${serviceUrlAgent}/healthcheck
    peak_load: 30hpm
`;

/** key is an id/timestamp, result is either boolean (finished/not finished) or error */
const buildTestMap = new ExpiryMap<string, boolean | unknown>(600_000); // 10 minutes

export async function buildTest ({
  unitTest,
  ppaasTestId = PpaasTestId.makeTestId(yamlFile)
}: { unitTest?: boolean, ppaasTestId?: PpaasTestId } = {}) {
  // Make sure we can run a basic test
  try {
    const { testId, s3Folder } = ppaasTestId;
    await Promise.all([
      s3.uploadFileContents({
        contents: buildTestContents,
        filename: yamlFile,
        s3Folder,
        publicRead: false,
        tags: s3.defaultTestFileTags(),
        contentType: "text/x-yaml"
      }),
      s3.uploadFile({
        filepath: PEWPEW_PATH,
        s3Folder: `${PEWPEW_BINARY_FOLDER}/${version}`,
        publicRead: false,
        contentType: "application/octet-stream"
      })
    ]);
    log(`${process.env.FS_SYSTEM_NAME} environment basic startup test starting`, LogLevel.WARN, { testId, s3Folder, yamlFile });
    const startTime = Date.now();
    // Upload files
    const testMessage: TestMessage = {
      testId,
      s3Folder,
      yamlFile,
      // additionalFiles: additionalFileNames.length > 0 ? additionalFileNames : undefined,
      testRunTimeMn: 2,
      version,
      envVariables: { SERVICE_URL_AGENT: "127.0.0.1:8080" },
      restartOnFailure: false,
      userId: "buildTest"
    };

    const pewPewTest: PewPewTest = new PewPewTest(new PpaasTestMessage(testMessage));
    await pewPewTest.launch();
    log(`${process.env.FS_SYSTEM_NAME} environment basic startup test succeeded!`, LogLevel.WARN, { duration: Date.now() - startTime });
  } catch (error) {
    healthcheckConfig.failHealthCheck = true;
    healthcheckConfig.failHealthCheckMessage = `environment basic startup test failed: ${error}`;
    // Log at both levels so we catch it even when just searching for errors
    const errorMessage: string = `${process.env.FS_SYSTEM_NAME} environment basic startup test failed`;
    log(errorMessage, LogLevel.ERROR, error);
    log(errorMessage, LogLevel.FATAL, error);
    // Don't throw, or this will keep restarting, just fail the healthcheck
    if (unitTest) {
      throw error;
    }
    do {
      await util.sleep(60000);
      log(errorMessage, LogLevel.ERROR, error);
      log(errorMessage, LogLevel.FATAL, error);
    } while (healthcheckConfig.failHealthCheck === true);
  }
}

export function init (): Router {
  const router: Router = Router();
  // middleware that is specific to this router
  router.use((req: Request, res: Response, next: NextFunction) => {
    log(`originalUrl:${req.originalUrl}`, LogLevel.DEBUG);
    res.type("application/json");
    next();
  });
  // define the home page route
  router.get("/", (_req: Request, res: Response) => {
    res.status(404).send();
  });
  router.get("/build", (req: Request, res: Response) => {
    // endpoint no jobId query param starts test returns a job id
    // endpoint with jobId returns the status of a job id
    const { jobId } = req.query;
    if (jobId === undefined) {
      try {
        const ppaasTestId = PpaasTestId.makeTestId(yamlFile);
        const newJobId = ppaasTestId.testId;
        buildTestMap.set(newJobId, false);
        buildTest({ unitTest: true, ppaasTestId })
        .then(() => buildTestMap.set(newJobId, true))
        .catch((error: unknown) => buildTestMap.set(newJobId, error));
        res.status(200).json({ jobId: newJobId });
      } catch (error: unknown) {
        res.status(500).json({ build: false, error });
      }
    } else if (typeof jobId === "string") {
      const result: boolean | unknown | undefined = buildTestMap.get(jobId);
      if (result !== undefined) {
        const status = result === true
          ? 200 // Success
          : result === false
            ? 202 // Pending
            : 500; // error
        res.status(status).json({ build: result });
      } else {
        res.status(404).send();
      }
    } else {
      res.status(400).json({ message: "Invalid jobId" });
    }
  });

  return router;
}
