import { config } from "dotenv";
import { z } from "zod";

config();

const boolFromString = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return undefined;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3010),
  AUDIT_GRPC_PORT: z.coerce.number().default(50052),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
  ALLOWED_SERVICE_NAMES: z.string().default("dpbe,auth-api"),
  AUDIT_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),

  AUDIT_GRPC_TLS_ENABLED: boolFromString.default(true),
  AUDIT_GRPC_CA_CERT_PATH: z.string().min(1),
  AUDIT_GRPC_SERVER_KEY_PATH: z.string().min(1),
  AUDIT_GRPC_SERVER_CERT_PATH: z.string().min(1),
  AUDIT_GRPC_REQUIRE_CLIENT_CERT: boolFromString.default(true),

  SERVICE_AUTH_ENABLED: boolFromString.default(false),
  SERVICE_AUTH_TOKEN: z.string().optional().default(""),
  DASHBOARD_AUTH_TOKEN: z.string().optional().default(""),

  LOG_RETENTION_ENABLED: boolFromString.default(false),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
});

let environment: z.infer<typeof environmentSchema>;

try {
  environment = environmentSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error({
      error: "Environment validation error",
      reasons: error.issues.map((issue) => ({
        [issue.path.join(".") || "env"]: issue.message,
      })),
    });
  } else {
    console.error("Unknown environment validation error:", error);
  }
  process.exit(1);
}

export const env = environment;

export const allowedServiceNames = new Set(
  env.ALLOWED_SERVICE_NAMES.split(",")
    .map((service) => service.trim())
    .filter(Boolean),
);
