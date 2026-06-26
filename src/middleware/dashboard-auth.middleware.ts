import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

function bearerToken(value: string): string {
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value.trim();
}

export function dashboardAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.DASHBOARD_AUTH_TOKEN) return next();

  const token = bearerToken(String(req.headers.authorization || ""));
  if (token !== env.DASHBOARD_AUTH_TOKEN) {
    return res.status(401).json({
      status: "error",
      code: 401,
      message: "Unauthorized",
    });
  }

  next();
}
