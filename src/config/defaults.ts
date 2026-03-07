import type {
  AttributeDefinition,
  OperatorConfig,
  EnvironmentResolver,
  ResourceConfig,
  ActionConfig,
} from "../types";

import { pad2 } from "../utils/functions";

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export const DEFAULT_OPERATORS: OperatorConfig[] = [
  { value: "equals", label: "Equals", description: "Exact match" },
  { value: "not_equals", label: "Not Equals", description: "Not an exact match" },
  { value: "contains", label: "Contains", description: "Substring match" },
  { value: "not_contains", label: "Not Contains", description: "No substring match" },
  { value: "in", label: "In", description: "Value in list" },
  { value: "not_in", label: "Not In", description: "Value not in list" },
  { value: "greater_than", label: "Greater Than", description: "Greater than" },
  { value: "less_than", label: "Less Than", description: "Less than" },
  { value: "greater_than_or_equal", label: "≥", description: "Greater than or equal" },
  { value: "less_than_or_equal", label: "≤", description: "Less than or equal" },
  { value: "starts_with", label: "Starts With", description: "Prefix match" },
  { value: "ends_with", label: "Ends With", description: "Suffix match" },
  { value: "regex", label: "Regex", description: "Regular expression match" },
];

export const DEFAULT_SUBJECT_ATTRIBUTES: AttributeDefinition[] = [
  { key: "userId", label: "User ID", valueType: "string", description: "Unique user identifier" },
  { key: "username", label: "Username", valueType: "string", description: "User login name" },
  { key: "email", label: "Email", valueType: "string", description: "User email address" },
  { key: "role", label: "User Role", valueType: "string", description: "User's assigned role" },
  { key: "tenantId", label: "Tenant ID", valueType: "string", description: "Tenant identifier" },
  { key: "department", label: "Department", valueType: "string", description: "User's department" },
  { key: "groups", label: "Groups", valueType: "array", description: "User's groups" },
  { key: "roleIds", label: "Role IDs", valueType: "array", description: "List of role IDs" },
  { key: "clearanceLevel", label: "Clearance Level", valueType: "number", description: "Security clearance (1-10)" },
  { key: "isActive", label: "Is Active", valueType: "boolean", description: "User active status" },
  { key: "dashboardId", label: "Dashboard ID", valueType: "string", description: "Dashboard context" },
  { key: "createdAt", label: "Created Date", valueType: "date", description: "User creation date" },
  { key: "lastLogin", label: "Last Login", valueType: "date", description: "Last login timestamp" },
];

export const DEFAULT_ENVIRONMENT_ATTRIBUTES: AttributeDefinition[] = [
  { key: "currentTime", label: "Current Time", valueType: "date", description: "Request timestamp" },
  { key: "requestDate", label: "Request Date", valueType: "date", description: "Date of request (YYYY-MM-DD)" },
  { key: "dayOfWeek", label: "Day of Week", valueType: "array", description: "Select one or more days", options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
  { key: "workHour", label: "Work Hour", valueType: "time", description: "Single time (e.g. 08:00 or 14:30)" },
  { key: "ipAddress", label: "IP Address", valueType: "string", description: "Client IP address" },
  { key: "location", label: "Location", valueType: "string", description: "Geographic location" },
  { key: "deviceType", label: "Device Type", valueType: "string", options: ["desktop", "mobile", "tablet", "api"], description: "Access device" },
  { key: "networkType", label: "Network Type", valueType: "string", options: ["internal", "vpn", "external"], description: "Network type" },
  { key: "requestMethod", label: "Request Method", valueType: "string", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method" },
  { key: "requestPath", label: "Request Path", valueType: "string", description: "API or page path" },
  { key: "userAgent", label: "User Agent", valueType: "string", description: "Client user agent" },
  { key: "locale", label: "Locale", valueType: "string", description: "Request locale" },
  { key: "timezone", label: "Timezone", valueType: "string", description: "Request timezone" },
];

export const DEFAULT_RESOURCES: ResourceConfig[] = [
  { value: "*", label: "All Resources", description: "Full access to everything", category: "system" },
];

export const DEFAULT_ACTIONS: ActionConfig[] = [
  { value: "create", label: "Create", description: "Create new resources (POST)" },
  { value: "read", label: "Read", description: "View and list resources (GET)" },
  { value: "update", label: "Update", description: "Modify existing resources (PUT/PATCH)" },
  { value: "delete", label: "Delete", description: "Remove resources (DELETE)" },
  { value: "execute", label: "Execute", description: "Run commands and operations" },
  { value: "manage", label: "Manage", description: "Full management (all operations)" },
];

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
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    },
  },
  {
    key: "dayOfWeek",
    label: "Current day of the week",
    description: "Resolved to current day name (e.g. Monday).",
    forAttributeKeys: ["dayOfWeek"],
    resolve: () => DAY_NAMES[new Date().getDay()] ?? "Sunday",
  },
  {
    key: "currentHHMM",
    label: "Current time (HH:MM)",
    description: "Resolved to current time in HH:MM format.",
    forAttributeKeys: ["workHour"],
    resolve: () => {
      const d = new Date();
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
    description: "Override: provide via buildEnvironmentContext({ ipAddress: req.ip }).",
    forAttributeKeys: ["ipAddress"],
  },
  {
    key: "location",
    label: "Location",
    description: "Override: provide via buildEnvironmentContext({ location: geoLookup(ip) }).",
    forAttributeKeys: ["location"],
  },
  {
    key: "deviceType",
    label: "Device type",
    description: "Override: provide via buildEnvironmentContext({ deviceType: 'mobile' }).",
    forAttributeKeys: ["deviceType"],
  },
  {
    key: "networkType",
    label: "Network type",
    description: "Override: provide via buildEnvironmentContext({ networkType: 'vpn' }).",
    forAttributeKeys: ["networkType"],
  },
  {
    key: "requestMethod",
    label: "HTTP method",
    description: "Override: provide via buildEnvironmentContext({ requestMethod: req.method }).",
    forAttributeKeys: ["requestMethod"],
  },
  {
    key: "requestPath",
    label: "Request path",
    description: "Override: provide via buildEnvironmentContext({ requestPath: req.path }).",
    forAttributeKeys: ["requestPath"],
  },
  {
    key: "userAgent",
    label: "User agent",
    description: "Override: provide via buildEnvironmentContext({ userAgent: req.headers['user-agent'] }).",
    forAttributeKeys: ["userAgent"],
  },
  {
    key: "locale",
    label: "Locale",
    description: "Override: provide via buildEnvironmentContext({ locale: 'en-US' }).",
    forAttributeKeys: ["locale"],
  },
];
