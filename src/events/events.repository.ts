import { db } from "../config/db";
import { logs } from "../db/schema";
import type { ValidatedAuditEntry } from "./events.types";

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export class EventsRepository {
  async insertBatch(entries: ValidatedAuditEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await db.insert(logs).values(entries.map((entry) => ({
      path: truncate(entry.path, 255),
      action: truncate(entry.action, 255),
      data: entry.legacyData,
      ipAddress: entry.ipAddress ? truncate(entry.ipAddress, 255) : null,
      userAgent: entry.userAgent ? truncate(entry.userAgent, 255) : null,
      tenantId: entry.tenantId,
      userId: entry.userId,
      platformId: entry.platformId,
      eventTimestamp: entry.timestamp,
      service: entry.service,
      environment: entry.environment,
      traceId: entry.traceId,
      resource: entry.resource,
      method: entry.method,
      statusCode: entry.statusCode,
      outcome: entry.outcome,
      latencyMs: entry.latencyMs,
      metadata: entry.metadata,
    })));
  }
}

export const eventsRepository = new EventsRepository();