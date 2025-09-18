import { AuthPermission, AuthPermissions, TestManagerResponse } from "../../types";
import { LogLevel, PpaasTestId, log } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse } from "next";
import {
  ParsedForm,
  cleanupTestFolder,
  createErrorResponse,
  createTestFolder,
  parseForm
} from "../../src/util";
import TestManager from "../../src/testmanager";
import { authApi } from "../../src/authserver";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  // Allow Read-Only to view the schedule, but not modify

  const authPermissions: AuthPermissions | undefined = await authApi(req, res, req.method === "GET" ? AuthPermission.ReadOnly : AuthPermission.User);
  if (!authPermissions) {
    // If it's undefined we failed auth and already have set a response
    return;
  }

  if (req.method === "GET") {
    try {
      // If we get more than one testId, just return all, don't try to pick one
      log("req.query.newTest: " + req.query.newTest, LogLevel.DEBUG, req.query.newTest);
      const testManagerResponse: TestManagerResponse = req && req.query && req.query.testId && !Array.isArray(req.query.testId)
        ? (req.query.newTest as any !== undefined
          ? await TestManager.getPreviousTestData(req.query.testId)
          : await TestManager.getTest(req.query.testId))
        : TestManager.getAllTest();
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }

  } else if (req.method === "POST") {
    let localPath: string | undefined;
    try {
      const testIdTime: string = PpaasTestId.getDateString();
      localPath = await createTestFolder(testIdTime);

      let parsedForm: ParsedForm;
      try {
        parsedForm = await parseForm(localPath, req, undefined, true);
      } catch (error) {
        log(`parseForm error: ${error}`, LogLevel.WARN, error);
        res.status(400).json(createErrorResponse(req, error));
        return;
      }
      const testManagerResponse: TestManagerResponse = await TestManager.postTest(parsedForm, authPermissions, localPath);
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    } finally {
      // Delete any and all of the temporary files and remove the directory
      await cleanupTestFolder(localPath);
    }

  } else if (req.method === "PUT") {
    let localPath: string | undefined;
    try {
      // This testId is a throwaway just to create a temp local folder for uploads
      localPath = await createTestFolder(PpaasTestId.getDateString());

      // Yaml files should never be larger than 10MB and we only allow 1, so no multiples
      let parsedForm: ParsedForm;
      try {
        parsedForm = await parseForm(localPath, req, 10, true);
      } catch (error) {
        log(`parseForm error: ${error}`, LogLevel.WARN, error);
        res.status(400).json(createErrorResponse(req, error));
        return;
      }
      const testManagerResponse: TestManagerResponse = await TestManager.putTest(parsedForm, authPermissions);
      res.status(testManagerResponse.status).json(testManagerResponse.json);
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    } finally {
      // Delete any and all of the temporary files and remove the directory
      await cleanupTestFolder(localPath);
    }
  } else {
    res.status(400).json({ message: `method ${req.method} is not supported for this endpoint` });
  }
};

export const config = {
  api: {
    bodyParser: false
  }
};
