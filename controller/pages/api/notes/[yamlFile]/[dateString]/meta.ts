import { AuthPermission, NotesMetadata } from "../../../../../types";
import { LogLevel, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { getNotesMetadata, saveNotesMetadata, validateNotesParams } from "../../../../../src/notes";
import { authApi } from "../../../../../src/authserver";
import { createErrorResponse } from "../../../../../src/util";

async function handleGet (req: NextApiRequest, res: NextApiResponse, yamlFile: string, dateString: string) {
  const authPermissions = await authApi(req, res, AuthPermission.ReadOnly);
  if (!authPermissions) { return; }

  const metadata = await getNotesMetadata({ yamlFile, dateString });
  if (!metadata) {
    res.status(404).json({ message: "No notes metadata found" });
    return;
  }
  res.status(200).json(metadata);
}

async function handlePut (req: NextApiRequest, res: NextApiResponse, yamlFile: string, dateString: string) {
  const authPermissions = await authApi(req, res, AuthPermission.User);
  if (!authPermissions) { return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ message: "metadata object is required" });
    return;
  }

  const metadata: NotesMetadata = {
    ...body,
    updatedAt: new Date().toISOString(),
    updatedBy: authPermissions.userId || undefined
  };
  await saveNotesMetadata({ yamlFile, dateString, metadata });
  res.status(200).json({ message: "Metadata updated" });
}

export default async function handler (req: NextApiRequest, res: NextApiResponse) {
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

  try {
    if (req.method === "GET") {
      await handleGet(req, res, yamlFile, dateString);
    } else if (req.method === "PUT") {
      await handlePut(req, res, yamlFile, dateString);
    } else {
      res.status(405).json({ message: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    log(`Meta API error: ${req.method} ${req.url}`, LogLevel.ERROR, error);
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
  }
}
