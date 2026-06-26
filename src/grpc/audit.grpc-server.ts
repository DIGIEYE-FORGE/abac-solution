import path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { env } from "../config/env";
import { createServerCredentials } from "../config/grpc";
import { streamLogs } from "./audit.handlers";
import { logger } from "../utils/logger";

function loadAuditServiceDefinition() {
  const protoPath = path.join(process.cwd(), "protos", "audit.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as any;
  return loaded.audit.AuditService;
}

export function startGrpcServer(): grpc.Server {
  const server = new grpc.Server();
  const auditService = loadAuditServiceDefinition();

  server.addService(auditService.service, {
    StreamLogs: streamLogs,
  });

  const address = `0.0.0.0:${env.AUDIT_GRPC_PORT}`;
  server.bindAsync(address, createServerCredentials(), (error, port) => {
    if (error) {
      logger.error("[AUDIT_GRPC_BIND_ERROR]", error);
      throw error;
    }
    server.start();
    logger.info(`[AUDIT_GRPC] listening on ${address} boundPort=${port}`);
  });

  return server;
}
