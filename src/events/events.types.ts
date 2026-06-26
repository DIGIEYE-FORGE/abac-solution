export interface AuditEntryMessage {
  timestamp?: string;
  service?: string;
  environment?: string;
  trace_id?: string;
  user_id?: string;
  tenant_id?: string;
  action?: string;
  resource?: string;
  path?: string;
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
  timestamp: Date;
  service: string;
  environment: string;
  traceId: string | null;
  userId: string | null;
  tenantId: string | null;
  platformId: string | null;
  action: string;
  resource: string | null;
  path: string;
  method: string | null;
  statusCode: number | null;
  outcome: string;
  ipAddress: string | null;
  userAgent: string | null;
  latencyMs: number | null;
  metadata: Record<string, unknown>;
  legacyData: Record<string, unknown>;
}