# @digieye/abac

Platform-agnostic **Attribute-Based Access Control** (ABAC) engine for TypeScript/JavaScript.

`@digieye/abac` compiles policies into V3 execution plans, produces SQL filter ASTs for list/create paths, and performs batch row-level verification. The runtime rollout uses `PlanABAC` + `BatchEvaluateABAC` instead of the removed legacy point-in-time APIs.

## Installation

```bash
pnpm add @digieye/abac
```

## Quick Start

```typescript
import { ABAC, type Policy, toSql } from "@digieye/abac";

const abac = new ABAC();

const policies: Policy[] = [
  {
    id: "allow-read-devices",
    name: "Allow engineers to read tenant devices",
    resources: ["devices"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      {
        id: "tenant-match",
        category: "subject",
        attribute: { key: "tenantId", value: "{resource.tenantId}", operator: "equals" },
      },
      {
        id: "role-engineer",
        category: "subject",
        attribute: { key: "role", value: "engineer", operator: "equals" },
      },
    ],
    conditionLogic: "AND",
    priority: 100,
    isActive: true,
  },
];

const compiled = abac.compilePolicies({
  policies,
  tenantId: "tenant-1",
  resource: "devices",
  action: "read",
  knownResourceFields: new Set(["tenantId", "status", "ownerId"]),
});

const plan = abac.planCompiledAccess({
  compiledPolicySet: compiled,
  requestId: "req-1",
  tenantId: "tenant-1",
  userId: "user-1",
  resource: "devices",
  action: "read",
  mode: "list",
  subject: { userId: "user-1", role: "engineer", tenantId: "tenant-1" },
  environment: { ipAddress: "10.0.0.1" },
});

console.log(plan.decision);
// "filter_required" when SQL filters and residual verification are required

if (plan.includeFilter) {
  const sql = toSql(plan.includeFilter);
  console.log(sql.sql, sql.params);
}
```

## V3 Runtime Flow

1. Load or fetch policies for the tenant/resource/action.
2. Validate policy objects with `validatePolicy()`.
3. Compile policies with `compilePolicies()`.
4. Build a V3 authorization plan with `planCompiledAccess()`.
5. Apply `includeFilter` and `excludeFilter` to SQL/list queries.
6. Verify residual conditions in application code when `requiresVerification` is `true`.
7. Use `batchEvaluate()` for row-level verification after candidate rows are selected.

The V3 plan shape is:

```typescript
{
  schemaVersion: 3,
  requestId: string,
  tenantId: string,
  userId: string,
  resource: string,
  action: string,
  mode: "single" | "list" | "create" | "bulk",
  decision: "allow" | "deny" | "filter_required",
  reason: string,
  includeFilter: FilterNode | FilterGroup | null,
  excludeFilter: FilterNode | FilterGroup | null,
  residualFields: string[],
  requiresVerification: boolean,
  residualConditions: ResidualCondition[],
  hasUnconditionalAllow: boolean,
  defaultEffect: "allow" | "deny",
  policyIds: string[],
  warnings: string[],
  authDbMetrics: string,
  planLatencyMs: number,
}
```

## API Reference

### Constructor

```typescript
const abac = new ABAC(config?: ABACConfig);
```

All config fields are optional. Defaults are provided for subject/environment/resource attributes, operators, resources, actions, and environment resolvers.

```typescript
interface ABACConfig {
  attributes?: {
    subject?: AttributeDefinition[];
    environment?: AttributeDefinition[];
    resource?: AttributeDefinition[];
  };
  operators?: OperatorConfig[];
  environmentResolvers?: EnvironmentResolver[];
  resources?: ResourceConfig[];
  actions?: ActionConfig[];
  defaultEffect?: "allow" | "deny"; // default: "deny"
}
```

### `validatePolicy(policy)`

Validates a policy object before storing or compiling it.

```typescript
const result = abac.validatePolicy(unknownObject);
// { valid: boolean, errors: string[] }
```

### `compilePolicies(params)`

Compiles active policies for a tenant/resource/action into a V3 policy set.

```typescript
const compiled = abac.compilePolicies({
  policies,
  tenantId: "tenant-1",
  resource: "devices",
  action: "read",
  knownResourceFields: new Set(["tenantId", "ownerId", "status"]),
});
```

The compiled set separates allow and deny policies, records SQL capability, and keeps residual conditions that cannot be pushed to SQL.

### `planCompiledAccess(params)`

Creates a V3 authorization plan from a compiled policy set.

```typescript
const plan = abac.planCompiledAccess({
  compiledPolicySet: compiled,
  requestId: "req-1",
  tenantId: "tenant-1",
  userId: "user-1",
  resource: "devices",
  action: "read",
  mode: "list",
  subject: { userId: "user-1", role: "engineer", tenantId: "tenant-1" },
  environment: { ipAddress: "10.0.0.1" },
});
```

Decision behavior:

- `allow`: access is allowed without row filters.
- `deny`: access is denied.
- `filter_required`: apply generated filters and perform residual verification before returning or mutating rows.

Create-mode decisions prioritize deny matches, then residual verification, then include-filter verification against the candidate resource context.

### `batchEvaluate(params)`

Evaluates candidate rows after list filtering.

```typescript
const response = abac.batchEvaluate({
  requestId: "req-1",
  tenantId: "tenant-1",
  userId: "user-1",
  resource: "devices",
  action: "read",
  mode: "list",
  subject: { userId: "user-1", role: "engineer", tenantId: "tenant-1" },
  environment: { ipAddress: "10.0.0.1" },
  rows: [
    {
      resourceId: "device-1",
      resourceContext: { tenantId: "tenant-1", ownerId: "user-1", status: "active" },
    },
  ],
  policies,
});
```

Response:

```typescript
{
  requestId: string,
  decisions: [
    {
      resourceId: string,
      allowed: boolean,
      reason: string,
      matchedPolicyId?: string,
      matchedPolicyName?: string,
      matchedPolicyEffect?: "allow" | "deny",
    },
  ],
  requiresFurtherVerification: boolean,
  warnings: string[],
  authDbMetrics: string,
  verificationLatencyMs: number,
}
```

### `buildFilterResult(params)`

Builds include/exclude filter ASTs from raw policies.

```typescript
import { buildFilterResult } from "@digieye/abac";

const result = buildFilterResult({
  policies,
  context: {
    subject: { userId: "user-1", role: "engineer", tenantId: "tenant-1" },
    action: "read",
    environment: { ipAddress: "10.0.0.1" },
    resource: { tenantId: "tenant-1" },
  },
  targetResource: "devices",
  knownResourceFields: new Set(["tenantId", "ownerId", "status"]),
  defaultEffect: "deny",
});
```

The result contains:

- `includeFilter`: SQL-capable allow filters.
- `excludeFilter`: SQL-capable deny filters.
- `requiresVerification`: whether residual conditions remain.
- `residualConditions`: conditions that must be checked outside SQL.
- `policyIds`, `warnings`, and `defaultEffect`.

### `toSql(filter)`

Translates a `FilterNode` or `FilterGroup` into a parameterized SQL fragment.

```typescript
import { toSql } from "@digieye/abac";

const fragment = toSql(plan.includeFilter);
console.log(fragment.sql); // "tenantId" = $1
console.log(fragment.params); // ["tenant-1"]
```

For deny filters, use `excludeToSqlParts(excludeFilter)` and apply each returned fragment as an independent `NOT(...)` veto. Do not wrap the whole exclude filter in one `NOT(...)`.

## Policy

A policy is the central unit. It defines who, what, how, and when.

| Field            | Type               | Description                                      |
| ---------------- | ------------------ | ------------------------------------------------ |
| `id`             | `string`           | Unique identifier                                |
| `name`           | `string`           | Human-readable name                              |
| `resources`      | `string[]`         | Target resources, e.g. `["devices"]`             |
| `actions`        | `string[]`         | Target actions, e.g. `["read", "update"]`        |
| `effect`         | `"allow" \| "deny"` | Whether this policy allows or denies             |
| `conditions`     | `PolicyCondition[]` | Attribute conditions that must be met            |
| `conditionLogic` | `"AND" \| "OR"`    | How conditions combine                           |
| `priority`       | `number`           | Higher = stronger                                |
| `isActive`       | `boolean`          | Inactive policies are skipped                    |

Use `resources: ["*"]` and `actions: ["*"]` for wildcard matching.

## Condition Categories

Each condition targets one of three attribute categories:

| Category        | What it checks                | Example                                       |
| --------------- | ----------------------------- | --------------------------------------------- |
| **subject**     | The authenticated user        | `role equals "admin"`                         |
| **resource**    | The target resource           | `tags contains "critical"`                    |
| **environment** | Request context               | `ipAddress in ["10.0.0.0/8"]`                 |

## Operators

| Operator                 | Types              | Description                      |
| ------------------------ | ------------------ | -------------------------------- |
| `equals`                 | all                | Loose equality                   |
| `not_equals`             | all                | Negation of equals               |
| `contains`               | string, array      | Substring or array member check  |
| `not_contains`           | string, array      | Negation of contains             |
| `in`                     | string, number     | Value exists in a list           |
| `not_in`                 | string, number     | Value not in a list              |
| `greater_than`           | number, date       | `>`                              |
| `less_than`              | number, date       | `<`                              |
| `greater_than_or_equal`  | number, date       | `>=`                             |
| `less_than_or_equal`     | number, date       | `<=`                             |
| `starts_with`            | string             | Prefix match                     |
| `ends_with`              | string             | Suffix match                     |
| `regex`                  | string             | Regular expression test          |

## Context Variables

Condition values can reference runtime data using `{prefix.key}` syntax:

| Variable              | Resolves to                           |
| --------------------- | ------------------------------------- |
| `{subject.tenantId}`  | `context.subject.tenantId`            |
| `{subject.userId}`    | `context.subject.userId`              |
| `{resource.ownerId}`  | `context.resource.ownerId`            |
| `{env.now}`           | Current ISO date-time                 |
| `{env.dayOfWeek}`     | Current day name                      |
| `{env.hour}`          | Current hour, 0-23                    |
| `{env.date}`          | Today in `YYYY-MM-DD`                 |
| `{env.ipAddress}`     | Client IP                             |

```typescript
{
  id: "tenant-isolation",
  category: "subject",
  attribute: {
    key: "tenantId",
    value: "{resource.tenantId}",
    operator: "equals",
  },
}
```

## Environment Resolvers

Built-in resolvers compute values like `env.now`, `env.dayOfWeek`, and `env.hour`. Platform-specific values must be injected into `environment`.

```typescript
const context = {
  subject: { userId: "user-1", role: "admin", tenantId: "tenant-1" },
  action: "read",
  environment: {
    ipAddress: req.ip,
    requestMethod: req.method,
    requestPath: req.path,
    userAgent: req.headers["user-agent"],
  },
  resource: { tenantId: "tenant-1" },
};
```

## Attribute and Operator Helpers

The ABAC instance also exposes UI/config helpers:

```typescript
abac.getAttributes("subject");
abac.getAttribute("environment", "dayOfWeek");
abac.getOperatorsFor("array");
abac.getOperatorsFor("string", "workHoursRange");
abac.getContextVariablesFor("subject", "tenantId");
abac.getResources("core");
abac.getResourceCategories();
abac.getActions();
```

## Default Resources

The package ships with common backend resources grouped by category:

| Category         | Resources                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| core             | devices, device-profiles, assets, asset-profiles, groups, tags, telemetries |
| monitoring       | alerts, config-alerts, dashboards, widgets                             |
| automation       | workflows, data-converters                                             |
| administration   | users, tenants, roles, permissions, policies                           |
| system           | protocols, credentials, firmwares, tokens, webhooks, licenses, settings, logs |
| documents        | documents, report-templates, maintenance-reports                       |
| billing          | payment-methods                                                        |

Override with `new ABAC({ resources: [...] })`.

## Default Actions

`create`, `read`, `update`, `delete`, `execute`, `manage`

Override with `new ABAC({ actions: [...] })`.

## Usage Examples

### Tenant Isolation

```typescript
const tenantPolicy: Policy = {
  id: "tenant-isolation",
  name: "Users can only access their own tenant",
  resources: ["*"],
  actions: ["*"],
  effect: "allow",
  conditions: [
    {
      id: "c1",
      category: "subject",
      attribute: { key: "tenantId", value: "{resource.tenantId}", operator: "equals" },
    },
  ],
  conditionLogic: "AND",
  priority: 100,
  isActive: true,
};
```

### Role + Resource Condition

```typescript
const policy: Policy = {
  id: "engineer-critical",
  name: "Engineers can read critical devices",
  resources: ["devices"],
  actions: ["read"],
  effect: "allow",
  conditions: [
    {
      id: "role",
      category: "subject",
      attribute: { key: "role", value: "engineer", operator: "equals" },
    },
    {
      id: "critical",
      category: "resource",
      attribute: { key: "tags", value: "critical", operator: "contains" },
    },
  ],
  conditionLogic: "AND",
  priority: 100,
  isActive: true,
};
```

### Deny Filter

```typescript
const denyPolicy: Policy = {
  id: "deny-inactive-devices",
  name: "Deny inactive devices",
  resources: ["devices"],
  actions: ["read"],
  effect: "deny",
  conditions: [
    {
      id: "inactive",
      category: "resource",
      attribute: { key: "status", value: "inactive", operator: "equals" },
    },
  ],
  conditionLogic: "AND",
  priority: 500,
  isActive: true,
};
```

## Performance

The engine is optimized for V3 planning and SQL pushdown:

- Active policies are filtered by tenant/resource/action before planning.
- SQL-capable allow and deny conditions are compiled into filter ASTs.
- Deny filters are represented as independent veto fragments.
- Residual conditions are returned explicitly for runtime verification.
- Context variable resolution is reused through environment resolvers.
- Regex patterns are compiled and cached.

## Building

```bash
pnpm build
```

## Testing

```bash
pnpm test
```

The test suite covers operators, condition logic, context variables, deny filters, wildcards, validation, V3 planning, batch evaluation, and SQL translation.

## License

ISC
