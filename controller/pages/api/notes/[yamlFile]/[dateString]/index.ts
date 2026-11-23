import { LogLevel, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  deletePewPewNotes,
  getPewPewNotes,
  savePewPewNotes,
  updateNotesSection,
  validateNotesParams
} from "../../../../../src/notes";
import { AuthPermission } from "../../../../../types";
import { authApi } from "../../../../../src/authserver";
import { createErrorResponse } from "../../../../../src/util";

async function handleGet (req: NextApiRequest, res: NextApiResponse, yamlFile: string, dateString: string) {
  const authPermissions = await authApi(req, res, AuthPermission.ReadOnly);
  if (!authPermissions) { return; }

  const notes = await getPewPewNotes({ yamlFile, dateString });
  if (notes === undefined) {
    res.status(204).end();
    return;
  }
  res.setHeader("Content-Type", "text/markdown");
  res.status(200).send(notes);
}

async function handlePost (req: NextApiRequest, res: NextApiResponse, yamlFile: string, dateString: string) {
  const authPermissions = await authApi(req, res, AuthPermission.User);
  if (!authPermissions) { return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  // Structured section update
  if (body.section) {
    const { section, content, append } = body;
    const updatedContent = await updateNotesSection({
      yamlFile, dateString, section, content, append
    });
    await savePewPewNotes({ yamlFile, dateString, content: updatedContent, userId: authPermissions.userId || undefined });
    res.status(200).json({ message: "Section updated" });
    return;
  }

  // Append to existing notes
  const content = body.content || body;
  if (!content || typeof content !== "string") {
    res.status(400).json({ message: "content is required" });
    return;
  }

  const existing = await getPewPewNotes({ yamlFile, dateString });
  const timestamp = new Date().toISOString();
  const newContent = existing
    ? `${existing}\n\n---\n*Updated: ${timestamp}*\n\n${content}`
    : content;
  await savePewPewNotes({ yamlFile, dateString, content: newContent, userId: authPermissions.userId || undefined });
  res.status(200).json({ message: "Notes saved" });
}

async function handlePut (req: NextApiRequest, res: NextApiResponse, yamlFile: string, dateString: string) {
  const authPermissions = await authApi(req, res, AuthPermission.User);
  if (!authPermissions) { return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const content = body.content || body;
  if (!content || typeof content !== "string") {
    res.status(400).json({ message: "content is required" });
    return;
  }

  await savePewPewNotes({ yamlFile, dateString, content, userId: authPermissions.userId || undefined });
  res.status(200).json({ message: "Notes replaced" });
}

async function handleDelete (req: NextApiRequest, res: NextApiResponse, yamlFile: string, dateString: string) {
  const authPermissions = await authApi(req, res, AuthPermission.Admin);
  if (!authPermissions) { return; }

  await deletePewPewNotes({ yamlFile, dateString });
  res.status(200).json({ message: "Notes deleted" });
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
    } else if (req.method === "POST") {
      await handlePost(req, res, yamlFile, dateString);
    } else if (req.method === "PUT") {
      await handlePut(req, res, yamlFile, dateString);
    } else if (req.method === "DELETE") {
      await handleDelete(req, res, yamlFile, dateString);
    } else {
      res.status(405).json({ message: `Method ${req.method} not allowed` });
    }
  } catch (error) {
    log(`Notes API error: ${req.method} ${req.url}`, LogLevel.ERROR, error);
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
  }
}
