import { AuthPermissions, TokenResponse } from "../../types";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { getTokenFromCode, getTokenFromRefreshToken, validateToken } from "./util/authserver";
import { createErrorResponse } from "./util/util";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {

  if (req.method === "GET") {
    try {
      // We have a code, get the token
      if (req.query.code && !Array.isArray(req.query.code)) {
        try {
          const tokenResponse: TokenResponse = await getTokenFromCode(req);
          log(`${req.method} ${req.url} returning token: ${JSON.stringify(tokenResponse)}`, LogLevel.DEBUG);
          res.status(200).json(tokenResponse);
        } catch (error) {
          res.status(401).json(createErrorResponse(req, error, LogLevel.WARN));
        }
      } else if (req.query.token && !Array.isArray(req.query.token)) {
        const authPermissions: AuthPermissions = await validateToken(req.query.token);
        log(`${req.method} ${req.url} response: ${JSON.stringify(authPermissions)}`, LogLevel.DEBUG);
        res.status(200).json(authPermissions);
      } else if (req.query.refreshToken && !Array.isArray(req.query.refreshToken)) {
        try {
          const tokenResponse: TokenResponse = await getTokenFromRefreshToken(req.query.refreshToken);
          log(`${req.method} ${req.url} returning token: ${JSON.stringify(tokenResponse)}`);
          res.status(200).json(tokenResponse);
        } catch (error) {
          res.status(401).json(createErrorResponse(req, error));
        }
      } else {
        res.status(400).json({ message: `method ${req.method} must have a code or token queryparam` });
      }
    } catch (error) {
      log(`${req.method} ${req.url} failed: ${error}`, LogLevel.ERROR, error);
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
