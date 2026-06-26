import fs from "fs";
import * as grpc from "@grpc/grpc-js";
import { env } from "./env";

export function createServerCredentials(): grpc.ServerCredentials {
  if (!env.AUDIT_GRPC_TLS_ENABLED) {
    return grpc.ServerCredentials.createInsecure();
  }

  const rootCerts = fs.readFileSync(env.AUDIT_GRPC_CA_CERT_PATH);
  const privateKey = fs.readFileSync(env.AUDIT_GRPC_SERVER_KEY_PATH);
  const certChain = fs.readFileSync(env.AUDIT_GRPC_SERVER_CERT_PATH);

  return grpc.ServerCredentials.createSsl(
    rootCerts,
    [{ private_key: privateKey, cert_chain: certChain }],
    env.AUDIT_GRPC_REQUIRE_CLIENT_CERT,
  );
}
