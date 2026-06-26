import winston from "winston";
import morgan from "morgan";
import { env } from "../config/env";

const { combine, timestamp, printf, colorize, errors } = winston.format;

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
    printf((info) => {
      const { timestamp: ts, level, message, stack, ...meta } = info;
      const metaText = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
      return `${ts} ${level}: ${stack || message}${metaText}`;
    }),
  ),
  transports: [new winston.transports.Console({ format: combine(colorize(), timestamp()) })],
});

export const requestInfo = morgan("[:remote-addr] Started :method :url", {
  stream: { write: (message) => logger.info(message.trim()) },
});

export const responseInfo = morgan(
  "[:remote-addr] Completed :method :url :status :res[content-length] in :response-time ms",
  {
    stream: { write: (message) => logger.info(message.trim()) },
  },
);
