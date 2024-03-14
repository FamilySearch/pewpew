import { LogLevel, PpaasTestMessage, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { createErrorResponse } from "./util/util";

logger.config.LogFileName = "ppaas-controller";

export default (req: NextApiRequest, res: NextApiResponse): void => {
  try {
    const queueNames: string[] = PpaasTestMessage.getAvailableQueueNames();
    res.status(200).json({ queueNames });
  } catch (error) {
    log(`${req.method} ${req.url} failed: ${error}`, LogLevel.ERROR, error);
    res.status(500).json(createErrorResponse(req, error));
  }
};
