import { AuthPermission, AuthPermissions, TestManagerError } from "../../../../../types";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { authApi } from "../../../util/authserver";
import { createErrorResponse } from "../../../util/util";
import { getS3Response } from "../../../util/s3";
import { isYamlFile } from "../../../util/clientutil";

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

export default async (request: NextApiRequest, response: NextApiResponse<GetObjectCommandOutput["Body"] | Buffer | TestManagerError>) => {
  if (request.method === "GET") {
    // Allow Users who can run tests to view
    const authPermissions: AuthPermissions | undefined = await authApi(request, response, AuthPermission.ReadOnly);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    try {
      const {
        query: { yamlFile, dateString, filename }
      } = request;
      log(`filename: ${filename}`, LogLevel.DEBUG, { query: request.query });
      if (filename && !Array.isArray(filename) && isYamlFile(filename)) {
        const s3Folder: string = `${yamlFile}/${dateString}`;
        const found = await getS3Response({ request, response, filename, s3Folder});
        if (found) { return; }

        response.status(404).json({ message: `No yaml file found for ${request.method} ${request.url}` });
      } else {
        response.status(400).json({ message: `method ${request.method} must have a yaml file` });
      }
    } catch (error) {
      log(`${request.method} ${request.url} failed: ${error}`, LogLevel.ERROR, error);
      response.status(500).json(createErrorResponse(request, error));
    }
  } else {
    response.status(400).json({ message: `method ${request.method} is not supported for this endpoint` });
  }
};
