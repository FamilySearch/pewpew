import { AuthPermission, TestManagerResponse } from "../../types";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import TestManager from "./util/testmanager";
import { authApi } from "./util/authserver";
import { createErrorResponse } from "./util/util";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  // We don't actually need a body, only querystring so let's support both.

  if (req.method === "PUT" || req.method === "GET") {
    // Allow Read-Only to view
    if (!await authApi(req, res, AuthPermission.ReadOnly)) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    try {
      const testManagerResponse: TestManagerResponse = await TestManager.searchTests(req.query.s3Folder, req.query.maxResults);
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
