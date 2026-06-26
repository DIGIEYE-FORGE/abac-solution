import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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

  // Centralized audit columns retained for write-only ingestion and dashboard reads.
  eventTimestamp: timestamp("timestamp", { withTimezone: true }),
  service: text("service"),
  environment: text("environment"),
  traceId: text("trace_id"),
  resource: text("resource"),
  method: text("method"),
  statusCode: integer("status_code"),
  outcome: text("outcome"),
  latencyMs: bigint("latency_ms", { mode: "number" }),
  metadata: jsonb("metadata"),
}, (table) => ({
  tenantIdx: index("logs_tenant_idx").on(table.tenantId),
  userIdIdx: index("logs_user_id_idx").on(table.userId),
  platformIdx: index("logs_platform_idx").on(table.platformId),
  timestampIdx: index("idx_logs_timestamp").on(table.eventTimestamp),
  serviceIdx: index("idx_logs_service").on(table.service),
  traceIdIdx: index("idx_logs_trace_id").on(table.traceId),
  resourceIdx: index("idx_logs_resource").on(table.resource),
  outcomeIdx: index("idx_logs_outcome").on(table.outcome),
  statusCodeIdx: index("idx_logs_status_code").on(table.statusCode),
}));

export type LogRow = typeof logs.$inferSelect;
export type NewLogRow = typeof logs.$inferInsert;