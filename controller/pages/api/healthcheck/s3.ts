import { NextApiRequest, NextApiResponse } from "next";
import { accessS3Pass } from "../../../src/healthcheck";
import { s3 } from "@fs/ppaas-common";

export default async (_req: NextApiRequest, res: NextApiResponse) => {
  const s3Pass: boolean = accessS3Pass() || await s3.healthCheck();
  res.status(s3Pass ? 200 : 500).json({ s3: s3Pass || false });
};
