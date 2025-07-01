import { LogLevel, log } from "@fs/ppaas-common";
import { Address } from "cluster";
import { Application } from "express";
import { PewPewTest } from "./pewpewtest.js";
import { Server } from "http";
import express from "express";
import { init as initHealthcheck } from "./healthcheck.js";
import { init as initTests } from "./tests.js";

const PORT: number = parseInt(process.env.PORT || "0", 10) || 8080;
const TIMEOUT: number = parseInt(process.env.TIMEOUT || "0", 10) || 30000;

let server: Server;

export interface ServerConfig {
  testToRun: PewPewTest | undefined;
}

export const config: ServerConfig = {
  testToRun: undefined
};

export function start (): Application {
  const app: Application = express();

  server = app.listen(PORT, () => {
    app.use("/healthcheck", initHealthcheck());
    app.use("/tests", initTests());
    app.get("/", (_req, res) => {
      try {
        if (config.testToRun) {
          const testId = config.testToRun.getTestId();
          const yamlFile = config.testToRun.getTestId();
          const resultsUrl = config.testToRun.getResultsFileS3();
          res.status(200).json({ message: "Test Currently Running", testId, yamlFile, resultsUrl });
        } else {
          res.status(200).json({ message: "No test currently running" });
        }
      } catch (error) {
        res.status(500).json({ message: "Error stopping test", testId: config.testToRun && config.testToRun.getTestId(), error });
      }
    });
    app.get("/stop", async (req, res) => {
      try {
        if (config.testToRun) {
          const requestedTestId = req.query.testId;
          const testId = config.testToRun.getTestId();
          if (requestedTestId !== testId) {
            res.status(400).json({ message: "Invalid testId passed to stop. Please pass the correct query parameter 'testId'.", testId });
            return;
          }
          const yamlFile = config.testToRun.getYamlFile();
          const resultsUrl = config.testToRun.getResultsFileS3();
          await config.testToRun.stop();
          res.status(200).json({ message: "Stop Test successfully called", testId, yamlFile, resultsUrl });
        } else {
          res.status(400).json({ message: "No test currently running" });
        }
      } catch (error) {
        res.status(500).json({ message: "Error stopping test", testId: config.testToRun && config.testToRun.getTestId(), error });
      }
    });
    let address: string;
    if (typeof server.address() === "string") {
      address = server.address() as string;
    } else {
      const addr = server.address() as unknown as Address;
      address = addr.address + ":" + addr.port;
    }
    log(`PewPew Agent using Node.js + TypeScript listening at http://${address}}`);
  });
  server.setTimeout(TIMEOUT);
  return app;
}

export function stop (): Promise<void> {
  log("server quitting");
  return new Promise((resolve) => server.close((error) => {
    // Server is not running is the error if it's already stopped from a scale in event
    if (error && !`${error}`.includes("is not running")) {
      log("error stopping node server", LogLevel.ERROR, error);
      // Add a kill switch if the server hangs. We should exit.
      setTimeout(() => {
        log("server didn't stop, killing process", LogLevel.FATAL, error);
        process.exit(1);
      }, 3000);
    }
    resolve(); // Always swallow the error, don't throw it
  }));
}
