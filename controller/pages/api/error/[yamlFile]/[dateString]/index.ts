import { AuthPermission, AuthPermissions, TestManagerError } from "../../../../../types";
import { LogLevel, log, logger, s3 } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { authApi } from "../../../util/authserver";
import { createErrorResponse } from "../../../util/util";
import { getS3Response } from "../../../util/s3";

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

const { getFileContents, listFiles } = s3;


export async function getPewPewErrors ({ yamlFile, dateString }: { yamlFile: string, dateString: string }): Promise<string | undefined> {
  const testId = `${yamlFile}${dateString}`;
  const s3Folder: string = `${yamlFile}/${dateString}`;
  const filename: string = logger.pewpewStdErrFilename(testId);
  const key: string = `${s3Folder}/${filename}`;
  const files = await listFiles(key);
  if (files && files.length > 0) {
    // We have it in the new bucket
    // Load the file and return it
    // This will throw if we can't load it, and we'll fall back to redirect
    try {
      return await getFileContents({ filename, s3Folder, maxLength: 5000 });
    } catch (error) {
      log(`${key} not found in s3 after listFiles returned: ${files}`, LogLevel.ERROR, error, files);
    }
  }
}

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
        query: { yamlFile, dateString }
      } = request;
      const testId = `${yamlFile}${dateString}`;
      log(`yamlFile: ${yamlFile}, dateString: ${dateString}, testId: ${testId}`, LogLevel.DEBUG, { query: request.query });
      if (yamlFile && !Array.isArray(yamlFile) && dateString && !Array.isArray(dateString)) {
        const filename: string = logger.pewpewStdErrFilename(testId);
        const s3Folder: string = `${yamlFile}/${dateString}`;
        const found = await getS3Response({ request, response, filename, s3Folder});
        if (found) { return; }

        response.status(404).json({ message: `No error file found for ${request.method} ${request.url}` });
      } else {
        response.status(400).json({ message: `method ${request.method} must have an yamlFile and dateString` });
      }
    } catch (error) {
      log(`${request.method} ${request.url} failed: ${error}`, LogLevel.ERROR, error);
      response.status(500).json(createErrorResponse(request, error));
    }
  } else {
    response.status(400).json({ message: `method ${request.method} is not supported for this endpoint` });
  }
};
