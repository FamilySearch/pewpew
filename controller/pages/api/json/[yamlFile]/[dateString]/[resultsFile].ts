import { AuthPermission, AuthPermissions, TestManagerError } from "../../../../../types";
import { LogLevel, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { authApi } from "../../../util/authserver";
import { createErrorResponse } from "../../../util/util";
import { getS3Response } from "../../../util/s3";

async function getOrRedirect ({ request, response, resultsFile: filename, s3Folder, redirectToS3 }: {
  request: NextApiRequest,
  response: NextApiResponse<GetObjectCommandOutput["Body"] | Buffer | TestManagerError>,
  resultsFile: string,
  s3Folder: string,
  redirectToS3?: boolean
}): Promise<void> {
  try {
    if (!filename || !s3Folder) {
      response.status(400).json({ message: `method ${request.method} must have a file path` });
      return;
    }

    const found = await getS3Response({ request, response, filename, s3Folder, redirectToS3 });
    if (found) { return; }

    // 404 - Not Found
    response.status(404).json({ message: `No results file found for ${request.method} ${request.url}` });
  } catch (error) {
    response.status(500).json(createErrorResponse(request, error, LogLevel.ERROR));
  }
}

export default async (request: NextApiRequest, response: NextApiResponse<GetObjectCommandOutput["Body"] | Buffer | TestManagerError>) => {

  if (request.method === "GET") {
    // Allow Read-Only to view
    const authPermissions: AuthPermissions | undefined = await authApi(request, response, AuthPermission.ReadOnly);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    try {
      const {
        query: { yamlFile, dateString, resultsFile, redirect }
      } = request;
      log(`resultsFile: ${resultsFile}`, LogLevel.DEBUG, { query: request.query });
      if (resultsFile && !Array.isArray(resultsFile) && resultsFile.startsWith("stats-") && resultsFile.endsWith(".json")) {
        // If it's a string treat it as truthy. I.e. ?redirect will redirect. Only ?redirect=false
        // Any non string fall back to the default
        const redirectToS3: boolean | undefined = typeof redirect === "string" ? redirect.toLowerCase() !== "false" : undefined;
        await getOrRedirect({ request, response, resultsFile, s3Folder: `${yamlFile}/${dateString}`, redirectToS3 });
      } else {
        response.status(400).json({ message: `method ${request.method} must have a json file` });
      }
    } catch (error) {
      response.status(500).json(createErrorResponse(request, error, LogLevel.ERROR));
    }
  } else {
    response.status(400).json({ message: `method ${request.method} is not supported for this endpoint` });
  }
};
