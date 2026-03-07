# @digieye/abac

Platform-agnostic **Attribute-Based Access Control** (ABAC) engine for TypeScript/JavaScript.

Define policies with fine-grained conditions on **who** (subject), **what** (resource), **how** (action), and **when** (environment) -- then evaluate access decisions at runtime.

## Installation

```bash
pnpm add @digieye/abac
```

## Quick Start

```typescript
import { ABAC, type Policy } from "@digieye/abac";

const abac = new ABAC();

const policies: Policy[] = [
  {
    id: "allow-read-devices",
    name: "Allow engineers to read devices",
    resources: ["devices"],
    actions: ["read"],
    effect: "allow",
    conditions: [
      {
        id: "c1",
        category: "subject",
        attribute: { key: "role", value: "engineer", operator: "equals" },
      },
    ],
    conditionLogic: "AND",
    priority: 100,
    isActive: true,
  },
];

const decision = abac.can({
  policies,
  action: "read",
  resource: "devices",
  subject: { role: "engineer", tenantId: "t1" },
});

console.log(decision);
// { allowed: true, reason: "Allowed by policy: Allow engineers to read devices", matchedPolicy: ... }
```

### Policy

A policy is the central unit. It defines:

| Field            | Type               | Description                                      |
| ---------------- | ------------------ | ------------------------------------------------ |
| `id`             | `string`           | Unique identifier                                |
| `name`           | `string`           | Human-readable name                              |
| `resources`      | `string[]`         | Target resources (e.g. `["devices", "assets"]`)  |
| `actions`        | `string[]`         | Allowed actions (e.g. `["read", "update"]`)      |
| `effect`         | `"allow" \| "deny"` | Whether this policy allows or denies             |
| `conditions`     | `PolicyCondition[]` | Attribute conditions that must be met            |
| `conditionLogic` | `"AND" \| "OR"`    | How conditions combine                           |
| `priority`       | `number`           | Higher = stronger (evaluated first)              |
| `isActive`       | `boolean`          | Inactive policies are skipped                    |

Use `resources: ["*"]` and `actions: ["*"]` for wildcard matching.

### Condition Categories

Each condition targets one of three attribute categories:

| Category        | What it checks                | Example                                       |
| --------------- | ----------------------------- | --------------------------------------------- |
| **subject**     | The authenticated user        | `role equals "admin"`                         |
| **resource**    | The target resource           | `tags contains "critical"`                    |
| **environment** | Request context (time, IP...) | `dayOfWeek in ["Monday", "Friday"]`           |

### Operators

| Operator                 | Types              | Description                      |
| ------------------------ | ------------------ | -------------------------------- |
| `equals`                 | all                | Loose equality (type-coercing)   |
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

### Deny-Overrides Algorithm

When `evaluateAccess` is called:

1. Policies are sorted by `priority` descending (highest first).
2. Each policy is evaluated **once** in a single pass.
3. If **any** matching deny is found, access is **denied** immediately.
4. If no deny is found but an allow matched, access is **allowed**.
5. If nothing matched, the `defaultEffect` applies (default: `"deny"`).

This means deny always wins over allow, regardless of priority.

## API Reference

### Constructor

```typescript
const abac = new ABAC(config?: ABACConfig);
```

All config fields are optional. Defaults are provided for everything.

```typescript
interface ABACConfig {
  attributes?: {
    subject?: AttributeDefinition[];
    environment?: AttributeDefinition[];
  };
  operators?: OperatorConfig[];
  environmentResolvers?: EnvironmentResolver[];
  resources?: ResourceConfig[];
  actions?: ActionConfig[];
  defaultEffect?: "allow" | "deny"; // default: "deny"
}
```

### Evaluation Methods

#### `can(params)` -- Quick access check

```typescript
const decision = abac.can({
  policies,
  action: "update",
  resource: "devices",
  subject: { userId: "u1", role: "admin", tenantId: "t1" },
  environment: { ipAddress: "10.0.0.1" },                 // optional, auto-built if omitted
});
// Returns: { allowed: boolean, reason: string, matchedPolicy?: Policy }
```

#### `evaluateAccess(policies, context, targetResource)` -- Full control

```typescript
const context: EvaluationContext = {
  subject: { userId: "u1", role: "viewer" },
  resource: { type: "dashboards", ownerId: "u1" },
  action: "read",
  environment: abac.buildEnvironmentContext({ ipAddress: req.ip }),
};

const decision = abac.evaluateAccess(policies, context, "dashboards");
```

#### `explainAccess(policies, context, targetResource)` -- Debugging

Returns the full breakdown of which policies matched (deny/allow) and which were skipped.

```typescript
const explanation = abac.explainAccess(policies, context, "devices");
// {
//   decision: { allowed: false, reason: "Denied by policy: ...", matchedPolicy: ... },
//   matchedDenies: [Policy, ...],
//   matchedAllows: [Policy, ...],
//   skipped: [Policy, ...],
// }
```

#### `evaluatePolicy(policy, context, targetResource)` -- Single policy

Returns `true` if the policy matches the context (resource + action + conditions).

#### `evaluateCondition(condition, context)` -- Single condition

Returns `true` if one condition is satisfied.

### Validation

```typescript
const result = abac.validatePolicy(unknownObject);
// { valid: boolean, errors: string[] }
```

Uses Zod schemas internally. Validates structure, types, required fields, and operator values.

### Context Variables

Condition values can reference runtime data using `{prefix.key}` syntax:

| Variable              | Resolves to                           |
| --------------------- | ------------------------------------- |
| `{subject.tenantId}`  | `context.subject.tenantId`            |
| `{subject.userId}`    | `context.subject.userId`              |
| `{resource.ownerId}`  | `context.resource.ownerId`            |
| `{env.now}`           | Current ISO date-time                 |
| `{env.dayOfWeek}`     | Current day name (e.g. "Monday")      |
| `{env.hour}`          | Current hour (0-23)                   |
| `{env.date}`          | Today in YYYY-MM-DD                   |
| `{env.ipAddress}`     | Client IP (platform-injected)         |

Context variables for `subject` and `resource` are **auto-generated** from attribute definitions. Environment variables come from resolvers.

```typescript
// Example: condition that checks tenant isolation
{
  id: "c1",
  category: "subject",
  attribute: {
    key: "tenantId",
    value: "{resource.tenantId}",  // resolves at runtime
    operator: "equals",
  },
}
```

### Environment Resolvers

Built-in resolvers auto-compute values like `env.now`, `env.dayOfWeek`, `env.hour`. Platform-specific values (IP, user agent, etc.) must be injected:

```typescript
// Backend (Express)
const env = abac.buildEnvironmentContext({
  ipAddress: req.ip,
  requestMethod: req.method,
  requestPath: req.path,
  userAgent: req.headers["user-agent"],
  deviceType: "api",
});

const context: EvaluationContext = {
  subject: { ...user },
  resource: { type: "devices" },
  action: "read",
  environment: env,
};
```

You can override any resolver by passing `environmentResolvers` in the config:

```typescript
const abac = new ABAC({

  environmentResolvers: [
    {
      key: "env.ipAddress",
      label: "Client IP",
      forAttributeKeys: ["ipAddress"],
      resolve: () => getClientIp(), // your custom logic
    },

  ],
});
```

### Attribute & Operator Helpers (for UI)

```typescript
// Get all subject attributes
abac.getAttributes("subject");

// Get one attribute definition
abac.getAttribute("environment", "dayOfWeek");

// Get operators filtered by value type
abac.getOperatorsFor("array");          // in, not_in, contains, not_contains
abac.getOperatorsFor("boolean");        // equals, not_equals
abac.getOperatorsFor("string");         // equals, not_equals, contains, starts_with, ...
abac.getOperatorsFor("string", "workHoursRange"); // equals, not_equals only

// Get context variables for a condition input
abac.getContextVariablesFor("subject", "tenantId");

// Resources and actions
abac.getResources("core");             // devices, assets, groups, ...
abac.getResourceCategories();           // ["core", "monitoring", "administration", ...]
abac.getActions();                      // create, read, update, delete, execute, manage
```

### Default Resources

The package ships with resources mapped to common backend models, grouped by category:

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

### Default Actions

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

### Time-Based Access

```typescript
const workHoursOnly: Policy = {
  id: "work-hours",
  name: "Block access outside work hours",
  resources: ["*"],
  actions: ["*"],
  effect: "deny",
  conditions: [
    {
      id: "c1",
      category: "environment",
      attribute: { key: "workHoursRange", value: "08:00-18:00", operator: "not_equals" },
    },
  ],
  conditionLogic: "AND",
  priority: 500,
  isActive: true,
};
```

### Role + Resource Condition (AND)

```typescript
const policy: Policy = {
  id: "engineer-critical",
  name: "Engineers can read critical devices",
  resources: ["devices"],
  actions: ["read"],
  effect: "allow",
  conditions: [
    {
      id: "c1",
      category: "subject",
      attribute: { key: "role", value: "engineer", operator: "equals" },
    },
    {
      id: "c2",
      category: "resource",
      attribute: { key: "tags", value: "critical", operator: "contains" },
    },
  ],
  conditionLogic: "AND",
  priority: 100,
  isActive: true,
};
```

### IP Whitelist (OR logic)

```typescript
const ipPolicy: Policy = {
  id: "ip-whitelist",
  name: "Allow from office or VPN",
  resources: ["*"],
  actions: ["*"],
  effect: "allow",
  conditions: [
    {
      id: "c1",
      category: "environment",
      attribute: { key: "ipAddress", value: ["10.0.0.0/8"], operator: "in" },
    },
    {
      id: "c2",
      category: "environment",
      attribute: { key: "networkType", value: "vpn", operator: "equals" },
    },
  ],
  conditionLogic: "OR",
  priority: 200,
  isActive: true,
};
```

## Performance

The engine is optimized for fast evaluation:

- **O(1) attribute lookups** via pre-built Maps (per category)
- **O(1) environment resolver lookups** via Map instead of linear scan
- **Cached operator filters** -- `getOperatorsFor` results are memoized
- **Cached regex patterns** -- compiled `RegExp` objects are reused (capped at 100)
- **Short-circuit evaluation** -- AND stops at first `false`, OR stops at first `true`
- **Single-pass policy evaluation** -- `evaluateAccess` iterates policies once (not twice)
- **Lazy context variables** -- computed once on first access, then cached

## Building

```bash
pnpm build    # outputs to dist/
```

## Testing

```bash
npx tsx examples/test.ts
```

The test file contains 63 tests covering all operators, condition logic, context variables, deny-overrides, wildcards, validation, work hours, and edge cases.

## License

ISC
