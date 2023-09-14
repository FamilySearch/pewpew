import { AuthPermission, AuthPermissions, TestManagerResponse } from "../../types";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import TestManager from "./util/testmanager";
import { authApi } from "./util/authserver";
import { createErrorResponse } from "./util/util";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  // Allow Read-Only to view
  const authPermissions: AuthPermissions | undefined = await authApi(req, res, AuthPermission.ReadOnly);
  if (!authPermissions) {
    // If it's undefined we failed auth and already have set a response
    return;
  }

  if (req.method === "GET") {
    try {
      const testManagerResponse: TestManagerResponse = await TestManager.getTestStatus(req.query.testId);
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      log(`${req.method} ${req.url} failed: ${error}`, LogLevel.ERROR, error);
      res.status(500).json(createErrorResponse(req, error));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
