import { ABAC } from "../src/abac";
import type { Policy, EvaluationContext, AccessExplanation } from "../src/types";

const abac = new ABAC();

// ============================================================================
// 30+ Policies — covers every operator, category, value type, and feature
// ============================================================================

const policies: Policy[] = [
  // ────────────────────────────────────────────────────────────────────────
  // 1. Super-admin: allow everything
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p1",
    name: "Super Admin Full Access",
    resources: ["*"],
    actions: ["create", "read", "update", "delete", "execute", "manage"],
    effect: "allow",
    conditions: [
      { id: "c1", category: "subject", attribute: { key: "role", value: "super-admin", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 1000,
    isActive: true,
  },


  {
    id: "p2",
    name: "Admin Device Access",
    resources: ["devices"],
    actions: ["read", "update"],
    effect: "allow",
    conditions: [
      { id: "c2", category: "subject", attribute: { key: "role", value: "admin", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 500,
    isActive: true,
  },

 
  {
    id: "p3",
    name: "Deny Inactive Users",
    resources: ["*"],
    actions: ["create", "read", "update", "delete", "execute", "manage"],
    effect: "deny",
    conditions: [
      { id: "c3", category: "subject", attribute: { key: "isActive", value: false, operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 900,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 4. Tenant-scoped read (using context variable)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p4",
    name: "Tenant Scoped Read",
    resources: ["devices", "assets", "dashboards"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c4", category: "subject", attribute: { key: "tenantId", value: "{subject.tenantId}", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 200,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 5. User in engineering group can manage workflows
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p5",
    name: "Engineering Workflow Access",
    resources: ["workflows"],
    actions: ["create", "read", "update", "delete"],
    effect: "allow",
    conditions: [
      { id: "c5", category: "subject", attribute: { key: "groups", value: "engineering", operator: "contains" } },
    ],
    conditionLogic: "AND",
    priority: 300,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 6. Deny delete for viewer role
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p6",
    name: "Deny Viewer Delete",
    resources: ["*"],
    actions: ["delete"],
    effect: "deny",
    conditions: [
      { id: "c6", category: "subject", attribute: { key: "role", value: "viewer", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 800,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 7. Clearance level >= 5 can read confidential resources
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p7",
    name: "High Clearance Confidential Read",
    resources: ["assets"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c7a", category: "subject", attribute: { key: "clearanceLevel", value: 5, operator: "greater_than_or_equal" } },
    ],
    conditionLogic: "AND",
    priority: 400,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 8. Deny access from external network
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p8",
    name: "Deny External Network",
    resources: ["settings", "api-keys"],
    actions: ["create", "read", "update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c8", category: "environment", attribute: { key: "networkType", value: "external", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 850,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 9. Work hours only (08:00-18:00) for device updates
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p9",
    name: "Work Hours Device Update",
    resources: ["devices"],
    actions: ["update"],
    effect: "allow",
    conditions: [
      { id: "c9a", category: "subject", attribute: { key: "role", value: "operator", operator: "equals" } },
      { id: "c9b", category: "environment", attribute: { key: "workHoursRange", value: "08:00-18:00", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 350,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 10. Weekend deny for firmware
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p10",
    name: "Deny Firmware on Weekends",
    resources: ["firmware"],
    actions: ["create", "update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c10", category: "environment", attribute: { key: "dayOfWeek", value: ["Saturday", "Sunday"], operator: "in" } },
    ],
    conditionLogic: "AND",
    priority: 700,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 11. Email domain check (ends_with)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p11",
    name: "Internal Email Domain Access",
    resources: ["users"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c11", category: "subject", attribute: { key: "email", value: "@digieye.com", operator: "ends_with" } },
    ],
    conditionLogic: "AND",
    priority: 250,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 12. Username starts_with "svc-" for API access
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p12",
    name: "Service Account API Keys",
    resources: ["api-keys"],
    actions: ["read", "execute"],
    effect: "allow",
    conditions: [
      { id: "c12", category: "subject", attribute: { key: "username", value: "svc-", operator: "starts_with" } },
    ],
    conditionLogic: "AND",
    priority: 300,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 13. Regex: block suspicious user agents
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p13",
    name: "Block Bot User Agents",
    resources: ["*"],
    actions: ["create", "read", "update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c13", category: "environment", attribute: { key: "userAgent", value: ".*(bot|crawler|spider).*", operator: "regex" } },
    ],
    conditionLogic: "AND",
    priority: 950,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 14. Role NOT in restricted list
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p14",
    name: "Non-Restricted Role Dashboard Read",
    resources: ["dashboards"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c14", category: "subject", attribute: { key: "role", value: ["guest", "blocked"], operator: "not_in" } },
    ],
    conditionLogic: "AND",
    priority: 150,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 15. Deny access outside working hours (not_equals on workHoursRange)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p15",
    name: "Deny Settings Outside Work Hours",
    resources: ["settings"],
    actions: ["update"],
    effect: "deny",
    conditions: [
      { id: "c15", category: "environment", attribute: { key: "workHoursRange", value: "09:00-17:00", operator: "not_equals" } },
    ],
    conditionLogic: "AND",
    priority: 750,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 16. OR logic: allow if user is admin OR in managers group
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p16",
    name: "Admin or Manager Tenant Access",
    resources: ["tenants"],
    actions: ["read", "update"],
    effect: "allow",
    conditions: [
      { id: "c16a", category: "subject", attribute: { key: "role", value: "admin", operator: "equals" } },
      { id: "c16b", category: "subject", attribute: { key: "groups", value: "managers", operator: "contains" } },
    ],
    conditionLogic: "OR",
    priority: 400,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 17. Clearance < 3 denied from restricted resources
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p17",
    name: "Low Clearance Denied Restricted",
    resources: ["assets"],
    actions: ["read", "update"],
    effect: "deny",
    conditions: [
      { id: "c17a", category: "subject", attribute: { key: "clearanceLevel", value: 3, operator: "less_than" } },
    ],
    conditionLogic: "AND",
    priority: 600,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 18. Inactive policy (should be skipped)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p18",
    name: "Inactive Allow All",
    resources: ["*"],
    actions: ["create", "read", "update", "delete"],
    effect: "allow",
    conditions: [],
    conditionLogic: "AND",
    priority: 9999,
    isActive: false,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 19. IP whitelist (not_contains to deny)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p19",
    name: "Deny Non-Internal IP",
    resources: ["settings"],
    actions: ["update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c19", category: "environment", attribute: { key: "ipAddress", value: "192.168.", operator: "not_contains" } },
    ],
    conditionLogic: "AND",
    priority: 820,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 20. Mobile device: read-only on alerts
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p20",
    name: "Mobile Read Only Alerts",
    resources: ["alerts"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c20", category: "environment", attribute: { key: "deviceType", value: "mobile", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 200,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 21. Deny mobile delete on alerts
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p21",
    name: "Deny Mobile Alert Delete",
    resources: ["alerts"],
    actions: ["delete", "update"],
    effect: "deny",
    conditions: [
      { id: "c21", category: "environment", attribute: { key: "deviceType", value: "mobile", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 800,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 22. Department equals engineering → device-profiles CRUD
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p22",
    name: "Engineering Device Profiles",
    resources: ["device-profiles"],
    actions: ["create", "read", "update", "delete"],
    effect: "allow",
    conditions: [
      { id: "c22", category: "subject", attribute: { key: "department", value: "engineering", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 300,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 23. Hour > 22 deny firmware updates (late night)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p23",
    name: "Deny Late Night Firmware",
    resources: ["firmware"],
    actions: ["update"],
    effect: "deny",
    conditions: [
      { id: "c23", category: "environment", attribute: { key: "workHoursRange", value: "22:00-23:59", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 710,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 24. Public resources readable by anyone
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p24",
    name: "Active User Dashboard Read",
    resources: ["dashboards", "assets"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c24", category: "subject", attribute: { key: "isActive", value: true, operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 100,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 25. Tenant-scoped update — only same-tenant users can update
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p25",
    name: "Tenant Scoped Update",
    resources: ["devices", "assets", "dashboards"],
    actions: ["update", "delete"],
    effect: "allow",
    conditions: [
      { id: "c25", category: "subject", attribute: { key: "tenantId", value: "{subject.tenantId}", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 350,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 26. Deny role not_equals admin from managing users
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p26",
    name: "Only Admin Manage Users",
    resources: ["users"],
    actions: ["create", "update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c26", category: "subject", attribute: { key: "role", value: ["admin", "super-admin"], operator: "not_in" } },
    ],
    conditionLogic: "AND",
    priority: 810,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 27. VPN required for protocols management
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p27",
    name: "VPN Required for Protocols",
    resources: ["protocols"],
    actions: ["create", "update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c27", category: "environment", attribute: { key: "networkType", value: "vpn", operator: "not_equals" } },
    ],
    conditionLogic: "AND",
    priority: 750,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 28. Allow read protocols for internal/vpn
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p28",
    name: "Internal/VPN Protocol Read",
    resources: ["protocols"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c28", category: "environment", attribute: { key: "networkType", value: ["internal", "vpn"], operator: "in" } },
    ],
    conditionLogic: "AND",
    priority: 300,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 29. Resource tagged "critical" → only clearance >= 7
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p29",
    name: "Critical Tag High Clearance",
    resources: ["devices", "assets"],
    actions: ["update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c29b", category: "subject", attribute: { key: "clearanceLevel", value: 7, operator: "less_than" } },
    ],
    conditionLogic: "AND",
    priority: 650,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 30. Request path starts_with /api/admin → admin only
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p30",
    name: "Admin API Path Guard",
    resources: ["*"],
    actions: ["create", "read", "update", "delete"],
    effect: "deny",
    conditions: [
      { id: "c30a", category: "environment", attribute: { key: "requestPath", value: "/api/admin", operator: "starts_with" } },
      { id: "c30b", category: "subject", attribute: { key: "role", value: ["admin", "super-admin"], operator: "not_in" } },
    ],
    conditionLogic: "AND",
    priority: 880,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 31. Weekday-only access for data-converters
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p31",
    name: "Weekday Data Converter Access",
    resources: ["data-converters"],
    actions: ["create", "read", "update"],
    effect: "allow",
    conditions: [
      { id: "c31", category: "environment", attribute: { key: "dayOfWeek", value: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], operator: "in" } },
    ],
    conditionLogic: "AND",
    priority: 250,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 32. Clearance exactly 10 → manage all
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p32",
    name: "Max Clearance Full Manage",
    resources: ["*"],
    actions: ["manage"],
    effect: "allow",
    conditions: [
      { id: "c32", category: "subject", attribute: { key: "clearanceLevel", value: 10, operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 500,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 33. Deny DELETE on any resource for hour <= 6 (early morning)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p33",
    name: "Deny Early Morning Deletes",
    resources: ["*"],
    actions: ["delete"],
    effect: "deny",
    conditions: [
      { id: "c33", category: "environment", attribute: { key: "workHoursRange", value: "00:00-06:00", operator: "equals" } },
    ],
    conditionLogic: "AND",
    priority: 860,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 34. Asset-profiles: user role in [admin, engineer]
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p34",
    name: "Admin/Engineer Asset Profiles",
    resources: ["asset-profiles"],
    actions: ["create", "read", "update"],
    effect: "allow",
    conditions: [
      { id: "c34", category: "subject", attribute: { key: "role", value: ["admin", "engineer"], operator: "in" } },
    ],
    conditionLogic: "AND",
    priority: 300,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 35. Groups NOT containing "banned" → allow groups resource read
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p35",
    name: "Non-Banned Group Read",
    resources: ["groups"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      { id: "c35", category: "subject", attribute: { key: "groups", value: "banned", operator: "not_contains" } },
    ],
    conditionLogic: "AND",
    priority: 200,
    isActive: true,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 36. Deny low clearance reading confidential resources
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "p36",
    name: "Deny Low Clearance Confidential Read",
    resources: ["assets"],
    actions: ["read"],
    effect: "deny",
    conditions: [
      { id: "c36a", category: "subject", attribute: { key: "clearanceLevel", value: 5, operator: "less_than" } },
    ],
    conditionLogic: "AND",
    priority: 610,
    isActive: true,
  },
];

// ============================================================================
// Test Scenarios
// ============================================================================

function header(title: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function test(
  label: string,
  expected: { allowed: boolean },
  context: EvaluationContext,
  resource: string,
) {
  const result = abac.evaluateAccess(policies, context, resource);
  const pass = result.allowed === expected.allowed;
  const icon = pass ? "PASS" : "FAIL";
  console.log(
    `  [${icon}] ${label}`,
    `→ ${result.allowed ? "ALLOWED" : "DENIED"} | ${result.reason}`,
  );
  if (!pass) {
    console.log(`         Expected: ${expected.allowed ? "ALLOWED" : "DENIED"}`);
  }
  return pass;
}

function testCan(
  label: string,
  expected: { allowed: boolean },
  params: Parameters<typeof abac.can>[0],
) {
  const result = abac.can(params);
  const pass = result.allowed === expected.allowed;
  const icon = pass ? "PASS" : "FAIL";
  console.log(
    `  [${icon}] ${label}`,
    `→ ${result.allowed ? "ALLOWED" : "DENIED"} | ${result.reason}`,
  );
  if (!pass) {
    console.log(`         Expected: ${expected.allowed ? "ALLOWED" : "DENIED"}`);
  }
  return pass;
}

let passed = 0;
let failed = 0;

function run(label: string, expected: { allowed: boolean }, ctx: EvaluationContext, resource: string) {
  if (test(label, expected, ctx, resource)) passed++;
  else failed++;
}

function runCan(label: string, expected: { allowed: boolean }, params: Parameters<typeof abac.can>[0]) {
  if (testCan(label, expected, params)) passed++;
  else failed++;
}

// ────────────────────────────────────────────────────────────────────────
// Test contexts
// ────────────────────────────────────────────────────────────────────────

const superAdmin: EvaluationContext = {
  subject: { userId: "u1", role: "super-admin", tenantId: "t1", email: "admin@digieye.com", isActive: true, clearanceLevel: 10, groups: ["engineering", "managers"], username: "admin" },
  action: "read",
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.10", hour: 10, dayOfWeek: "Monday", requestPath: "/api/devices", userAgent: "Mozilla/5.0", requestMethod: "GET" },
};

const regularAdmin: EvaluationContext = {
  subject: { userId: "u2", role: "admin", tenantId: "t1", email: "john@digieye.com", isActive: true, clearanceLevel: 6, groups: ["managers"], username: "john", department: "engineering" },
  action: "read",
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.20", hour: 14, dayOfWeek: "Tuesday", requestPath: "/api/devices", userAgent: "Mozilla/5.0", requestMethod: "GET" },
};

const viewer: EvaluationContext = {
  subject: { userId: "u3", role: "viewer", tenantId: "t2", email: "viewer@external.com", isActive: true, clearanceLevel: 2, groups: [], username: "viewer1" },
  action: "read",
  environment: { networkType: "external", deviceType: "desktop", ipAddress: "203.0.113.5", hour: 15, dayOfWeek: "Wednesday", requestPath: "/api/dashboards", userAgent: "Mozilla/5.0", requestMethod: "GET" },
};

const inactiveUser: EvaluationContext = {
  subject: { userId: "u4", role: "admin", tenantId: "t1", email: "fired@digieye.com", isActive: false, clearanceLevel: 8, groups: ["engineering"], username: "ex-employee" },
  action: "read",
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.30", hour: 10, dayOfWeek: "Monday", requestPath: "/api/devices", userAgent: "Mozilla/5.0", requestMethod: "GET" },
};

const engineer: EvaluationContext = {
  subject: { userId: "u5", role: "engineer", tenantId: "t1", email: "eng@digieye.com", isActive: true, clearanceLevel: 5, groups: ["engineering"], username: "eng1", department: "engineering" },
  action: "create",
  environment: { networkType: "vpn", deviceType: "desktop", ipAddress: "10.0.0.5", hour: 11, dayOfWeek: "Thursday", requestPath: "/api/workflows", userAgent: "Mozilla/5.0", requestMethod: "POST" },
};

const serviceAccount: EvaluationContext = {
  subject: { userId: "svc1", role: "service", tenantId: "t1", email: "svc@digieye.com", isActive: true, clearanceLevel: 3, groups: [], username: "svc-monitoring" },
  action: "read",
  environment: { networkType: "internal", deviceType: "api", ipAddress: "192.168.1.100", hour: 3, dayOfWeek: "Sunday", requestPath: "/api/keys", userAgent: "svc-agent/1.0", requestMethod: "GET" },
};

const mobileUser: EvaluationContext = {
  subject: { userId: "u6", role: "operator", tenantId: "t2", email: "mobile@digieye.com", isActive: true, clearanceLevel: 4, groups: [], username: "mobile1" },
  action: "read",
  environment: { networkType: "external", deviceType: "mobile", ipAddress: "203.0.113.50", hour: 14, dayOfWeek: "Friday", requestPath: "/api/alerts", userAgent: "DigiEyeApp/2.0", requestMethod: "GET" },
};

const botAgent: EvaluationContext = {
  subject: { userId: "u7", role: "admin", tenantId: "t1", email: "test@digieye.com", isActive: true, clearanceLevel: 8, groups: [], username: "testadmin" },
  action: "read",
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.50", hour: 12, dayOfWeek: "Monday", requestPath: "/api/devices", userAgent: "GoogleBot/2.1 (spider)", requestMethod: "GET" },
};

// ────────────────────────────────────────────────────────────────────────────
// Run tests
// ────────────────────────────────────────────────────────────────────────────

header("1. SUPER ADMIN — full access");
run("Super admin read devices", { allowed: true }, superAdmin, "devices");
run("Super admin delete users", { allowed: true }, { ...superAdmin, action: "delete" }, "users");
run("Super admin manage settings", { allowed: true }, { ...superAdmin, action: "manage" }, "settings");

header("2. DENY INACTIVE USERS");
run("Inactive admin read devices → DENIED", { allowed: false }, inactiveUser, "devices");
run("Inactive admin create assets → DENIED", { allowed: false }, { ...inactiveUser, action: "create" }, "assets");

header("3. ADMIN — device access");
run("Admin read devices", { allowed: true }, regularAdmin, "devices");
run("Admin update devices", { allowed: true }, { ...regularAdmin, action: "update", subject: { ...regularAdmin.subject, clearanceLevel: 8 } }, "devices");
run("Admin delete devices → no policy", { allowed: false }, { ...regularAdmin, action: "delete" }, "devices");

header("4. VIEWER — deny delete");
run("Viewer read dashboards", { allowed: true }, viewer, "dashboards");
run("Viewer delete dashboards → DENIED", { allowed: false }, { ...viewer, action: "delete" }, "dashboards");

header("5. ENGINEERING GROUP — workflows");
run("Engineer create workflows", { allowed: true }, engineer, "workflows");
run("Engineer read workflows", { allowed: true }, { ...engineer, action: "read" }, "workflows");

header("6. CLEARANCE LEVEL — numeric operators");
run("Clearance 5 read confidential assets", { allowed: true },
  { ...engineer, action: "read" }, "assets");
run("Clearance 2 read confidential → no allow match", { allowed: false },
  { ...viewer, action: "read" }, "assets");

header("7. LOW CLEARANCE DENIED RESTRICTED");
run("Clearance 2 update restricted assets → DENIED", { allowed: false },
  { ...viewer, action: "update" }, "assets");

header("8. EXTERNAL NETWORK — deny settings");
run("External network read settings → DENIED", { allowed: false },
  { ...viewer, action: "read" }, "settings");

header("9. EMAIL DOMAIN — ends_with");
run("@digieye.com user read users", { allowed: true },
  { ...regularAdmin, action: "read" }, "users");
run("@external.com user read users → denied (only admin can manage)", { allowed: false },
  { ...viewer, action: "read" }, "users");

header("10. SERVICE ACCOUNT — starts_with svc-");
run("svc-monitoring read api-keys", { allowed: true }, serviceAccount, "api-keys");

header("11. BOT USER AGENT — regex deny");
run("GoogleBot spider read devices → DENIED", { allowed: false }, botAgent, "devices");

header("12. MOBILE DEVICE — read-only alerts");
run("Mobile user read alerts", { allowed: true }, mobileUser, "alerts");
run("Mobile user delete alerts → DENIED", { allowed: false },
  { ...mobileUser, action: "delete" }, "alerts");
run("Mobile user update alerts → DENIED", { allowed: false },
  { ...mobileUser, action: "update" }, "alerts");

header("13. OR LOGIC — admin OR managers group");
run("Admin (not in managers) read tenants", { allowed: true },
  { ...regularAdmin, subject: { ...regularAdmin.subject, groups: [] }, action: "read" }, "tenants");
run("Non-admin in managers group read tenants", { allowed: true },
  { ...engineer, subject: { ...engineer.subject, role: "engineer", groups: ["managers"] }, action: "read" }, "tenants");

header("14. NOT_IN — role not in [guest, blocked]");
run("Admin read dashboards (not guest/blocked)", { allowed: true },
  { ...regularAdmin, action: "read" }, "dashboards");

header("15. DEPARTMENT — engineering device profiles");
run("Engineering department create device-profiles", { allowed: true },
  { ...regularAdmin, action: "create" }, "device-profiles");

header("16. INACTIVE POLICY — should be skipped");
run("Inactive allow-all policy has no effect", { allowed: false },
  { ...viewer, subject: { ...viewer.subject, role: "nobody" }, action: "create" }, "firmware");

header("17. TENANT-SCOPED UPDATE — subject.tenantId check");
run("Engineer update device (same tenant)", { allowed: true },
  { ...engineer, action: "update", subject: { ...engineer.subject, clearanceLevel: 8 } }, "devices");
run("Viewer update device (different tenant)", { allowed: false },
  { ...viewer, action: "update" }, "devices");

header("18. LOW CLEARANCE — deny update/delete");
run("Clearance 4 update device → DENIED", { allowed: false },
  { ...mobileUser, subject: { ...mobileUser.subject, clearanceLevel: 4 }, action: "update", environment: { ...mobileUser.environment, deviceType: "desktop", networkType: "internal" } }, "devices");

header("19. IP WHITELIST — deny non-192.168.x");
run("External IP update settings → DENIED", { allowed: false },
  { ...viewer, action: "update" }, "settings");
run("Internal IP update settings (admin)", { allowed: false },
  { ...regularAdmin, action: "update", environment: { ...regularAdmin.environment, hour: 14 } }, "settings");

header("20. VPN REQUIRED — protocols");
run("VPN user read protocols", { allowed: true },
  { ...engineer, action: "read" }, "protocols");
run("Non-VPN create protocols → DENIED", { allowed: false },
  { ...regularAdmin, environment: { ...regularAdmin.environment, networkType: "internal" }, action: "create" }, "protocols");

header("21. ADMIN API PATH — deny non-admin");
run("Viewer on /api/admin path → DENIED", { allowed: false },
  { ...viewer, environment: { ...viewer.environment, requestPath: "/api/admin/users" }, action: "read" }, "users");
run("Admin on /api/admin path → allowed", { allowed: true },
  { ...regularAdmin, environment: { ...regularAdmin.environment, requestPath: "/api/admin/settings" }, action: "read" }, "devices");

header("22. ACTIVE USER — dashboard read");
run("Active viewer can read dashboards", { allowed: true },
  { ...viewer, action: "read" }, "dashboards");

header("23. EARLY MORNING DELETE DENY (hour <= 6)");
run("Delete at hour 3 → DENIED", { allowed: false },
  { ...superAdmin, environment: { ...superAdmin.environment, workHoursRange: "00:00-06:00" }, action: "delete" }, "devices");

header("24. ROLE IN ARRAY — admin/engineer asset-profiles");
run("Engineer create asset-profiles", { allowed: true },
  { ...engineer, action: "create" }, "asset-profiles");
run("Admin read asset-profiles", { allowed: true },
  { ...regularAdmin, action: "read" }, "asset-profiles");
run("Viewer read asset-profiles → no allow", { allowed: false },
  { ...viewer, action: "read" }, "asset-profiles");

header("25. NOT_CONTAINS — groups not containing 'banned'");
run("Non-banned user read groups", { allowed: true },
  { ...engineer, action: "read" }, "groups");
run("Banned user read groups → DENIED", { allowed: false },
  { ...viewer, subject: { ...viewer.subject, groups: ["banned", "test"] }, action: "read" }, "groups");

header("26. MAX CLEARANCE 10 — manage all");
run("Clearance 10 manage anything", { allowed: true },
  { ...superAdmin, action: "manage" }, "devices");

header("27. can() SHORTHAND");
runCan("can() super-admin read devices", { allowed: true }, {
  policies,
  action: "read",
  resource: "devices",
  subject: { userId: "u1", role: "super-admin", isActive: true, clearanceLevel: 10, groups: [], username: "admin", email: "a@digieye.com", tenantId: "t1" },
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.1", hour: 10, dayOfWeek: "Monday", requestPath: "/api/devices", userAgent: "Mozilla/5.0", requestMethod: "GET" },
});
runCan("can() inactive user → DENIED", { allowed: false }, {
  policies,
  action: "read",
  resource: "devices",
  subject: { userId: "u4", role: "admin", isActive: false, clearanceLevel: 8, groups: [], username: "ex", email: "x@x.com", tenantId: "t1" },
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.1", hour: 10, dayOfWeek: "Monday", requestPath: "/api/devices", userAgent: "Mozilla/5.0", requestMethod: "GET" },
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers & API tests
// ────────────────────────────────────────────────────────────────────────────

header("28. HELPER METHODS");

console.log("  getAttributes('subject'):", abac.getAttributes("subject").length, "attributes");
console.log("  getAttributes('environment'):", abac.getAttributes("environment").length, "attributes");
console.log("  getAttributeLabel('subject', 'email'):", abac.getAttributeLabel("subject", "email"));
console.log("  getOperatorsFor('boolean'):", abac.getOperatorsFor("boolean").map(o => o.value).join(", "));
console.log("  getOperatorsFor('array'):", abac.getOperatorsFor("array").map(o => o.value).join(", "));
console.log("  getOperatorsFor('time'):", abac.getOperatorsFor("time").map(o => o.value).join(", "));
console.log("  getOperatorsFor('time_range'):", abac.getOperatorsFor("time_range").map(o => o.value).join(", "));
console.log("  isContextVariable('{subject.email}'):", abac.isContextVariable("{subject.email}"));
console.log("  isContextVariable('hello'):", abac.isContextVariable("hello"));
console.log("  formatValue('{subject.email}'):", abac.formatValue("{subject.email}"));
console.log("  formatValue(['Monday','Tuesday']):", abac.formatValue(["Monday", "Tuesday"]));
console.log("  contextVariables count:", abac.contextVariables.length);
console.log("  getContextVariablesFor('subject', 'tenantId'):", abac.getContextVariablesFor("subject", "tenantId").map(v => v.value).join(", "));

header("29. BUILD ENVIRONMENT CONTEXT");
const envCtx = abac.buildEnvironmentContext({ ipAddress: "10.0.0.1", requestMethod: "POST" });
console.log("  Built env context keys:", Object.keys(envCtx).join(", "));
console.log("  ipAddress (injected):", envCtx.ipAddress);
console.log("  requestMethod (injected):", envCtx.requestMethod);
console.log("  timezone (auto):", envCtx.timezone);
console.log("  hour (auto):", envCtx.hour);

header("30. RESOURCES & ACTIONS");
console.log("  Total resources:", abac.resources.length);
console.log("  Resource categories:", abac.getResourceCategories().join(", "));
console.log("  Core resources:", abac.getResources("core").map(r => r.value).join(", "));
console.log("  Monitoring resources:", abac.getResources("monitoring").map(r => r.value).join(", "));
console.log("  Administration resources:", abac.getResources("administration").map(r => r.value).join(", "));
console.log("  System resources:", abac.getResources("system").map(r => r.value).join(", "));
console.log("  Automation resources:", abac.getResources("automation").map(r => r.value).join(", "));
console.log("  Documents resources:", abac.getResources("documents").map(r => r.value).join(", "));
console.log("  Billing resources:", abac.getResources("billing").map(r => r.value).join(", "));
console.log("  getResourceLabel('devices'):", abac.getResourceLabel("devices"));
console.log("  getResourceLabel('config-alerts'):", abac.getResourceLabel("config-alerts"));
console.log("  getResourceLabel('maintenance-reports'):", abac.getResourceLabel("maintenance-reports"));
console.log("  Total actions:", abac.getActions().length);
console.log("  Actions:", abac.getActions().map(a => `${a.value}(${a.label})`).join(", "));
console.log("  getActionLabel('create'):", abac.getActionLabel("create"));
console.log("  getActionLabel('manage'):", abac.getActionLabel("manage"));

// ────────────────────────────────────────────────────────────────────────────
// New feature tests
// ────────────────────────────────────────────────────────────────────────────

header("31. DEFAULT DENY — no matching policy");
run("Unknown role, unknown resource → default deny", { allowed: false },
  { subject: { userId: "u99", role: "unknown", isActive: true }, action: "read", environment: {} }, "unknown-resource");

const abacAllowDefault = new ABAC({ defaultEffect: "allow" });
{
  const res = abacAllowDefault.evaluateAccess(policies,
    { subject: { userId: "u99", role: "unknown", isActive: true }, action: "read", environment: {} },
    "unknown-resource",
  );
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] defaultEffect: 'allow' → allowed when no policy matches | ${res.reason}`);
  if (pass) passed++; else failed++;
}

header("32. ACTIONS WILDCARD — actions: ['*']");
{
  const wildcardPolicy: Policy[] = [{
    id: "pw", name: "Wildcard Actions", resources: ["devices"], actions: ["*"],
    effect: "allow", conditions: [], conditionLogic: "AND", priority: 100, isActive: true,
  }];
  const ctx: EvaluationContext = { subject: {}, action: "delete", environment: {} };
  const res = abac.evaluateAccess(wildcardPolicy, ctx, "devices");
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] actions: ['*'] matches any action | ${res.reason}`);
  if (pass) passed++; else failed++;
}

header("33. VALIDATE POLICY (Zod)");
{
  const valid = abac.validatePolicy(policies[0]);
  console.log(`  Valid policy: valid=${valid.valid}, errors=${valid.errors.length}`);

  const invalid = abac.validatePolicy({ id: "", name: "" });
  console.log(`  Invalid (missing fields): valid=${invalid.valid}, errors=${invalid.errors.length}`);
  for (const e of invalid.errors) console.log(`    → ${e}`);
  const pass1 = valid.valid === true && invalid.valid === false && invalid.errors.length >= 4;
  console.log(`  [${pass1 ? "PASS" : "FAIL"}] Zod catches missing/invalid fields`);
  if (pass1) passed++; else failed++;

  const badCondition = abac.validatePolicy({
    id: "x", name: "x", resources: ["*"], actions: ["read"],
    effect: "allow", conditions: [{ id: "", category: "subject", attribute: { key: "", value: "", operator: "equals" } }],
    conditionLogic: "AND", priority: 100, isActive: true,
  });
  console.log(`  Bad condition: valid=${badCondition.valid}, errors=${badCondition.errors.length}`);
  for (const e of badCondition.errors) console.log(`    → ${e}`);
  const pass2 = badCondition.valid === false;
  console.log(`  [${pass2 ? "PASS" : "FAIL"}] Zod catches empty condition id & key`);
  if (pass2) passed++; else failed++;

  const garbage = abac.validatePolicy("not an object");
  const pass3 = garbage.valid === false;
  console.log(`  [${pass3 ? "PASS" : "FAIL"}] Zod rejects non-object input`);
  if (pass3) passed++; else failed++;
}

header("34. EXPLAIN ACCESS — debug details");
{
  const explanation: AccessExplanation = abac.explainAccess(policies, superAdmin, "devices");
  console.log(`  Decision: ${explanation.decision.allowed ? "ALLOWED" : "DENIED"} | ${explanation.decision.reason}`);
  console.log(`  Matched denies: ${explanation.matchedDenies.length}`);
  console.log(`  Matched allows: ${explanation.matchedAllows.length}`);
  console.log(`  Skipped:        ${explanation.skipped.length}`);
  const pass = explanation.decision.allowed === true && explanation.matchedAllows.length > 0;
  console.log(`  [${pass ? "PASS" : "FAIL"}] explainAccess returns correct structure`);
  if (pass) passed++; else failed++;
}
{
  const explanation = abac.explainAccess(policies, inactiveUser, "devices");
  const pass = explanation.decision.allowed === false && explanation.matchedDenies.length > 0;
  console.log(`  [${pass ? "PASS" : "FAIL"}] explainAccess shows deny for inactive user`);
  if (pass) passed++; else failed++;
}

header("35. TYPE COERCION — equals across types");
{
  const numPolicy: Policy[] = [{
    id: "pt1", name: "Clearance 5 String", resources: ["*"], actions: ["read"],
    effect: "allow", conditionLogic: "AND", priority: 100, isActive: true,
    conditions: [{ id: "ct1", category: "subject", attribute: { key: "clearanceLevel", value: "5", operator: "equals" } }],
  }];
  const ctx: EvaluationContext = { subject: { clearanceLevel: 5 }, action: "read", environment: {} };
  const res = abac.evaluateAccess(numPolicy, ctx, "test");
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] number 5 equals string "5" (type coercion) | ${res.reason}`);
  if (pass) passed++; else failed++;
}
{
  const boolPolicy: Policy[] = [{
    id: "pt2", name: "Active String True", resources: ["*"], actions: ["read"],
    effect: "allow", conditionLogic: "AND", priority: 100, isActive: true,
    conditions: [{ id: "ct2", category: "subject", attribute: { key: "isActive", value: "true", operator: "equals" } }],
  }];
  const ctx: EvaluationContext = { subject: { isActive: true }, action: "read", environment: {} };
  const res = abac.evaluateAccess(boolPolicy, ctx, "test");
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] boolean true equals string "true" (type coercion) | ${res.reason}`);
  if (pass) passed++; else failed++;
}

header("36. IN/NOT_IN — mixed types");
{
  const inPolicy: Policy[] = [{
    id: "pt3", name: "Clearance In String Array", resources: ["*"], actions: ["read"],
    effect: "allow", conditionLogic: "AND", priority: 100, isActive: true,
    conditions: [{ id: "ct3", category: "subject", attribute: { key: "clearanceLevel", value: ["5", "8", "10"], operator: "in" } }],
  }];
  const ctx: EvaluationContext = { subject: { clearanceLevel: 5 }, action: "read", environment: {} };
  const res = abac.evaluateAccess(inPolicy, ctx, "test");
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] number 5 'in' string array ["5","8","10"] (type coercion) | ${res.reason}`);
  if (pass) passed++; else failed++;
}

header("37. DATE COMPARISON (subject.createdAt)");
{
  const datePolicy: Policy[] = [{
    id: "pd1", name: "User Created After 2024", resources: ["*"], actions: ["read"],
    effect: "allow", conditionLogic: "AND", priority: 100, isActive: true,
    conditions: [{ id: "cd1", category: "subject", attribute: { key: "createdAt", value: "2024-01-01T00:00:00Z", operator: "greater_than" } }],
  }];
  const ctx: EvaluationContext = {
    subject: { createdAt: "2025-06-15T12:00:00Z" }, action: "read", environment: {},
  };
  const res = abac.evaluateAccess(datePolicy, ctx, "test");
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] ISO date 2025 > 2024 comparison | ${res.reason}`);
  if (pass) passed++; else failed++;
}
{
  const datePolicy: Policy[] = [{
    id: "pd2", name: "User Created Before 2024", resources: ["*"], actions: ["read"],
    effect: "deny", conditionLogic: "AND", priority: 200, isActive: true,
    conditions: [{ id: "cd2", category: "subject", attribute: { key: "createdAt", value: "2024-01-01T00:00:00Z", operator: "less_than" } }],
  }];
  const ctx: EvaluationContext = {
    subject: { createdAt: "2023-03-10T08:00:00Z" }, action: "read", environment: {},
  };
  const res = abac.evaluateAccess(datePolicy, ctx, "test");
  const pass = res.allowed === false;
  console.log(`  [${pass ? "PASS" : "FAIL"}] ISO date 2023 < 2024 deny | ${res.reason}`);
  if (pass) passed++; else failed++;
}

header("38. RESOLVE ARRAY WITH CONTEXT VARIABLES");
{
  const arrPolicy: Policy[] = [{
    id: "pa1", name: "Tenant In Array", resources: ["*"], actions: ["read"],
    effect: "allow", conditionLogic: "AND", priority: 100, isActive: true,
    conditions: [{ id: "ca1", category: "subject", attribute: { key: "tenantId", value: ["{subject.tenantId}", "t-global"], operator: "in" } }],
  }];
  const ctx: EvaluationContext = {
    subject: { tenantId: "t-123" }, action: "read", environment: {},
  };
  const res = abac.evaluateAccess(arrPolicy, ctx, "test");
  const pass = res.allowed === true;
  console.log(`  [${pass ? "PASS" : "FAIL"}] array value resolves {subject.tenantId} → "t-123" then matches | ${res.reason}`);
  if (pass) passed++; else failed++;
}

header("39. ENV ALIAS — {env.X} resolves from context.environment");
{
  const resolved = abac.resolveValue("{env.ipAddress}", {
    subject: {}, action: "read",
    environment: { ipAddress: "10.0.0.42" },
  });
  const pass = resolved === "10.0.0.42";
  console.log(`  [${pass ? "PASS" : "FAIL"}] {env.ipAddress} resolves to "10.0.0.42" from context | got: ${resolved}`);
  if (pass) passed++; else failed++;
}

header("40. CAN() SHORTHAND");
runCan("can() engineer update devices", { allowed: true }, {
  policies,
  action: "update",
  resource: "devices",
  subject: { userId: "owner1", role: "engineer", isActive: true, clearanceLevel: 8, groups: ["engineering"], username: "eng1", email: "e@digieye.com", tenantId: "t1", test: "test" },
  environment: { networkType: "internal", deviceType: "desktop", ipAddress: "192.168.1.1", hour: 10, dayOfWeek: "Monday", requestPath: "/api/devices", userAgent: "Mozilla/5.0", requestMethod: "PUT" },
});

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

header("SUMMARY");
console.log(`  Total policies: ${policies.length}`);
console.log(`  Tests passed:   ${passed}`);
console.log(`  Tests failed:   ${failed}`);
console.log(`  Result:         ${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}`);
console.log();

process.exit(failed > 0 ? 1 : 0);
