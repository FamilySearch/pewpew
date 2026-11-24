import { AuthPermission, TestData, TestDataResponse } from "../../../../../../types";
import { LogLevel, PpaasS3File, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { generateNotesMarkdown, makeTempDirectory, validateNotesParams } from "../../../../../../src/notes";
import { readFile, rm } from "node:fs/promises";
import { TestManager } from "../../../../../../src/testmanager";
import { authApi } from "../../../../../../src/authserver";
import { createErrorResponse } from "../../../../../../src/util";
import path from "node:path";

export default async function handler (req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ message: `Method ${req.method} not allowed` });
    return;
  }

  const { yamlFile, dateString } = req.query;
  if (!yamlFile || Array.isArray(yamlFile) || !dateString || Array.isArray(dateString)) {
    res.status(400).json({ message: "yamlFile and dateString are required path parameters" });
    return;
  }
  const validationError = validateNotesParams(yamlFile, dateString);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  const authPermissions = await authApi(req, res, AuthPermission.ReadOnly);
  if (!authPermissions) { return; }

  try {
    const s3Folder = `${yamlFile}/${dateString}`;
    const testId = `${yamlFile}${dateString}`;

    // Try to get test data from the manager
    let testData: TestData | undefined;
    try {
      const testResponse = await TestManager.getTest(testId);
      if (testResponse.status < 300) {
        testData = (testResponse as TestDataResponse).json;
      }
    } catch (error) {
      log(`Could not load test data for template: ${testId}`, LogLevel.DEBUG, error);
    }

    // Try to get YAML content from S3 (merge all yaml files)
    // Download into a per-request directory so concurrent requests can't overwrite each other's files
    const yamlContents: string[] = [];
    let localDirectory: string | undefined;
    try {
      localDirectory = await makeTempDirectory("notes-template-");
      const s3Files = await PpaasS3File.getAllFilesInS3({ s3Folder, localDirectory });
      const yamlFileList = s3Files.filter((f) => f.filename.endsWith(".yaml") || f.filename.endsWith(".yml"));
      for (const yf of yamlFileList) {
        try {
          await yf.download();
          const content = await readFile(path.join(localDirectory, yf.filename), "utf-8");
          yamlContents.push(content);
        } catch (error) {
          log(`Could not load YAML file ${yf.filename} for template: ${s3Folder}`, LogLevel.DEBUG, error);
        }
      }
    } catch (error) {
      log(`Could not load YAML for template: ${s3Folder}`, LogLevel.DEBUG, error);
    } finally {
      if (localDirectory) {
        await rm(localDirectory, { recursive: true, force: true })
          .catch((error: unknown) => log(`Could not clean up ${localDirectory}`, LogLevel.DEBUG, error));
      }
    }

    const { markdown, testOverview } = generateNotesMarkdown({
      yamlFile, dateString, testData, yamlContents: yamlContents.length > 0 ? yamlContents : undefined
    });

    res.status(200).json({ markdown, metadata: testOverview });
  } catch (error) {
    log(`Template API error: ${req.method} ${req.url}`, LogLevel.ERROR, error);
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
  }
}
