import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const statusCode = typeof (error as any)?.statusCode === "number"
    ? (error as any).statusCode
    : 500;
  const message = error instanceof Error ? error.message : "Internal server error";

  logger.error("[HTTP_ERROR]", {
    statusCode,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(statusCode).json({
    status: "error",
    code: statusCode,
    message,
  });
}
