import { AuthPermissions, TestManagerResponse } from "../../types";
import { LogLevel, log } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { TestManager } from "../../src/testmanager";
import { authApi } from "../../src/authserver";
import { createErrorResponse } from "../../src/util";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  // We don't actually need a body, only querystring so let's support both.
  if (req.method === "PUT" || req.method === "GET") {
    const authPermissions: AuthPermissions | undefined = await authApi(req, res);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    const ipAddress = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    log(`${req.method} /stop received`, LogLevel.INFO, {
      userId: authPermissions.userId,
      ipAddress,
      userAgent: req.headers["user-agent"],
      referer: req.headers["referer"],
      testId: req.query.testId
    });
    try {
      const testManagerResponse: TestManagerResponse = await TestManager.stopTest(req.query.testId, authPermissions, req.query.kill === "true");
      log(`${req.method} /stop completed`, LogLevel.INFO, {
        userId: authPermissions.userId,
        ipAddress,
        status: testManagerResponse.status,
        testId: req.query.testId
      });
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
