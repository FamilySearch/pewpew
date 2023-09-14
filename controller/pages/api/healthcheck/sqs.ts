import { NextApiRequest, NextApiResponse } from "next";
import { accessSqsPass } from "../util/healthcheck";

export default (_req: NextApiRequest, res: NextApiResponse) => {
  const sqsPass: boolean = accessSqsPass();
  res.status(sqsPass ? 200 : 500).json({ sqs: sqsPass || false });
};
