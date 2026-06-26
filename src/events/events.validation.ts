import { randomUUID } from "crypto";
import { z } from "zod";
import type { AuditEntryMessage, ServiceIdentity, ValidatedAuditEntry } from "./events.types";

const uuidSchema = z.string().uuid();

const auditEntrySchema = z.object({
  event_id: z.string().trim().optional().default(""),
  timestamp: z.string().trim().min(1, "timestamp is required"),
  service: z.string().trim().optional().default(""),
  environment: z.string().trim().min(1, "environment is required"),
  request_id: z.string().trim().min(1, "request_id is required"),
  trace_id: z.string().trim().optional().default(""),
  user_id: z.string().trim().optional().default(""),
  tenant_id: z.string().trim().optional().default(""),
  action: z.string().trim().optional().default("UNKNOWN"),
  event_type: z.string().trim().min(1, "event_type is required"),
  resource: z.string().trim().optional().default(""),
  resource_id: z.string().trim().optional().default(""),
  resource_path: z.string().trim().optional().default(""),
  method: z.string().trim().optional().default(""),
  status_code: z.coerce.number().int().min(0).max(599).optional().default(0),
  outcome: z.string().trim().min(1, "outcome is required"),
  ip_address: z.string().trim().optional().default(""),
  user_agent: z.string().trim().optional().default(""),
  latency_ms: z.coerce.number().min(0).optional().default(0),
  metadata_json: z.string().optional().default("{}"),
});

function emptyToNull(value?: string): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function optionalUuid(value: string | null, fieldName: string): string | null {
  if (!value) return null;
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${fieldName} must be a UUID when provided`);
  }
  return result.data;
}

function parseTimestamp(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("timestamp must be a valid ISO date-time");
  }
  return date;
}

function parseMetadata(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("metadata_json must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("metadata_json must be valid JSON");
    }
    throw error;
  }
}

function pickLegacyData(metadata: Record<string, unknown>): Record<string, unknown> {
  const legacyData: Record<string, unknown> = {};
  for (const key of ["oldData", "newData", "deletedData"]) {
    if (metadata[key] !== undefined) legacyData[key] = metadata[key];
  }
  return Object.keys(legacyData).length > 0 ? legacyData : metadata;
}

export function validateAuditEntry(
  input: AuditEntryMessage,
  identity: ServiceIdentity,
): ValidatedAuditEntry {
  const parsed = auditEntrySchema.parse(input);
  const metadata = parseMetadata(parsed.metadata_json);
  const userId = optionalUuid(emptyToNull(parsed.user_id), "user_id");
  const tenantId = optionalUuid(emptyToNull(parsed.tenant_id), "tenant_id");
  const metadataPlatformId = typeof metadata.platformId === "string" ? metadata.platformId : null;
  const platformId = optionalUuid(emptyToNull(metadataPlatformId ?? ""), "metadata.platformId");
  const resourcePath = emptyToNull(parsed.resource_path) ?? "/";

  return {
    eventId: emptyToNull(parsed.event_id) ?? randomUUID(),
    timestamp: parseTimestamp(parsed.timestamp),
    service: identity.serviceName,
    environment: parsed.environment,
    requestId: parsed.request_id,
    traceId: emptyToNull(parsed.trace_id),
    userId,
    tenantId,
    platformId,
    action: parsed.action.toUpperCase(),
    eventType: parsed.event_type,
    resource: emptyToNull(parsed.resource),
    resourceId: emptyToNull(parsed.resource_id),
    resourcePath,
    method: emptyToNull(parsed.method)?.toUpperCase() ?? null,
    statusCode: parsed.status_code > 0 ? parsed.status_code : null,
    outcome: parsed.outcome.toUpperCase(),
    ipAddress: emptyToNull(parsed.ip_address),
    userAgent: emptyToNull(parsed.user_agent),
    latencyMs: parsed.latency_ms > 0 ? parsed.latency_ms : null,
    metadata,
    legacyData: pickLegacyData(metadata),
  };
}
