import type { EnvironmentResolver } from "../types";
import { pad2 } from "../utils/functions";

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/**
 * Built-in resolvers provide request-time defaults used by policy conditions.
 * Explicit values passed to buildEnvironmentContext() override these defaults.
 */
export const DEFAULT_ENVIRONMENT_RESOLVERS: EnvironmentResolver[] = [
  {
    key: "now",
    label: "Current date/time (ISO)",
    description: "Resolved to current ISO date-time.",
    forAttributeKeys: ["currentTime", "requestDate"],
    resolve: () => new Date().toISOString(),
  },
  {
    key: "date",
    label: "Current date (YYYY-MM-DD)",
    description: "Resolved to today's date.",
    forAttributeKeys: ["requestDate", "currentTime"],
    resolve: () => {
      const date = new Date();
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    },
  },
  {
    key: "dayOfWeek",
    label: "Current day of the week",
    description: "Resolved to the current day name.",
    forAttributeKeys: ["dayOfWeek"],
    resolve: () => DAY_NAMES[new Date().getDay()] ?? "Sunday",
  },
  {
    key: "currentHHMM",
    label: "Current time (HH:MM)",
    description: "Resolved to current time in HH:MM format.",
    forAttributeKeys: ["workHour"],
    resolve: () => {
      const date = new Date();
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    },
  },
  {
    key: "timezone",
    label: "Timezone",
    description: "Resolved to the runtime timezone.",
    forAttributeKeys: ["timezone"],
    resolve: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  {
    key: "ipAddress",
    label: "Client IP address",
    description: "Provide via buildEnvironmentContext({ ipAddress: req.ip }).",
    forAttributeKeys: ["ipAddress"],
  },
  {
    key: "location",
    label: "Location",
    description: "Provide via buildEnvironmentContext({ location }).",
    forAttributeKeys: ["location"],
  },
  {
    key: "deviceType",
    label: "Device type",
    description: "Provide via buildEnvironmentContext({ deviceType }).",
    forAttributeKeys: ["deviceType"],
  },
  {
    key: "networkType",
    label: "Network type",
    description: "Provide via buildEnvironmentContext({ networkType }).",
    forAttributeKeys: ["networkType"],
  },
  {
    key: "requestMethod",
    label: "HTTP method",
    description: "Provide via buildEnvironmentContext({ requestMethod: req.method }).",
    forAttributeKeys: ["requestMethod"],
  },
  {
    key: "requestPath",
    label: "Request path",
    description: "Provide via buildEnvironmentContext({ requestPath: req.path }).",
    forAttributeKeys: ["requestPath"],
  },
  {
    key: "userAgent",
    label: "User agent",
    description: "Provide via buildEnvironmentContext({ userAgent }).",
    forAttributeKeys: ["userAgent"],
  },
];