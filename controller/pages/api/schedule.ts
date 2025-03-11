import { AuthPermission, AuthPermissions, ErrorResponse, TestManagerResponse } from "../../types";
import { LogLevel, PpaasTestId, log, logger } from "@fs/ppaas-common";
import { NextApiRequest, NextApiResponse, PageConfig } from "next";
import {
  ParsedForm,
  cleanupTestFolder,
  createErrorResponse,
  createTestFolder,
  parseForm
} from "./util/util";
import { EventInput } from "@fullcalendar/core";
import TestManager from "./util/testmanager";
import TestScheduler from "./util/testscheduler";
import { authApi } from "./util/authserver";

logger.config.LogFileName = "ppaas-controller";

export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  // Allow Read-Only to view the schedule, but not modify

  const authPermissions: AuthPermissions | undefined = await authApi(req, res, req.method === "GET" ? AuthPermission.ReadOnly : AuthPermission.User);
  if (!authPermissions) {
    // If it's undefined we failed auth and already have set a response
    return;
  }

  if (req.method === "GET") {
    try {
      const calendarEvents: EventInput[] = await TestScheduler.getCalendarEvents();
      res.status(200).json(calendarEvents);
    } catch (error) {
      res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
    }

  } else if (req.method === "DELETE") {
    if (req.query.testId && !Array.isArray(req.query.testId)) {
      try {
        const result: ErrorResponse = await TestScheduler.removeTest(req.query.testId, authPermissions, true);
        res.status(result.status).json(result.json);
      } catch (error) {
        res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
      }
    } else {
      res.status(400).json(createErrorResponse(req, { message: "TestId Not provided" }));
    }

  } else if (req.method === "PUT") {
    let localPath: string | undefined;
    try {
      const testIdTime: string = PpaasTestId.getDateString();
      localPath = await createTestFolder(testIdTime);
      log(`${req.method} ${req.url} localPath: ${localPath}`, LogLevel.DEBUG);

      let parsedForm: ParsedForm;
      try {
        parsedForm = await parseForm(localPath, req, undefined, true);
      } catch (error) {
        log(`parseForm error: ${error}`, LogLevel.WARN, error);
        res.status(400).json(createErrorResponse(req, error));
        return;
      }
      log(`${req.method} ${req.url} parsedForm`, LogLevel.DEBUG, { files: parsedForm.files, fields: { ...parsedForm.fields, environmentVariables: undefined } });
      const testManagerResponse: TestManagerResponse = await TestManager.postTest(parsedForm, authPermissions, localPath, true);
      log(`${req.method} ${req.url} testManagerResponse`, LogLevel.DEBUG, testManagerResponse);
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

export const config: PageConfig = {
  api: {
    bodyParser: false
  }
};
