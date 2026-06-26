export interface AuditEntryMessage {
  event_id?: string;
  timestamp?: string;
  service?: string;
  environment?: string;
  request_id?: string;
  trace_id?: string;
  user_id?: string;
  tenant_id?: string;
  action?: string;
  event_type?: string;
  resource?: string;
  resource_id?: string;
  resource_path?: string;
  method?: string;
  status_code?: number;
  outcome?: string;
  ip_address?: string;
  user_agent?: string;
  latency_ms?: number | string;
  metadata_json?: string;
}

export interface ServiceIdentity {
  serviceName: string;
  certificateSubject?: string;
}

export interface ValidatedAuditEntry {
  eventId: string | null;
  timestamp: Date;
  service: string;
  environment: string;
  requestId: string;
  traceId: string | null;
  userId: string | null;
  tenantId: string | null;
  platformId: string | null;
  action: string;
  eventType: string;
  resource: string | null;
  resourceId: string | null;
  resourcePath: string;
  method: string | null;
  statusCode: number | null;
  outcome: string;
  ipAddress: string | null;
  userAgent: string | null;
  latencyMs: number | null;
  metadata: Record<string, unknown>;
  legacyData: Record<string, unknown>;
}

export interface LogsSearchQuery {
  id?: string;
  tenantId?: string;
  userId?: string;
  platformId?: string;
  service?: string;
  environment?: string;
  requestId?: string;
  traceId?: string;
  eventType?: string;
  resource?: string;
  resourceId?: string;
  action?: string;
  outcome?: string;
  statusCode?: number;
  from?: Date;
  to?: Date;
  limit: number;
  skip: number;
  sort?: "timestamp_asc" | "timestamp_desc" | "created_at_asc" | "created_at_desc";
}
