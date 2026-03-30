import { NextApiRequest, NextApiResponse } from "next";

export default (req: NextApiRequest, res: NextApiResponse): void => {
  const headers = {
    "x-orig-base": req.headers["x-orig-base"],
    "x-orig-host": req.headers["x-orig-host"],
    "x-orig-proto": req.headers["x-orig-proto"],
    "x-orig-port": req.headers["x-orig-port"],
    "req_host": req.headers.host,
    "referer": req.headers.referer,
    "x-forwarded-for": req.headers["x-forwarded-for"],
    "x-forwarded-proto": req.headers["x-forwarded-proto"],
    "x-forwarded-port": req.headers["x-forwarded-port"],
    "x-real-ip": req.headers["x-real-ip"],
    "user-agent": req.headers["user-agent"],
    "all-headers": Object.keys(req.headers).sort()
  };

  res.status(200).json(headers);
};
