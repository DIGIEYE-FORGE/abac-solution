# @digieye/abac

`@digieye/abac` is the shared Attribute-Based Access Control engine used by Auth API to compile policies and produce portable authorization plans for platform services such as DPBE.

The package has one current contract. Policy and authorization payloads do not carry a schema discriminator. Contract changes are made directly in the shared TypeScript types and the matching Auth API/DPBE transport definitions.

## Responsibilities

The package is responsible for:

- selecting active policies for one tenant, resource, and action;
- evaluating subject and environment conditions at request time;
- converting resource conditions into portable filter ASTs;
- applying deny-overrides semantics;
- deciding concrete create/single-resource requests;
- returning `filter_required` for list or bulk requests that need service-side filtering;
- providing default request-time environment values.

The package is intentionally not responsible for:

- loading policies from PostgreSQL or cache;
- defining platform resources or resource attributes;
- validating HTTP policy payloads;
- translating filter ASTs to a database ORM;
- enforcing plans inside a service;
- rendering policy-builder metadata.

Auth API owns policy persistence, validation, compilation caching, and the dynamic platform resource catalog. DPBE owns route extraction, resource loading, Drizzle filter translation, and final enforcement.

## Runtime Flow

```text
DPBE request
  -> DPBE extracts tenant, user, resource, action, and mode
  -> Auth API loads the matching policy slice
  -> Auth API creates ABAC({ defaultEffect })
  -> ABAC.compilePolicies(...)
  -> ABAC.planCompiledAccess(...)
  -> Auth API returns AuthorizationPlan
  -> DPBE allows, denies, or applies include/exclude filters
```

A compiled set is scoped to exactly one:

```text
tenant + resource + action
```

This keeps policy evaluation deterministic and makes compiled sets safe to cache under an equivalent scoped key.

## Installation

The local Auth API workspace links this package through its package dependency. Build the package after changing its public types or runtime implementation:

```bash
pnpm install
pnpm build
```

## Public API

The package entry point exports:

- `ABAC`
- policy and condition types
- compiled policy types
- authorization plan types
- filter AST types
- environment resolver configuration types

Low-level operator, resolver, and AST-builder functions are internal implementation details. Consumers should use the `ABAC` class so the compilation and decision semantics remain consistent.

## Basic Use

```ts
import { ABAC, type Policy } from "@digieye/abac";

const policies: Policy[] = [
  {
    id: "allow-device-owner",
    name: "Owners can update their devices",
    resources: ["devices"],
    actions: ["update"],
    effect: "allow",
    conditionLogic: "AND",
    priority: 200,
    isActive: true,
    conditions: [
      {
        id: "owner-match",
        category: "resource",
        attribute: {
          key: "ownerId",
          operator: "equals",
          value: "{subject.userId}",
        },
      },
    ],
  },
];

const abac = new ABAC({ defaultEffect: "deny" });
const compiled = abac.compilePolicies({
  policies,
  tenantId: "tenant-a",
  resource: "devices",
  action: "update",
});

const plan = abac.planCompiledAccess({
  compiledPolicySet: compiled,
  requestId: "request-123",
  tenantId: "tenant-a",
  userId: "user-7",
  resource: "devices",
  action: "update",
  mode: "single",
  subject: {
    userId: "user-7",
    tenantId: "tenant-a",
    email: "owner@example.com",
  },
  environment: abac.buildEnvironmentContext({
    requestMethod: "PATCH",
    requestPath: "/api/v1/devices/device-1",
  }),
  resourceContext: {
    id: "device-1",
    ownerId: "user-7",
    tenantId: "tenant-a",
  },
});
```

## Policy Contract

```ts
type Policy = {
  id: string;
  name: string;
  description?: string;
  resources: string[];
  actions: string[];
  effect: "allow" | "deny";
  conditions: PolicyCondition[];
  conditionLogic: "AND" | "OR";
  priority: number;
  isActive: boolean;
};
```

Each condition reads from one context category:

- `subject`: authenticated user and tenant facts supplied by Auth API;
- `environment`: request-time facts such as time, method, path, and IP;
- `resource`: row/object facts supplied by the consuming service.

Supported operators are:

```text
equals
not_equals
contains
not_contains
in
not_in
greater_than
less_than
greater_than_or_equal
less_than_or_equal
starts_with
ends_with
regex
between
```

Context references use braces:

```text
{subject.userId}
{subject.tenantId}
{resource.ownerId}
{environment.requestMethod}
{env.currentHHMM}
```

Unresolved values and missing resource fields fail closed for matching conditions.

## Environment Context

`buildEnvironmentContext(extra)` creates default clock values and merges request-specific values over them. Built-in facts include:

- current ISO date/time;
- current date;
- day of week;
- current `HH:MM` time;
- runtime timezone.

Services should supply request facts explicitly:

```ts
const environment = abac.buildEnvironmentContext({
  ipAddress: req.ip,
  requestMethod: req.method,
  requestPath: req.path,
  userAgent: req.headers["user-agent"],
  tenantTimezone,
  licenseStatus,
});
```

Custom resolvers can replace defaults by key through `ABACConfig.environmentResolvers`.

## Authorization Plan

```ts
type AuthorizationPlan = {
  requestId: string;
  tenantId: string;
  userId: string;
  resource: string;
  action: string;
  mode: "single" | "list" | "create" | "bulk";
  decision: "allow" | "deny" | "filter_required";
  reason: string;
  includeFilter: FilterGroup | FilterNode | null;
  excludeFilter: FilterGroup | FilterNode | null;
  defaultEffect: "allow" | "deny";
  policyIds: string[];
};
```

Decision handling:

- `allow`: continue the operation;
- `deny`: return the service's professional permission-denied response;
- `filter_required`: translate and apply both filter ASTs before reading or mutating rows.

`includeFilter` selects rows matched by allow policies. `excludeFilter` removes rows matched by deny policies. A service must never ignore filters when the decision is `filter_required`.

## Conflict Semantics

Deny overrides allow. When matching allow and deny policies have the same priority and target the same request, the deny result wins.

Priority determines policy ordering but does not let an allow bypass a matching deny. Inactive policies and policies outside the compiled resource/action slice are excluded.

Mixed condition connectors are evaluated in stored order. For example:

```text
condition A
OR condition B
AND condition C
```

is evaluated as:

```text
(A OR B) AND C
```

## Bulk Behavior

The package does not delete or update rows. For bulk operations it returns filters and `filter_required`. The consuming service must apply those filters to the mutation query so allowed rows can be changed while protected rows remain untouched.

A service may choose an all-or-nothing product behavior, but that policy must be implemented explicitly in the enforcement layer after obtaining the plan.

## Validation Boundary

Auth API validates incoming policy payloads and checks dynamic resource attributes before persistence. Keeping that validation at the API boundary avoids maintaining a second, drifting Zod schema inside this package.

The ABAC package receives typed policies from Auth API and focuses only on compilation and planning.

## Source Layout

```text
src/
  abac.ts                 Public compiled-policy engine and decision planner
  index.ts                Public package exports
  types/index.ts          Shared policy, compiled-set, filter, and plan contracts
  config/defaults.ts      Built-in environment resolvers
  utils/ast-builder.ts    Policy selection and filter AST construction
  utils/operators.ts      Condition comparison semantics
  utils/resolver.ts       Context-reference resolution
  utils/functions.ts      Time parsing and formatting helpers
  utils/logger.ts         Structured ABAC diagnostics
examples/
  test.ts                 Functional policy and planning scenarios
  run-test.ts             Quiet executable wrapper for the functional suite
  breakpoint-test.ts      Operators, conflicts, bulk behavior, and 1,000-case stress matrix
```

## Verification

Run the package compiler and both executable suites:

```bash
pnpm build
pnpm test
```

For stricter dead-code checks:

```bash
pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters
```