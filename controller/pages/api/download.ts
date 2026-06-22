import { AuthPermission, AuthPermissions, TestDataResponse, TestManagerError } from "../../types";
import { LogLevel, PpaasTestId, log, ppaasteststatus, s3 } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import { ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME } from "../../src/ppaasencryptenvfile";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { TestManager } from "../../src/testmanager";
import { authApi } from "../../src/authserver";
import { createErrorResponse } from "../../src/util";
import { getS3Response } from "../../src/s3";

export function isValidFileName (ppaasTestId: PpaasTestId, filename: string): boolean {
  // Encrypted environment variables are not downloadable
  // Also filter out the status file since it's encrypted and not useful to download
  // Everything else is fair game
  if (filename === ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME) {
    return false;
  }
  if (filename === ppaasteststatus.createS3Filename(ppaasTestId)) {
    return false;
  }
  return true;
}

export default async (req: NextApiRequest, res: NextApiResponse<string[] | GetObjectCommandOutput["Body"] | Buffer | TestManagerError>): Promise<void> => {
  const authPermissions: AuthPermissions | undefined = await authApi(req, res, AuthPermission.ReadOnly);
  if (!authPermissions) {
    // If it's undefined we failed auth and already have set a response
    return;
  }

  if (req.method === "GET") {
    try {
      // If we get more than one testId, just return all, don't try to pick one
      log("req.query.testId: " + req.query.testId, LogLevel.DEBUG, req.query.testId);
      const testId: string | undefined = typeof req?.query?.testId === "string" ? req.query.testId : undefined;
      const file: string | undefined = typeof req?.query?.file === "string" ? req.query.file : undefined;
      if (!testId) {
        res.status(400).json({ message: "testId is required" });
        return;
      }
      let ppaasTestId: PpaasTestId;
      try {
        ppaasTestId = PpaasTestId.getFromTestId(testId);
      } catch (error) {
        res.status(400).json(createErrorResponse(req, error, LogLevel.ERROR));
        return;
      }

      // Admins can download any test files. Non-admins can only download files from tests they own.
      // If testData has no userId, only admins can download (we cannot verify ownership).
      if (authPermissions.authPermission < AuthPermission.Admin) {
        const testDataResponse = await TestManager.getTest(testId);
        const testData = testDataResponse.status < 300 ? (testDataResponse as TestDataResponse).json : undefined;
        if (!testData?.userId || authPermissions.userId !== testData.userId) {
          res.status(403).json({ message: "You do not have permission to download these test files" });
          return;
        }
      }
      if (!file) {
        const s3Objects = await s3.listFiles(ppaasTestId.s3Folder);
        const fileList = s3Objects
          .filter((s3Object) => s3Object.Key)
          .map((s3Object) => s3Object.Key!.split("/").pop()!)
          .filter((filename) => isValidFileName(ppaasTestId, filename));

        res.status(fileList.length > 0 ? 200 : 204).json(fileList);
        return;
      }

      if (!isValidFileName(ppaasTestId, file)) {
        res.status(404).json({ message: `file ${file} is not available for download` });
        return;
      }

      const found = await getS3Response({ request: req, response: res, filename: file, s3Folder: ppaasTestId.s3Folder, downloadFile: true });
      // getS3Response handles the response if found
      if (!found) {
        // 404 - Not Found
        res.status(404).json({ message: `file ${file} is not available for download` });
      }
    } catch (error) {
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};
