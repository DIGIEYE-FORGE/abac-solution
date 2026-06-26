import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const logs = pgTable("logs", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Legacy columns kept for compatibility with the existing logs UI/API shape.
  path: varchar("path", { length: 255 }).notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  data: jsonb("data").default({}),
  ipAddress: varchar("ip_address", { length: 255 }),
  userAgent: varchar("user_agent", { length: 255 }),
  tenantId: uuid("tenant_id"),
  userId: uuid("user_id"),
  platformId: uuid("platform_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),

  // Centralized audit columns added for cross-service log search.
  eventId: text("event_id"),
  eventTimestamp: timestamp("timestamp", { withTimezone: true }),
  service: text("service"),
  environment: text("environment"),
  requestId: text("request_id"),
  traceId: text("trace_id"),
  eventType: text("event_type"),
  resource: text("resource"),
  resourceId: text("resource_id"),
  resourcePath: text("resource_path"),
  method: text("method"),
  statusCode: integer("status_code"),
  outcome: text("outcome"),
  latencyMs: bigint("latency_ms", { mode: "number" }),
  metadata: jsonb("metadata"),
}, (table) => ({
  tenantIdx: index("logs_tenant_idx").on(table.tenantId),
  userIdIdx: index("logs_user_id_idx").on(table.userId),
  platformIdx: index("logs_platform_idx").on(table.platformId),
  eventIdUniqueIdx: uniqueIndex("idx_logs_event_id_unique").on(table.eventId).where(sql`${table.eventId} IS NOT NULL`),
  timestampIdx: index("idx_logs_timestamp").on(table.eventTimestamp),
  serviceIdx: index("idx_logs_service").on(table.service),
  requestIdIdx: index("idx_logs_request_id").on(table.requestId),
  traceIdIdx: index("idx_logs_trace_id").on(table.traceId),
  eventTypeIdx: index("idx_logs_event_type").on(table.eventType),
  resourceIdx: index("idx_logs_resource").on(table.resource),
  resourceIdIdx: index("idx_logs_resource_id").on(table.resourceId),
  outcomeIdx: index("idx_logs_outcome").on(table.outcome),
  statusCodeIdx: index("idx_logs_status_code").on(table.statusCode),
}));

export type LogRow = typeof logs.$inferSelect;
export type NewLogRow = typeof logs.$inferInsert;
