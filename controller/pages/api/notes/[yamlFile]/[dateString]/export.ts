import { LogLevel, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { getPewPewNotes, markdownToConfluence, validateNotesParams } from "../../../../../src/notes";
import { AuthPermission } from "../../../../../types";
import { authApi } from "../../../../../src/authserver";
import { createErrorResponse } from "../../../../../src/util";

export default async function handler (req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ message: `Method ${req.method} not allowed` });
    return;
  }

  const { yamlFile, dateString, format } = req.query;
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
  const ipAddress = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
  log(`${req.method} ${req.url} received`, LogLevel.INFO, {
    userId: authPermissions.userId,
    ipAddress,
    userAgent: req.headers["user-agent"],
    referer: req.headers["referer"],
    yamlFile, dateString, format
  });

  try {
    const notes = await getPewPewNotes({ yamlFile, dateString });
    if (notes === undefined) {
      res.status(404).json({ message: "No notes found to export" });
      return;
    }

    const exportFormat = Array.isArray(format) ? format[0] : (format || "markdown");

    if (exportFormat === "confluence") {
      const confluenceContent = markdownToConfluence(notes);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Code blocks must stay raw inside CDATA for Confluence, but an HTML parser ends <![CDATA[ at the first ">".
      // Sandbox the page (no scripts, forms, or same-origin access) so nothing in a note can run on this origin.
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.status(200).send(confluenceContent);
    } else {
      // Default markdown export
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="notes-${yamlFile}-${dateString}.md"`);
      res.status(200).send(notes);
    }
  } catch (error) {
    log(`Export API error: ${req.method} ${req.url}`, LogLevel.ERROR, error);
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
  }
}
