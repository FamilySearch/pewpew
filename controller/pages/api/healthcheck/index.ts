import { LogLevel, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import {
  accessEncryptionKeyPass,
  accessOpenIdSecretPass,
  accessS3Pass,
  accessSqsPass,
  getGlobalHealthcheckConfig,
  pingS3
} from "../util/healthcheck";
import { start as startCommuncations } from "../util/communications";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse) => {
  // We have to start the communications loop somewhere, and the healthcheck should be the first thing called
  // TODO: We can remove this once we've verfied it's starting reliably in instrumentaion
  startCommuncations();
  if (req.method !== "GET") {
    res.status(400).json({ message: "Only GET is supported for this endpoint" });
  } else if (getGlobalHealthcheckConfig().failHealthCheck) {
    log("failHealthCheck", LogLevel.ERROR, getGlobalHealthcheckConfig());
    log("failHealthCheck", LogLevel.FATAL, getGlobalHealthcheckConfig());
    res.status(500).json(getGlobalHealthcheckConfig());
  } else {
    let s3Pass: boolean = accessS3Pass();
    const sqsPass: boolean = accessSqsPass();
    if (!s3Pass) {
      s3Pass = await pingS3();
    }
    const encryptPass = accessEncryptionKeyPass();
    const openIdPass = accessOpenIdSecretPass();
    const healthcheckPass = s3Pass && sqsPass && encryptPass && openIdPass;
    log("healthCheck", healthcheckPass ? LogLevel.DEBUG : LogLevel.ERROR, { s3Pass, sqsPass, encryptPass, openIdPass, ...getGlobalHealthcheckConfig() });
    res.status(healthcheckPass ? 200 : 500).json({ ...(getGlobalHealthcheckConfig()), s3: s3Pass || false, sqs: sqsPass || false, encrypt: encryptPass || false, auth: openIdPass || false });
  }
};
