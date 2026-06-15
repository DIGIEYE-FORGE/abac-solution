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
  { value: "between", label: "Between", description: "Value is between two time values (HH:MM-HH:MM)" },
];

export const DEFAULT_SUBJECT_ATTRIBUTES: AttributeDefinition[] = [
  { key: "userId",       label: "User ID",        valueType: "string",  description: "Unique user identifier" },
  { key: "username",     label: "Username",        valueType: "string",  description: "User login name" },
  { key: "email",        label: "Email",           valueType: "string",  description: "User email address" },
  { key: "role",         label: "User Role",       valueType: "string",  description: "User's assigned role" },
  { key: "tenantId",     label: "Tenant ID",       valueType: "string",  description: "Tenant identifier" },
  { key: "isActive",     label: "Is Active",       valueType: "boolean", description: "User active status" },
  { key: "status",       label: "Online Status",   valueType: "string",  description: "User online/offline status", options: ["ONLINE", "OFFLINE"] },
  { key: "twoFa",        label: "2FA Enabled",     valueType: "boolean", description: "Whether 2FA is enabled on the account" },
  { key: "isFirstLogin", label: "Is First Login",  valueType: "boolean", description: "True on the user's first login" },
  { key: "createdAt",    label: "Account Created", valueType: "date",    description: "When the user account was created" },
  { key: "lastSeenAt",   label: "Last Seen",       valueType: "date",    description: "Last time the user was active" },
  { key: "phone",        label: "Phone",           valueType: "string",  description: "User phone number" },
  { key: "department",   label: "Department",      valueType: "string",  description: "User department — stored in users.attributes.department" },
  { key: "clearanceLevel", label: "Clearance Level", valueType: "number", description: "Security clearance level — stored in users.attributes.clearanceLevel" },
];

export const DEFAULT_ENVIRONMENT_ATTRIBUTES: AttributeDefinition[] = [
  { key: "currentTime",    label: "Current Time",    valueType: "date",   description: "Request timestamp" },
  { key: "requestDate",    label: "Request Date",    valueType: "date",   description: "Date of request (YYYY-MM-DD)" },
  { key: "dayOfWeek",      label: "Day of Week",     valueType: "array",  description: "Select one or more days", options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
  { key: "workHour",       label: "Work Hour",       valueType: "time",   description: "Single time (e.g. 08:00 or 14:30)" },
  { key: "ipAddress",      label: "IP Address",      valueType: "string", description: "Client IP address" },
  { key: "location",       label: "Location",        valueType: "string", description: "Geographic location" },
  { key: "deviceType",     label: "Device Type",     valueType: "string", options: ["desktop", "mobile", "tablet", "api"], description: "Access device" },
  { key: "networkType",    label: "Network Type",    valueType: "string", options: ["internal", "vpn", "external"], description: "Network type" },
  { key: "requestMethod",  label: "Request Method",  valueType: "string", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method" },
  { key: "requestPath",    label: "Request Path",    valueType: "string", description: "API or page path" },
  { key: "userAgent",      label: "User Agent",      valueType: "string", description: "Client user agent" },
  { key: "timezone",       label: "Timezone",        valueType: "string", description: "Request timezone" },
  { key: "tenantTimezone", label: "Tenant Timezone", valueType: "string", description: "Tenant's configured timezone — injected from tenants.timezone" },
  { key: "licenseStatus",  label: "License Status",  valueType: "string", options: ["ACTIVE", "EXPIRED"], description: "Current license status — injected from licenses table" },
];

export const DEFAULT_RESOURCES: ResourceConfig[] = [
  { value: "*", label: "All Resources", description: "Full access to everything", category: "system" },
];

export const DEFAULT_RESOURCE_ATTRIBUTES: AttributeDefinition[] = [
  { key: "tenantId",    label: "Resource Tenant ID", valueType: "string",  description: "The tenant this resource belongs to" },
  { key: "deviceId",    label: "Device ID",           valueType: "string",  description: "Device UUID — devices only" },
  { key: "ownerId",     label: "Owner ID",            valueType: "string",  description: "The user who owns this resource" },
  { key: "status",      label: "Status",              valueType: "string",  description: "Current state of the resource", options: ["ONLINE", "OFFLINE", "INACTIVE", "AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED", "DAMAGED", "LOST", "INPROGRESS", "ACKNOWLEDGED", "REJECTED", "PENDING"] },
  { key: "severity",    label: "Alert Severity",      valueType: "string",  description: "Severity level — alerts only", options: ["INFO", "WARNING", "CRITICAL"] },
  { key: "groupId",     label: "Group ID",            valueType: "string",  description: "The group this resource belongs to" },
  { key: "isEditable",  label: "Is Editable",         valueType: "boolean", description: "Whether the resource can be edited" },
  { key: "createdAt",   label: "Created At",          valueType: "date",    description: "When the resource was created" },
];

export const DEFAULT_ACTIONS: ActionConfig[] = [
  { value: "create",   label: "Create",  description: "Create new resources (POST)",          httpMethods: ["POST"] },
  { value: "read",     label: "Read",    description: "View and list resources (GET)",          httpMethods: ["GET"] },
  { value: "update",   label: "Update",  description: "Modify existing resources (PUT/PATCH)", httpMethods: ["PUT", "PATCH"] },
  { value: "delete",   label: "Delete",  description: "Remove resources (DELETE)",             httpMethods: ["DELETE"] },
  { value: "execute",  label: "Execute", description: "Run commands and operations",           httpMethods: [] },
  { value: "manage",   label: "Manage",  description: "Full management (all operations)",      httpMethods: [] },
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
];
