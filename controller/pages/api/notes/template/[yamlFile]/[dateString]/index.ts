import { AuthPermission, TestData, TestDataResponse } from "../../../../../../types";
import { LogLevel, PpaasS3File, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { TestManager } from "../../../../../../src/testmanager";
import { authApi } from "../../../../../../src/authserver";
import { createErrorResponse } from "../../../../../../src/util";
import { generateNotesMarkdown, validateNotesParams } from "../../../../../../src/notes"; // eslint-disable-line sort-imports

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
    const yamlContents: string[] = [];
    try {
      const s3Files = await PpaasS3File.getAllFilesInS3({ s3Folder, localDirectory: "/tmp" });
      const yamlFileList = s3Files.filter((f) => f.filename.endsWith(".yaml") || f.filename.endsWith(".yml"));
      const { readFile } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      for (const yf of yamlFileList) {
        try {
          await yf.download();
          const content = await readFile(nodePath.join("/tmp", yf.filename), "utf-8");
          yamlContents.push(content);
        } catch (error) {
          log(`Could not load YAML file ${yf.filename} for template: ${s3Folder}`, LogLevel.DEBUG, error);
        }
      }
    } catch (error) {
      log(`Could not load YAML for template: ${s3Folder}`, LogLevel.DEBUG, error);
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
