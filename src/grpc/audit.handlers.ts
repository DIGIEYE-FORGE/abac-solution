import * as grpc from "@grpc/grpc-js";
import { env } from "../config/env";
import { eventsService } from "../events/events.service";
import type { AuditEntryMessage, ServiceIdentity, ValidatedAuditEntry } from "../events/events.types";
import { validateServiceIdentity } from "../middleware/service-auth.middleware";
import { logger } from "../utils/logger";

type StreamCallback = grpc.sendUnaryData<{
  success: boolean;
  accepted_count: number;
  error_message: string;
}>;

function grpcError(error: unknown): grpc.ServiceError {
  const message = error instanceof Error ? error.message : "Unknown audit stream error";
  const code = typeof (error as any)?.code === "number"
    ? (error as any).code
    : grpc.status.INTERNAL;
  return {
    name: "AuditStreamError",
    message,
    code,
    details: message,
    metadata: new grpc.Metadata(),
  };
}

export function streamLogs(
  call: grpc.ServerReadableStream<AuditEntryMessage, any>,
  callback: StreamCallback,
) {
  let identity: ServiceIdentity;
  try {
    identity = validateServiceIdentity(call);
  } catch (error) {
    callback(grpcError(error), null);
    return;
  }

  const buffer: ValidatedAuditEntry[] = [];
  let acceptedCount = 0;
  let completed = false;
  let failed = false;

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    await eventsService.insertBatch(batch);
  }

  function fail(error: unknown) {
    if (failed || completed) return;
    failed = true;
    const serviceError = grpcError(error);
    logger.error("[AUDIT_STREAM_FAILED]", {
      service: identity.serviceName,
      error: serviceError.message,
    });
    callback(serviceError, null);
    call.destroy(serviceError);
  }

  call.on("data", (entry: AuditEntryMessage) => {
    call.pause();
    Promise.resolve()
      .then(async () => {
        if (failed) return;
        const validated = eventsService.validate(entry, identity);
        buffer.push(validated);
        acceptedCount += 1;

        if (buffer.length >= env.AUDIT_BATCH_SIZE) {
          await flush();
          return;
        }

        // Keep streaming requests visible in the dashboard immediately. DPBE keeps
        // this stream open, so waiting for "end" would hide low-volume events.
        await flush();
      })
      .then(() => {
        if (!failed) call.resume();
      })
      .catch(fail);
  });

  call.on("end", () => {
    Promise.resolve()
      .then(async () => {
        if (failed) return;
        await flush();
        completed = true;
        callback(null, {
          success: true,
          accepted_count: acceptedCount,
          error_message: "",
        });
      })
      .catch(fail);
  });

  call.on("error", (error) => {
    logger.error("[AUDIT_STREAM_CONNECTION_ERROR]", {
      service: identity.serviceName,
      error: error instanceof Error ? error.message : error,
    });
  });
}

