import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../config/db";
import { logs } from "../db/schema";
import type { LogsSearchQuery, ValidatedAuditEntry } from "./events.types";

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export class EventsRepository {
  async insertBatch(entries: ValidatedAuditEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await db.insert(logs).values(entries.map((entry) => ({
      path: truncate(entry.resourcePath, 255),
      action: truncate(entry.action, 255),
      data: entry.legacyData,
      ipAddress: entry.ipAddress ? truncate(entry.ipAddress, 255) : null,
      userAgent: entry.userAgent ? truncate(entry.userAgent, 255) : null,
      tenantId: entry.tenantId,
      userId: entry.userId,
      platformId: entry.platformId,
      eventId: entry.eventId,
      eventTimestamp: entry.timestamp,
      service: entry.service,
      environment: entry.environment,
      requestId: entry.requestId,
      traceId: entry.traceId,
      eventType: entry.eventType,
      resource: entry.resource,
      resourceId: entry.resourceId,
      resourcePath: entry.resourcePath,
      method: entry.method,
      statusCode: entry.statusCode,
      outcome: entry.outcome,
      latencyMs: entry.latencyMs,
      metadata: entry.metadata,
    })));
  }

  async findById(id: string) {
    const rows = await db.select().from(logs).where(eq(logs.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByRequestId(requestId: string, limit = 100) {
    return db
      .select()
      .from(logs)
      .where(eq(logs.requestId, requestId))
      .orderBy(desc(logs.eventTimestamp), desc(logs.createdAt))
      .limit(limit);
  }

  async findByUserId(userId: string, limit = 100) {
    return db
      .select()
      .from(logs)
      .where(eq(logs.userId, userId))
      .orderBy(desc(logs.eventTimestamp), desc(logs.createdAt))
      .limit(limit);
  }

  async findByResource(resource: string, resourceId: string, limit = 100) {
    return db
      .select()
      .from(logs)
      .where(and(eq(logs.resource, resource), eq(logs.resourceId, resourceId)))
      .orderBy(desc(logs.eventTimestamp), desc(logs.createdAt))
      .limit(limit);
  }

  async search(query: LogsSearchQuery) {
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query);

    return db
      .select()
      .from(logs)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(query.skip);
  }

  private buildWhere(query: LogsSearchQuery) {
    const conditions = [];
    if (query.id) conditions.push(eq(logs.id, query.id));
    if (query.tenantId) conditions.push(eq(logs.tenantId, query.tenantId));
    if (query.userId) conditions.push(eq(logs.userId, query.userId));
    if (query.platformId) conditions.push(eq(logs.platformId, query.platformId));
    if (query.service) conditions.push(eq(logs.service, query.service));
    if (query.environment) conditions.push(eq(logs.environment, query.environment));
    if (query.requestId) conditions.push(eq(logs.requestId, query.requestId));
    if (query.traceId) conditions.push(eq(logs.traceId, query.traceId));
    if (query.eventType) conditions.push(eq(logs.eventType, query.eventType));
    if (query.resource) conditions.push(eq(logs.resource, query.resource));
    if (query.resourceId) conditions.push(eq(logs.resourceId, query.resourceId));
    if (query.action) conditions.push(eq(logs.action, query.action.toUpperCase()));
    if (query.outcome) conditions.push(eq(logs.outcome, query.outcome.toUpperCase()));
    if (query.statusCode) conditions.push(eq(logs.statusCode, query.statusCode));
    if (query.from) conditions.push(gte(logs.eventTimestamp, query.from));
    if (query.to) conditions.push(lte(logs.eventTimestamp, query.to));
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  private buildOrderBy(query: LogsSearchQuery) {
    switch (query.sort) {
      case "timestamp_asc":
        return [asc(logs.eventTimestamp), asc(logs.createdAt)];
      case "created_at_asc":
        return [asc(logs.createdAt)];
      case "created_at_desc":
        return [desc(logs.createdAt)];
      case "timestamp_desc":
      default:
        return [desc(logs.eventTimestamp), desc(logs.createdAt)];
    }
  }
}

export const eventsRepository = new EventsRepository();
