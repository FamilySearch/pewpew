import { LogLevel, log } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { createErrorResponse } from "./util/util";
import { getLogoutUrl } from "./util/authserver";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {

  if (req.method === "GET") {
    try {
      const logoutUrl: string = await getLogoutUrl(req);
      log(`${req.method} ${req.url} logoutUrl response: ${logoutUrl}`, LogLevel.DEBUG);
      res.redirect(302, logoutUrl);
    } catch (error) {
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
