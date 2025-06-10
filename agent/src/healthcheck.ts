import { LogLevel, ec2, log, s3, sqs, util } from "@fs/ppaas-common";
import { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { getHostname } from "./util/util.js";

// Export these for testing
export const S3_ALLOWED_LAST_ACCESS_MS: number = parseInt(process.env.S3_ALLOWED_LAST_ACCESS_MS || "0", 10) || 90000;
export const SQS_ALLOWED_LAST_ACCESS_MS: number = parseInt(process.env.SQS_ALLOWED_LAST_ACCESS_MS || "0", 10) || 90000;

export interface HealthCheckConfig {
  lastS3Access: Date;
  lastSQSAccess: Date;
  failHealthCheck: boolean;
  failHealthCheckMessage?: string;
  ipAddress?: string;
  hostname?: string;
  instanceId?: string;
}

export const config: HealthCheckConfig = {
  lastS3Access: new Date(0),
  lastSQSAccess: new Date(0),
  failHealthCheck: false
};

try {
  ec2.getInstanceId()
  .then((instanceId) => config.instanceId = instanceId)
  .catch((error) => log("Could not retrieve instanceId", LogLevel.ERROR, error));
  config.ipAddress = util.getLocalIpAddress();
  config.hostname = getHostname();
} catch (error) {
  log("Could not retrieve ipAddress", LogLevel.ERROR, error);
}

const lastS3AccessCallBack = (date: Date) => config.lastS3Access = date;
const lastSQSAccessCallBack = (date: Date) => config.lastSQSAccess = date;
s3.setAccessCallback(lastS3AccessCallBack);
sqs.setAccessCallback(lastSQSAccessCallBack);

// These are in separate export functions for test purposes
export function accessS3Pass (lastS3Access: Date): boolean {
  const s3Pass: boolean = ((Date.now() - lastS3Access.getTime()) < S3_ALLOWED_LAST_ACCESS_MS);
  log("accessS3Pass", LogLevel.DEBUG, { now: Date.now(), lastS3Access: lastS3Access.getTime(), s3Pass });
  return s3Pass;
}

export function accessSqsPass (lastSQSAccess: Date): boolean {
  const sqsPass: boolean = ((Date.now() - lastSQSAccess.getTime()) < SQS_ALLOWED_LAST_ACCESS_MS);
  log("accessSqsPass", LogLevel.DEBUG, { now: Date.now(), lastSQSAccess: lastSQSAccess.getTime(), sqsPass });
  return sqsPass;
}

export function init (): Router {
  const router: Router = express.Router();
  // middleware that is specific to this router
  router.use((req: Request, res: Response, next: NextFunction) => {
    log(`originalUrl:${req.originalUrl}`, LogLevel.DEBUG);
    res.type("application/json");
    next();
  });
  // define the home page route
  router.get("/", async (_req: Request, res: Response) => {
    if (config.failHealthCheck) {
      log("healthcheck", LogLevel.WARN, config);
      res.status(500).json(config);
    } else {
      const s3Pass: boolean = accessS3Pass(config.lastS3Access) || (await s3.healthCheck());
      const sqsPass: boolean = accessSqsPass(config.lastSQSAccess) || (await sqs.healthCheck());
      log("healthcheck", LogLevel.DEBUG, { ...config, s3Pass, sqsPass });
      res.status(s3Pass && sqsPass ? 200 : 500).json({ ...config, s3: s3Pass || false, sqs: sqsPass || false });
    }
  });
  // define the heartbeat route
  router.get("/heartbeat", async (_req: Request, res: Response) => {
    if (config.failHealthCheck) {
      log("heartbeat", LogLevel.WARN, config);
      res.status(500).json(config);
    } else {
      const s3Pass: boolean = accessS3Pass(config.lastS3Access) || (await s3.healthCheck());
      const sqsPass: boolean = accessSqsPass(config.lastSQSAccess) || (await sqs.healthCheck());
      log("heartbeat", LogLevel.DEBUG, { ...config, s3Pass, sqsPass });
      res.status(s3Pass && sqsPass ? 200 : 500).json({ s3: s3Pass || false, sqs: sqsPass || false });
    }
  });
  // define the s3 route
  router.get("/s3", async (_req: Request, res: Response) => {
    const s3Pass: boolean = accessS3Pass(config.lastS3Access) || (await s3.healthCheck());
    res.status(s3Pass ? 200 : 500).json({ ...config, s3: s3Pass || false });
  });
  // define the sqs route
  router.get("/sqs", async (_req: Request, res: Response) => {
    const sqsPass: boolean = accessSqsPass(config.lastSQSAccess) || (await sqs.healthCheck());
    res.status(sqsPass ? 200 : 500).json({ ...config, sqs: sqsPass || false });
  });

  return router;
}
