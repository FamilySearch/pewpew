import { AuthPermission, AuthPermissions, TestManagerError } from "../../../../../types";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { authApi } from "../../../util/authserver";
import { createErrorResponse } from "../../../util/util";
import { getS3Response } from "../../../util/s3";

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

async function getOrRedirect (
  request: NextApiRequest,
  response: NextApiResponse<GetObjectCommandOutput["Body"] | Buffer | TestManagerError>,
  filename: string,
  s3Folder: string
): Promise<void> {
  try {
    if (!filename || !s3Folder) {
      response.status(400).json({ message: `method ${request.method} must have a file path` });
      return;
    }

    const found = await getS3Response({ request, response, filename, s3Folder});
    if (found) { return; }

    // 404 - Not Found
    response.status(404).json({ message: `No results file found for ${request.method} ${request.url}` });
  } catch (error) {
    log(`${request.method} ${request.url} failed: ${error}`, LogLevel.ERROR, error);
    response.status(500).json(createErrorResponse(request, error));
  }
}

export default async (req: NextApiRequest, res: NextApiResponse<GetObjectCommandOutput["Body"] | Buffer | TestManagerError>) => {

  if (req.method === "GET") {
    // Allow Read-Only to view
    const authPermissions: AuthPermissions | undefined = await authApi(req, res, AuthPermission.ReadOnly);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    try {
      const {
        query: { yamlFile, dateString, resultsFile }
      } = req;
      log(`resultsFile: ${resultsFile}`, LogLevel.DEBUG, { query: req.query });
      if (resultsFile && !Array.isArray(resultsFile) && resultsFile.startsWith("stats-") && resultsFile.endsWith(".json")) {
        await getOrRedirect(req, res, resultsFile, `${yamlFile}/${dateString}`);
      } else {
        res.status(400).json({ message: `method ${req.method} must have a json file` });
      }
    } catch (error) {
      log(`${req.method} ${req.url} failed: ${error}`, LogLevel.ERROR, error);
      res.status(500).json(createErrorResponse(req, error));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
