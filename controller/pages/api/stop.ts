import { AuthPermissions, TestManagerResponse } from "../../types";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import TestManager from "./util/testmanager";
import { authApi } from "./util/authserver";
import { createErrorResponse } from "./util/util";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  // We don't actually need a body, only querystring so let's support both.
  if (req.method === "PUT" || req.method === "GET") {
    const authPermissions: AuthPermissions | undefined = await authApi(req, res);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    try {
      const testManagerResponse: TestManagerResponse = await TestManager.stopTest(req.query.testId, authPermissions, req.query.kill === "true");
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      log(`${req.method} ${req.url} failed: ${error}`, LogLevel.ERROR, error);
      res.status(500).json(createErrorResponse(req, error));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
