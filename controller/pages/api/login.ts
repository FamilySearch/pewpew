import { LogLevel, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { createErrorResponse } from "./util/util";
import { getAuthUrl } from "./util/authserver";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {

  if (req.method === "GET") {
    try {
      const authUrl: string = await getAuthUrl(req);
      log(`${req.method} ${req.url} authUrl response: ${authUrl}`, LogLevel.DEBUG);
      res.redirect(302, authUrl);
    } catch (error) {
      log(`${req.method} ${req.url} failed: ${error}`, LogLevel.ERROR, error);
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
