import { LogLevel, log } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import { AuthPermission } from "../../../../types";
import { authApi } from "../../../../src/authserver";
import { createErrorResponse } from "../../../../src/util";
import { searchNotes } from "../../../../src/notes";

export default async function handler (req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ message: `Method ${req.method} not allowed` });
    return;
  }

  const authPermissions = await authApi(req, res, AuthPermission.ReadOnly);
  if (!authPermissions) { return; }

  try {
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const parsedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : Number.NaN;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

    const results = await searchNotes({ query, limit });
    res.status(200).json(results);
  } catch (error) {
    // Validation errors from searchNotes are client errors
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Search query")) {
      res.status(400).json({ message });
      return;
    }
    log(`Search API error: ${req.method} ${req.url}`, LogLevel.ERROR, error);
    res.status(500).json(createErrorResponse(req, error, LogLevel.ERROR));
  }
}
