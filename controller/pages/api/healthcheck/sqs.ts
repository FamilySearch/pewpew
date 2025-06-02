import { NextApiRequest, NextApiResponse } from "next";
import { accessSqsPass } from "../util/healthcheck";
import { sqs } from "@fs/ppaas-common";

export default async (_req: NextApiRequest, res: NextApiResponse) => {
  const sqsPass: boolean = accessSqsPass() || await sqs.healthCheck();
  res.status(sqsPass ? 200 : 500).json({ sqs: sqsPass || false });
};
