import { AuthPermission, AuthPermissions, TestManagerResponse } from "../../types";
import { LogLevel, PpaasTestId, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse, PageConfig } from "next";
import {
  ParsedForm,
  cleanupTestFolder,
  createErrorResponse,
  createTestFolder,
  parseForm
} from "./util/util";
import { deletePewPew, getPewpew, postPewPew } from "./util/pewpew";
import { authApi } from "./util/authserver";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {

  if (req.method === "GET") {
    if (!await authApi(req, res)) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    try {
      const testManagerResponse: TestManagerResponse = await getPewpew();
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }

  } else if (req.method === "POST" || req.method === "DELETE") {
    log(`${req.method} ${req.url} start`, LogLevel.DEBUG, { body: req.body, req });
    const authPermissions: AuthPermissions | undefined = await authApi(req, res, AuthPermission.Admin);
    if (!authPermissions) {
      // If it's undefined we failed auth and already have set a response
      return;
    }
    let localPath: string | undefined;
    try {
      if (req.method === "DELETE") {
        // Check query param
        const testManagerResponse: TestManagerResponse = await deletePewPew(req.query, authPermissions);
        res.status(testManagerResponse.status).json(testManagerResponse.json);
      } else { // req.method === "POST"
        localPath = await createTestFolder(PpaasTestId.getDateString());

        let parsedForm: ParsedForm;
        try {
          parsedForm = await parseForm(localPath, req, 25, true);
        } catch (error) {
          log(`parseForm error: ${error}`, LogLevel.WARN, error);
          res.status(400).json(createErrorResponse(req, error));
          return;
        }

        const testManagerResponse: TestManagerResponse = await postPewPew(parsedForm, authPermissions);
        res.status(testManagerResponse.status).json(testManagerResponse.json);
      }
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    } finally {
      // Delete any and all of the temporary files and remove the directory
      await cleanupTestFolder(localPath);
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for the ${req.url} endpoint` });
  }
};

export const config: PageConfig = {
  api: {
    bodyParser: false
  }
};
