import { NextApiRequest, NextApiResponse } from "next";
import { accessS3Pass, pingS3 } from "../util/healthcheck";

export default async (_req: NextApiRequest, res: NextApiResponse) => {
  const s3Pass: boolean = accessS3Pass() || await pingS3();
  res.status(s3Pass ? 200 : 500).json({ s3: s3Pass || false });
};
