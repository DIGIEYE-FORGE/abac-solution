import http from "http";
import app from "./app";
import { env } from "./config/env";
import { closeDatabase } from "./config/db";
import { startGrpcServer } from "./grpc/audit.grpc-server";
import { logger } from "./utils/logger";
import { runRetentionOnce } from "./retention/retention.job";

const httpServer = http.createServer(app);
const grpcServer = startGrpcServer();

httpServer.listen(env.PORT, () => {
  logger.info(`[AUDIT_HTTP] listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

runRetentionOnce().catch((error) => {
  logger.error("[RETENTION_STARTUP_ERROR]", error);
});

async function shutdown(signal: string) {
  logger.info(`[AUDIT_SHUTDOWN] received ${signal}`);
  httpServer.close();
  grpcServer.forceShutdown();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
