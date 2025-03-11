import { AgentQueueDescription, LogLevel, PpaasTestMessage, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { createErrorResponse } from "./util/util";

logger.config.LogFileName = "ppaas-controller";

export default (req: NextApiRequest, res: NextApiResponse): void => {
  try {
    const queues: AgentQueueDescription = PpaasTestMessage.getAvailableQueueMap();
    res.status(200).json(queues);
  } catch (error) {
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
  }
};
