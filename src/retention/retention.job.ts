import { lt } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../config/db";
import { logs } from "../db/schema";
import { logger } from "../utils/logger";

export async function runRetentionOnce() {
  if (!env.LOG_RETENTION_ENABLED) return;

  const cutoff = new Date(Date.now() - env.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.delete(logs).where(lt(logs.eventTimestamp, cutoff));

  logger.info("[LOG_RETENTION_COMPLETED]", {
    cutoff: cutoff.toISOString(),
    result,
  });
}
