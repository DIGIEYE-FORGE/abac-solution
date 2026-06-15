import fs from "node:fs";
import path from "node:path";
import morgan from "morgan";
import winston from "winston";

const LOG_LEVEL = process.env.ABAC_LOG_LEVEL ?? "info";
const DEFAULT_LOG_FILE_PATH = path.resolve(process.cwd(), "logs/app.log");
const LOG_FILE_PATH = process.env.ABAC_LOG_FILE_PATH ?? DEFAULT_LOG_FILE_PATH;

fs.mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });

const { combine, timestamp, printf } = winston.format;

const SENSITIVE_KEY_RE = /(password|secret|token|credential|authorization)/i;

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : sanitize(item, seen);
  }
  return sanitized;
}

const formats = [
  timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
  printf((info) => {
    const { timestamp: ts, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? "\n" + JSON.stringify(sanitize(meta), null, 2) : "";
    return `${ts} ${level}: ${JSON.stringify(message, null, 2)}${metaStr}`;
  }),
];

export const abacLogger = winston.createLogger({
  level: LOG_LEVEL,
  format: combine(...formats),
  transports: [
    new winston.transports.Console({
      format: combine(winston.format.colorize(), ...formats),
    }),
    new winston.transports.File({
      filename: LOG_FILE_PATH,
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

export function logAbac(stage: string, message: string, meta: Record<string, unknown> = {}): void {
  abacLogger.info(message, { stage, ...meta });
}

export function createMorganAbacLogger() {
  return morgan(
    "abac-http :remote-addr :method :url HTTP/:http-version :status :res[content-length] :response-time ms",
    {
      stream: {
        write: (message) => {
          abacLogger.info(message.trim());
        },
      },
    },
  );
}
