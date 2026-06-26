import type { PeerCertificate } from "tls";
import * as grpc from "@grpc/grpc-js";
import { allowedServiceNames, env } from "../config/env";
import type { ServiceIdentity } from "../events/events.types";

function metadataString(metadata: grpc.Metadata, key: string): string {
  const value = metadata.get(key)[0];
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

function bearerToken(value: string): string {
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value.trim();
}

function certNameMatches(certificate: PeerCertificate | undefined, serviceName: string): boolean {
  if (!certificate) return !env.AUDIT_GRPC_TLS_ENABLED;

  const commonName = certificate.subject?.CN;
  if (commonName === serviceName) return true;

  const subjectAltName = certificate.subjectaltname ?? "";
  return subjectAltName
    .split(",")
    .map((part) => part.trim().replace(/^DNS:/i, "").replace(/^URI:/i, ""))
    .some((name) => name === serviceName || name.endsWith(`/${serviceName}`));
}

export function validateServiceIdentity(
  call: grpc.ServerReadableStream<any, any>,
): ServiceIdentity {
  const serviceName = metadataString(call.metadata, "x-service-name");
  if (!serviceName) {
    throw Object.assign(new Error("Missing x-service-name metadata"), {
      code: grpc.status.UNAUTHENTICATED,
    });
  }

  if (!allowedServiceNames.has(serviceName)) {
    throw Object.assign(new Error(`Service ${serviceName} is not allowed`), {
      code: grpc.status.PERMISSION_DENIED,
    });
  }

  if (env.SERVICE_AUTH_ENABLED) {
    const token = bearerToken(metadataString(call.metadata, "authorization"));
    if (!env.SERVICE_AUTH_TOKEN || token !== env.SERVICE_AUTH_TOKEN) {
      throw Object.assign(new Error("Invalid service authorization token"), {
        code: grpc.status.UNAUTHENTICATED,
      });
    }
  }

  const authContext = call.getAuthContext();
  const certificate = authContext?.sslPeerCertificate;
  if (env.AUDIT_GRPC_REQUIRE_CLIENT_CERT && !certificate) {
    throw Object.assign(new Error("Client certificate is required"), {
      code: grpc.status.UNAUTHENTICATED,
    });
  }

  if (!certNameMatches(certificate, serviceName)) {
    throw Object.assign(new Error("Client certificate identity does not match x-service-name"), {
      code: grpc.status.PERMISSION_DENIED,
    });
  }

  return {
    serviceName,
    certificateSubject: certificate?.subject ? JSON.stringify(certificate.subject) : undefined,
  };
}
