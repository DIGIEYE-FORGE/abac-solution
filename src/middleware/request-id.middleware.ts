import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "") || randomUUID();
  const traceId = String(req.headers["x-trace-id"] || "") || requestId;

  (req as any).requestId = requestId;
  (req as any).traceId = traceId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-trace-id", traceId);
  next();
}
