# ABAC Lifecycle

This document explains the end-to-end ABAC request lifecycle for list/collection authorization, starting from the first DPBE request code through Auth API gRPC, the `abac-solution-main` partial evaluator, the returned response, and the final DPBE SQL execution.

It focuses on the current code paths for `PartialEvaluateABAC`, `include_filter`, `exclude_filter`, `requires_verification`, `residual_conditions`, `warnings`, and how DPBE turns the response into a SQL `WHERE` clause.

---

## 1. High-level flow

For a list request such as:

```text
GET /api/v1/devices
```

the lifecycle is:

```text
Browser / API client
  ↓
DPBE Express route
  ↓
DPBE authenticate middleware
  ↓
DPBE multiTenantAccess middleware
  ↓
DPBE authorizeAccess middleware
  ↓
DPBE extracts authorization request
  ↓
DPBE loads resource context, if any
  ↓
DPBE service calls partialEvaluateAuthorization()
  ↓
DPBE gRPC client calls Auth API PartialEvaluateABAC
  ↓
Auth API loads policies from DB
  ↓
Auth API calls abac.partialEvaluate()
  ↓
abac-solution-main builds includeFilter / excludeFilter
  ↓
Auth API returns PartialEvalABACResponse
  ↓
DPBE parses JSON filters
  ↓
DPBE builds AuthorizationPlan
  ↓
DPBE translates filters to SQL
  ↓
PostgreSQL returns candidate rows
  ↓
DPBE verifies rows if required
  ↓
API response to user
```

---

## 2. Main files and what they do

| Layer | File | Main function | Responsibility |
|---|---|---|---|
| DPBE auth | `DPBE-main/src/shared/middleware/auth.ts` | `authenticate()` | Validates JWT and injects user/tenant into request. |
| DPBE tenant | `DPBE-main/src/shared/middleware/multi-tenant-access.ts` | `multiTenantAccess()` | Resolves effective tenant and accessible tenant IDs. |
| DPBE request mapping | `DPBE-main/src/shared/authz/request-mapping.ts` | `getResourceFromPath()`, `getResourceIdFromPath()`, `getActionFromRequest()` | Converts HTTP path/method into resource/action. |
| DPBE auth middleware | `DPBE-main/src/shared/middleware/role-access.ts` | `authorizeAccess()` | Builds subject/environment/resource context and calls Auth API ABAC. |
| DPBE resource context | `DPBE-main/src/shared/utils/resource-loader.ts` | `loadResourceContext()` | Loads row fields needed by resource ABAC conditions. |
| DPBE gRPC client | `DPBE-main/src/config/grpc-client.ts` | `partialEvaluateABAC()` | Calls Auth API `PartialEvaluateABAC` gRPC method. |
| DPBE authz client | `DPBE-main/src/shared/authz/abac-client.ts` | `partialEvaluateAuthorization()` | Wraps gRPC response into `PartialEvaluateResponse`. |
| Auth API gRPC | `auth-api-main/src/grpc/handlers.ts` | `partialEvaluateABAC()` | Loads policies, builds context, calls ABAC partial evaluator. |
| ABAC engine | `abac-solution-main/src/abac.ts` | `ABAC.partialEvaluate()` | Starts partial evaluation. |
| ABAC AST builder | `abac-solution-main/src/utils/ast-builder.ts` | `buildFilterResult()` | Builds include/exclude filters and residuals. |
| ABAC SQL translator | `abac-solution-main/src/utils/sql-translator.ts` | `toSql()`, `excludeToSqlParts()` | Converts filter AST to SQL fragments. |
| DPBE planner | `DPBE-main/src/shared/authz/planner.ts` | `buildDevicesAuthPlan()`, `buildDevicesAuthWhereClauseFromPlan()` | Builds authorization plan and WHERE clause. |
| DPBE filter translator | `DPBE-main/src/shared/authz/filter-to-drizzle.ts` | `filterToSql()`, `excludeFilterToSqlParts()`, `combineWhere()` | Maps ABAC fields to Drizzle/PostgreSQL columns. |
| Devices service | `DPBE-main/src/routes/devices/devices.service.ts` | `getAllDevices()` | Applies final SQL filters and returns results. |

---

## 3. First request handling in DPBE

### 3.1 Authentication

File: `DPBE-main/src/shared/middleware/auth.ts`.

Function:

```ts
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => { ... }
```

Location: `DPBE-main/src/shared/middleware/auth.ts:26`.

What it does:

1. Reads `Authorization: Bearer ...` or `accessToken` cookie.
2. Calls Auth API `ValidateToken` through gRPC.
3. If token is invalid, it throws unauthorized.
4. If token is valid, it writes user data into `req.user`:

```ts
req.user = {
  id: user.id,
  email: user.email,
  username: user.username,
  role: user.roleId,
  roleId: user.roleId,
  isActive: user.isActive,
  tenantId: user.tenantId || null,
};
```

Location: `DPBE-main/src/shared/middleware/auth.ts:70`.

5. It injects tenant context into query/body/header depending on HTTP method.

For `GET`, it injects tenant into query:

```ts
if (req.method === "GET") {
  const newQuery = { ...req.query, tenantId: effectiveTenantId };
  Object.defineProperty(req, "query", {
    value: newQuery,
    writable: true,
    configurable: true,
  });
}
```

Location: `DPBE-main/src/shared/middleware/auth.ts:84`.

---

### 3.2 Tenant resolution

File: `DPBE-main/src/shared/middleware/multi-tenant-access.ts`.

Function:

```ts
export const multiTenantAccess = async (req: Request, _res: Response, next: NextFunction) => { ... }
```

Location: `DPBE-main/src/shared/middleware/multi-tenant-access.ts:16`.

It sets the effective tenant:

```ts
(req as any).effectiveTenantId = tenantId;
```

For cross-tenant reads, it also sets:

```ts
(req as any).accessibleTenantIds = accessibleIds;
```

Location: `DPBE-main/src/shared/middleware/multi-tenant-access.ts:57`.

This tenant becomes the `tenant_id` sent to Auth API partial evaluation.

---

### 3.3 Request authorization middleware

File: `DPBE-main/src/shared/middleware/role-access.ts`.

Function:

```ts
export const authorizeAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => { ... }
```

Location: `DPBE-main/src/shared/middleware/role-access.ts:231`.

For collection/list requests, this middleware mostly prepares the request context. The actual list SQL filter is applied later by the service using partial evaluation.

The middleware extracts:

```ts
const path = getRequestPath(req);
const resource = getResourceFromPath(path);
const resourceId = getResourceIdFromPath(path);
const action = getActionFromRequest(req.method, path);
```

Location: `DPBE-main/src/shared/middleware/role-access.ts:247`.

It builds subject context:

```ts
const subject: Record<string, string> = {
  userId: user.id,
  email: user.email,
  username: user.username,
  role: user.role ?? user.roleId ?? "",
  tenantId: user.tenantId ?? "",
  isActive: String(user.isActive ?? true),
};
```

Location: `DPBE-main/src/shared/middleware/role-access.ts:257`.

It builds environment context:

```ts
const environment: Record<string, string> = {
  ipAddress: req.ip || "",
  requestMethod: req.method,
  requestPath: path,
  userAgent: req.headers["user-agent"] || "",
};
```

Location: `DPBE-main/src/shared/middleware/role-access.ts:266`.

It loads resource context:

```ts
const resourceContext = await loadResourceContext(resource, resourceId);
```

Location: `DPBE-main/src/shared/middleware/role-access.ts:296`.

For `GET /api/v1/devices`, `resourceId` is undefined, so `loadResourceContext()` returns `{}`. That is expected because there is no single row to load. The service will later use partial evaluation to filter the whole list.

---

## 4. Request path and action mapping

File: `DPBE-main/src/shared/authz/request-mapping.ts`.

### Resource

```ts
export function getResourceFromPath(path: string): string {
  const segments = getPathSegments(path);
  return segments[0] || "*";
}
```

Location: `DPBE-main/src/shared/authz/request-mapping.ts:9`.

Example:

```text
/api/v1/devices
resource = "devices"
```

### Resource ID

```ts
export function getResourceIdFromPath(path: string): string | undefined {
  const segments = getPathSegments(path);
  const resource = segments[0];

  if (resource === "commands") { ... }

  return segments[1];
}
```

Location: `DPBE-main/src/shared/authz/request-mapping.ts:14`.

Examples:

| Path | Resource ID |
|---|---|
| `/api/v1/devices` | `undefined` |
| `/api/v1/devices/<uuid>` | `<uuid>` |
| `/api/v1/dashboards/<id>` | `<id>` |

### Action

```ts
export function getActionFromRequest(method: string, path: string): string { ... }
```

Location: `DPBE-main/src/shared/authz/request-mapping.ts:27`.

Examples:

| Method | Action |
|---|---|
| `GET` | `read` |
| `POST` | `create` |
| `PUT` | `update` |
| `PATCH` | `update` |
| `DELETE` | `delete` |

---

## 5. Resource context

File: `DPBE-main/src/shared/utils/resource-loader.ts`.

Function:

```ts
export async function loadResourceContext(
  resourceType: string,
  resourceId: string | undefined,
): Promise<Record<string, string>> { ... }
```

Location: `DPBE-main/src/shared/utils/resource-loader.ts:28`.

If there is no valid resource ID, it returns `{}`:

```ts
if (!resourceId || !isValidId(resourceId)) {
  return {};
}
```

Location: `DPBE-main/src/shared/utils/resource-loader.ts:32`.

For devices:

```ts
const [row] = await db
  .select({
    tenantId: devices.tenantId,
    status: devices.status,
    groupId: devices.groupId,
  })
  .from(devices)
  .where(eq(devices.uuid, resourceId))
  .limit(1);
```

Location: `DPBE-main/src/shared/utils/resource-loader.ts:39`.

It returns:

```ts
return {
  tenantId: row.tenantId ?? "",
  status: row.status,
  groupId: row.groupId ?? "",
};
```

Location: `DPBE-main/src/shared/utils/resource-loader.ts:62`.

For a list request, this function returns `{}` because there is no single row.

---

## 6. DPBE partial evaluation client

File: `DPBE-main/src/shared/authz/abac-client.ts`.

Function:

```ts
export async function partialEvaluateAuthorization(
  request: AuthorizationRequest,
): Promise<PartialEvaluateResponse> { ... }
```

Location: `DPBE-main/src/shared/authz/abac-client.ts:34`.

If there is no tenant, it returns a permissive plan:

```ts
return {
  schemaVersion: 1,
  includeFilter: null,
  excludeFilter: null,
  requiresVerification: false,
  residualConditions: [],
  defaultEffect: "allow",
  policyIds: [],
  warnings: [],
};
```

Location: `DPBE-main/src/shared/authz/abac-client.ts:37`.

Otherwise it calls the gRPC client:

```ts
const response = await partialEvaluateABAC({
  tenantId: request.tenantId,
  userId: request.userId,
  resource: request.resource,
  action: request.action,
  subject: stringifyRecord(request.subject),
  environment: stringifyRecord(request.environment),
});
```

Location: `DPBE-main/src/shared/authz/abac-client.ts:50`.

Then it parses JSON strings back into objects:

```ts
return {
  schemaVersion: 1,
  includeFilter: parseFilter(response.includeFilter),
  excludeFilter: parseFilter(response.excludeFilter),
  requiresVerification: response.requiresVerification,
  residualConditions: parseResidualConditions(response.residualConditions),
  defaultEffect: response.defaultEffect === "deny" ? "deny" : "allow",
  policyIds: response.policyIds ?? [],
  warnings: response.warnings ?? [],
};
```

Location: `DPBE-main/src/shared/authz/abac-client.ts:59`.

---

## 7. DPBE gRPC client mapping

File: `DPBE-main/src/config/grpc-client.ts`.

Function:

```ts
export function partialEvaluateABAC(params: {
  tenantId: string;
  userId: string;
  resource: string;
  action: string;
  subject: Record<string, string>;
  environment: Record<string, string>;
}): Promise<PartialEvalResponse> { ... }
```

Location: `DPBE-main/src/config/grpc-client.ts:173`.

It calls the gRPC method:

```ts
getClient().PartialEvaluateABAC(
  {
    tenant_id:   params.tenantId,
    user_id:     params.userId,
    resource:    params.resource,
    action:      params.action,
    subject:     params.subject,
    environment: params.environment,
  },
  ...
);
```

Location: `DPBE-main/src/config/grpc-client.ts:182`.

It maps snake_case gRPC fields to camelCase TypeScript fields:

```ts
resolve({
  includeFilter:        res.include_filter,
  excludeFilter:        res.exclude_filter,
  requiresVerification: res.requires_verification,
  residualConditions:   res.residual_conditions,
  defaultEffect:        res.default_effect,
  schemaVersion:        res.schema_version,
  policyIds:            res.policy_ids ?? [],
  warnings:             res.warnings ?? [],
});
```

Location: `DPBE-main/src/config/grpc-client.ts:193`.

---

## 8. Auth API `PartialEvaluateABAC` handler

File: `auth-api-main/src/grpc/handlers.ts`.

Function:

```ts
export async function partialEvaluateABAC(
  call: {
    request: {
      tenant_id: string;
      user_id: string;
      resource: string;
      action: string;
      subject: Record<string, string>;
      environment: Record<string, string>;
    };
  },
  callback: (err: any, response: any) => void,
) { ... }
```

Location: `auth-api-main/src/grpc/handlers.ts:400`.

### 8.1 Extract request fields

```ts
({ tenant_id, user_id, resource, action } = call.request);
```

Location: `auth-api-main/src/grpc/handlers.ts:419`.

Meaning:

| Field | Meaning |
|---|---|
| `tenant_id` | Tenant whose policies should be loaded. |
| `user_id` | User performing the request. |
| `resource` | Target resource, for example `devices`. |
| `action` | Target action, for example `read`. |
| `subject` | User attributes sent by DPBE. |
| `environment` | Request attributes sent by DPBE. |

### 8.2 No tenant fallback

If there is no tenant, Auth API returns a permissive response:

```ts
return callback(null, {
  include_filter:        "null",
  exclude_filter:        "null",
  requires_verification: false,
  residual_conditions:   "[]",
  default_effect:        "allow",
  schema_version:        1,
  policy_ids:            [],
  warnings:              [],
});
```

Location: `auth-api-main/src/grpc/handlers.ts:421`.

This means:

```text
No tenant context exists, so ABAC cannot apply tenant-scoped policies.
```

### 8.3 Load tenant/global policies

```ts
const tenantPolicies = await db
  .select()
  .from(policies)
  .where(or(eq(policies.tenantId, tenant_id), isNull(policies.tenantId)))
  .execute();
```

Location: `auth-api-main/src/grpc/handlers.ts:434`.

This loads:

1. Policies where `policies.tenantId === tenant_id`.
2. Global policies where `policies.tenantId` is `null`.

### 8.4 Resolve role names

```ts
const roleNames = await resolveRoleNames(user_id);
```

Location: `auth-api-main/src/grpc/handlers.ts:443`.

This gives ABAC the user's role names for policies like:

```text
subject.role equals "admin"
```

### 8.5 Create ABAC engine

```ts
const abac = new ABAC({ defaultEffect: "allow" });
```

Location: `auth-api-main/src/grpc/handlers.ts:444`.

The current runtime default is allow when no policy matches.

### 8.6 Map DB policy rows to ABAC policies

```ts
const mappedPolicies = tenantPolicies
  .filter((p) => p.isActive)
  .map((p) => ({
    id:             p.id,
    name:           p.name,
    description:    p.description ?? undefined,
    resources:      (p.resources ?? []) as string[],
    actions:        (p.actions ?? []) as string[],
    effect:         p.effect as "allow" | "deny",
    conditions:     (p.conditions ?? []) as any[],
    conditionLogic: (p.conditionLogic ?? "AND") as "AND" | "OR",
    priority:       p.priority ?? 100,
    isActive:       p.isActive ?? true,
  }));
```

Location: `auth-api-main/src/grpc/handlers.ts:446`.

Meaning:

| ABAC policy field | Source DB column | Meaning |
|---|---|---|
| `id` | `policies.id` | Policy identity. |
| `name` | `policies.name` | Human-readable policy name. |
| `description` | `policies.description` | Human-readable policy description. |
| `resources` | `policies.resources` | Resources the policy applies to. |
| `actions` | `policies.actions` | Actions the policy applies to. |
| `effect` | `policies.effect` | `allow` or `deny`. |
| `conditions` | `policies.conditions` | ABAC condition array. |
| `conditionLogic` | `policies.condition_logic` | Joins conditions with `AND` or `OR`. |
| `priority` | `policies.priority` | Higher priority is evaluated first. |
| `isActive` | `policies.is_active` | Whether the policy participates. |

### 8.7 Build evaluation context

```ts
const context = {
  subject:     {
    userId: user_id,
    roles:  roleNames,
    ...call.request.subject,
    role:   normalizeSubjectRole(roleNames, call.request.subject.role ?? ""),
  },
  action,
  environment: { ...call.request.environment },
  resource:    withFallbackResourceTenantId(
    (call.request as { resource_context?: Record<string, string> }).resource_context,
    call.request.subject,
  ),
};
```

Location: `auth-api-main/src/grpc/handlers.ts:461`.

Meaning:

| Context key | Meaning |
|---|---|
| `subject` | User attributes used by subject conditions. |
| `subject.userId` | Current user ID. |
| `subject.roles` | Resolved role names from Auth API DB. |
| `subject.role` | Normalized role value used by policies. |
| `action` | Current action, for example `read`. |
| `environment` | Request metadata. |
| `resource` | Optional resource row context. Empty for list requests. |

### 8.8 Call ABAC partial evaluator

```ts
const result = abac.partialEvaluate(mappedPolicies, context, resource);
```

Location: `auth-api-main/src/grpc/handlers.ts:476`.

This is the main call into `abac-solution-main`.

### 8.9 Return gRPC response

```ts
callback(null, {
  include_filter:        JSON.stringify(result.includeFilter),
  exclude_filter:        JSON.stringify(result.excludeFilter),
  requires_verification: result.requiresVerification,
  residual_conditions:   JSON.stringify(result.residualConditions),
  default_effect:        result.defaultEffect,
  schema_version:        1,
  policy_ids:            result.policyIds ?? [],
  warnings:              collectFilterWarnings(result),
});
```

Location: `auth-api-main/src/grpc/handlers.ts:482`.

Important: `include_filter`, `exclude_filter`, and `residual_conditions` are returned as JSON strings because proto maps them as `string`, not structured objects.

---

## 9. `auth.proto` request and response

File: `auth-api-main/proto/auth.proto`.

### 9.1 `PartialEvalABACRequest`

```proto
message PartialEvalABACRequest {
  string tenant_id   = 1;
  string user_id     = 2;
  string resource    = 3;
  string action      = 4;
  map<string, string> subject     = 5;
  map<string, string> environment = 6;
}
```

Location: `auth-api-main/proto/auth.proto:66`.

Meaning:

| Proto field | Number | TypeScript DPBE field | Meaning |
|---|---:|---|---|
| `tenant_id` | 1 | `tenantId` | Tenant ID used to load tenant/global policies. |
| `user_id` | 2 | `userId` | Current user ID. |
| `resource` | 3 | `resource` | Resource name, for example `devices`. |
| `action` | 4 | `action` | Action name, for example `read`. |
| `subject` | 5 | `subject` | Map of user attributes. |
| `environment` | 6 | `environment` | Map of request metadata. |

### 9.2 `PartialEvalABACResponse`

```proto
message PartialEvalABACResponse {
  string include_filter        = 1;  // JSON-serialised FilterNode | FilterGroup | null
  string exclude_filter        = 2;  // JSON-serialised FilterNode | FilterGroup | null
  bool   requires_verification = 3;
  string residual_conditions   = 4;  // JSON-serialised ResidualCondition[]
  string default_effect        = 5;  // "allow" | "deny"
  uint32 schema_version        = 6;
  repeated string policy_ids   = 7;
  repeated string warnings     = 8;
}
```

Location: `auth-api-main/proto/auth.proto:75`.

Meaning:

| Proto field | Number | TypeScript DPBE field | Meaning |
|---|---:|---|---|
| `include_filter` | 1 | `includeFilter` | JSON string for allow-derived filter AST. |
| `exclude_filter` | 2 | `excludeFilter` | JSON string for deny-derived filter AST. |
| `requires_verification` | 3 | `requiresVerification` | Whether DPBE must verify rows one by one. |
| `residual_conditions` | 4 | `residualConditions` | JSON string array of conditions that could not be pushed to SQL. |
| `default_effect` | 5 | `defaultEffect` | `"allow"` or `"deny"`. |
| `schema_version` | 6 | `schemaVersion` | Response schema version. Current value is `1`. |
| `policy_ids` | 7 | `policyIds` | IDs of active policies considered for target resource/action. |
| `warnings` | 8 | `warnings` | Advisory warnings from partial evaluation. |

---

## 10. ABAC `partialEvaluate()` function

File: `abac-solution-main/src/abac.ts`.

Function:

```ts
partialEvaluate(
  policies: Policy[],
  context: Omit<EvaluationContext, "resource">,
  targetResource: string,
): FilterResult { ... }
```

Location: `abac-solution-main/src/abac.ts:442`.

### Parameters

| Parameter | Type | Meaning |
|---|---|---|
| `policies` | `Policy[]` | Policies loaded from Auth API DB. |
| `context` | `Omit<EvaluationContext, "resource">` | Subject, action, and environment context. Resource is passed separately as `targetResource`. |
| `targetResource` | `string` | Resource being authorized, for example `devices`. |

### What it does

1. Logs start:

```ts
logAbac("PARTIAL_EVAL_START", "Starting partial evaluation", {
  targetResource,
  action: context.action,
  policyCount: policies.length,
  subject: context.subject,
  environment: context.environment,
});
```

Location: `abac-solution-main/src/abac.ts:447`.

2. Normalizes policies, including `deviceID` to `deviceId`:

```ts
const normalizedPolicies = policies.map(normalizePolicy);
```

Location: `abac-solution-main/src/abac.ts:455`.

3. Builds known resource field set:

```ts
const knownFields = new Set(this.attributes.resource.map((a) => a.key));
```

Location: `abac-solution-main/src/abac.ts:456`.

4. Calls AST builder:

```ts
const result = buildFilterResult(
  normalizedPolicies,
  context as EvaluationContext,
  targetResource,
  knownFields,
  this.defaultEffect,
);
```

Location: `abac-solution-main/src/abac.ts:457`.

5. Logs and returns the `FilterResult`.

---

## 11. AST builder

File: `abac-solution-main/src/utils/ast-builder.ts`.

Function:

```ts
export function buildFilterResult(
  policies: Policy[],
  context: EvaluationContext,
  targetResource: string,
  knownResourceFields: Set<string>,
  defaultEffect: PolicyEffect,
): FilterResult { ... }
```

Location: `abac-solution-main/src/utils/ast-builder.ts:247`.

This is the core partial evaluation engine.

### 11.1 Select active policies

```ts
const active = policies
  .filter((p) => p.isActive)
  .filter((p) => p.resources.includes("*") || p.resources.includes(targetResource))
  .filter((p) => p.actions.includes("*") || p.actions.includes(context.action))
  .sort((a, b) => b.priority - a.priority);
```

Location: `abac-solution-main/src/utils/ast-builder.ts:265`.

A policy is active for partial evaluation when:

```text
isActive === true
AND policy.resources includes targetResource or "*"
AND policy.actions includes current action or "*"
```

Policies are sorted by priority descending.

### 11.2 Split allow and deny

```ts
const allowPolicies = active.filter((p) => p.effect === "allow");
const denyPolicies  = active.filter((p) => p.effect === "deny");
```

Location: `abac-solution-main/src/utils/ast-builder.ts:278`.

Meaning:

| Variable | Meaning |
|---|---|
| `allowPolicies` | Policies that can include rows. |
| `denyPolicies` | Policies that can exclude rows. |

### 11.3 Process deny policies first

Deny policies are processed first because they are important for correctness.

```ts
for (const policy of denyPolicies) { ... }
```

Location: `abac-solution-main/src/utils/ast-builder.ts:294`.

For each deny policy:

1. If it has no resource condition, it is skipped for SQL filtering.
2. Its SQL-capable resource conditions become part of `excludeFilter`.
3. Its non-SQL conditions become residuals.
4. Any residual sets `requiresVerification = true`.

### 11.4 Build `excludeFilter`

```ts
const excludeFilter: FilterGroup | FilterNode | null =
  denyGroups.length === 0
    ? null
    : denyGroups.length === 1
      ? denyGroups[0]!
      : { type: "group", logic: "AND", conditions: denyGroups };
```

Location: `abac-solution-main/src/utils/ast-builder.ts:336`.

Meaning:

```text
excludeFilter = SQL-able deny policies.
```

If there are multiple deny policies, they are joined with `AND` so each deny policy is negated independently later.

Correct semantics:

```sql
NOT (denyPolicyA) AND NOT (denyPolicyB)
```

Wrong semantics:

```sql
NOT (denyPolicyA AND denyPolicyB)
```

### 11.5 Process allow policies

```ts
for (const policy of allowPolicies) { ... }
```

Location: `abac-solution-main/src/utils/ast-builder.ts:349`.

For each allow policy:

1. If it has no conditions, it is an unconditional allow.
2. SQL-capable resource conditions become `policyGroups`.
3. Non-SQL conditions become residuals.
4. Any residual sets `requiresVerification = true`.

### 11.6 Unconditional allow

If there is an unconditional allow policy:

```ts
if (hasUnconditionalAllow) {
  const result: FilterResult = {
    schemaVersion: 1,
    includeFilter: null,
    excludeFilter,
    requiresVerification,
    residualConditions: allResiduals,
    defaultEffect,
    policyIds,
    warnings,
  };
  return result;
}
```

Location: `abac-solution-main/src/utils/ast-builder.ts:397`.

Meaning:

```text
includeFilter = null because there is no positive row-level restriction.
excludeFilter may still exist because deny policies still matter.
```

### 11.7 No allow policies

```ts
if (policyGroups.length === 0) {
  const result: FilterResult = {
    schemaVersion: 1,
    includeFilter: defaultEffect === "deny" ? NEVER_MATCH : null,
    excludeFilter,
    requiresVerification: false,
    residualConditions: allResiduals,
    defaultEffect,
    policyIds,
    warnings,
  };
  return result;
}
```

Location: `abac-solution-main/src/utils/ast-builder.ts:411`.

Meaning:

| `defaultEffect` | Result |
|---|---|
| `"deny"` | `includeFilter = NEVER_MATCH`, so query returns zero rows. |
| `"allow"` | `includeFilter = null`, so no positive restriction is applied. |

### 11.8 Final include filter

If there are allow policy groups:

```ts
const includeFilter: FilterGroup | FilterNode =
  policyGroups.length === 1
    ? policyGroups[0]!
    : { type: "group", logic: "OR", conditions: policyGroups };
```

Location: `abac-solution-main/src/utils/ast-builder.ts:427`.

Multiple allow policies are combined with `OR` because matching any allow policy is enough.

---

## 12. `includeFilter`

`includeFilter` is the positive filter derived from allow policies.

It answers:

```text
Which rows are allowed by allow policies?
```

### Possible values

| Value | Meaning |
|---|---|
| `null` | No positive row-level restriction. Often means unconditional allow or default allow. |
| `FilterNode` | One SQL-capable allow condition. |
| `FilterGroup` | Multiple allow conditions/policies combined with `AND` or `OR`. |
| `NEVER_MATCH` | No allow policy matched and default effect is deny, so return zero rows. |

### Example: one allow policy

Policy:

```text
Allow devices where status = ONLINE
```

`includeFilter`:

```json
{
  "type": "group",
  "logic": "AND",
  "conditions": [
    {
      "type": "condition",
      "field": "status",
      "operator": "equals",
      "value": "ONLINE",
      "sqlCapable": true,
      "queryCost": "low",
      "indexSafe": true
    }
  ]
}
```

### Example: multiple allow policies

Policies:

```text
Allow devices where status = ONLINE
Allow devices where ownerId = {subject.userId}
```

`includeFilter` shape:

```json
{
  "type": "group",
  "logic": "OR",
  "conditions": [
    {
      "type": "group",
      "logic": "AND",
      "conditions": [
        { "type": "condition", "field": "status", "operator": "equals", "value": "ONLINE" }
      ]
    },
    {
      "type": "group",
      "logic": "AND",
      "conditions": [
        { "type": "condition", "field": "ownerId", "operator": "equals", "value": "u1" }
      ]
    }
  ]
}
```

SQL meaning:

```sql
(status = $1) OR (ownerId = $2)
```

### Example: `NEVER_MATCH`

`NEVER_MATCH` is defined at `abac-solution-main/src/utils/ast-builder.ts:20`:

```ts
export const NEVER_MATCH: FilterNode = {
  type: "condition",
  field: "1",
  operator: "equals",
  value: 0,
  sqlCapable: true,
  queryCost: "low",
  indexSafe: true,
};
```

SQL meaning:

```sql
1 = 0
```

Result:

```text
The query returns zero rows.
```

---

## 13. `excludeFilter`

`excludeFilter` is the negative filter derived from deny policies.

It answers:

```text
Which rows must be excluded because a deny policy matches?
```

### Possible values

| Value | Meaning |
|---|---|
| `null` | No SQL-able deny policy matched. |
| `FilterNode` | One deny policy with SQL-capable resource conditions. |
| `FilterGroup` | One or more deny policies. |

### Example: one deny policy

Policy:

```text
Deny devices where status = OFFLINE
```

`excludeFilter`:

```json
{
  "type": "group",
  "logic": "AND",
  "conditions": [
    {
      "type": "condition",
      "field": "status",
      "operator": "equals",
      "value": "OFFLINE",
      "sqlCapable": true,
      "queryCost": "low",
      "indexSafe": true
    }
  ]
}
```

SQL meaning after negation:

```sql
status IS NULL OR NOT (status = $1)
```

The `status IS NULL` part means:

```text
Keep null values unless the policy explicitly denies null.
```

### Example: two deny policies

Policies:

```text
Deny devices where status = OFFLINE
Deny devices where groupId = blocked-group
```

Correct SQL:

```sql
(status IS NULL OR NOT (status = $1))
AND
(groupId IS NULL OR NOT (groupId = $2))
```

Wrong SQL:

```sql
NOT (
  status = $1
  AND groupId = $2
)
```

Wrong SQL is too permissive because:

```text
NOT (A AND B) = NOT A OR NOT B
```

That would allow rows denied by one of the policies.

---

## 14. `FilterNode` attributes

Defined in `abac-solution-main/src/types/index.ts:128`.

```ts
export interface FilterNode {
  type: "condition";
  field: string;
  operator: AttributeOperator;
  value: ConditionValue;
  sqlCapable: boolean;
  queryCost: FilterNodeCost;
  indexSafe: boolean;
}
```

Meaning:

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `"condition"` | This is a single condition node. |
| `field` | `string` | Resource field name, for example `status`, `groupId`, `deviceId`. |
| `operator` | `AttributeOperator` | Comparison operator, for example `equals`, `not_equals`, `in`. |
| `value` | `ConditionValue` | Literal value after plan-time resolution. Can be string, number, boolean, or string array. |
| `sqlCapable` | `boolean` | True when this node can be translated to SQL. |
| `queryCost` | `"low" \| "medium" \| "high"` | Advisory cost for SQL execution. |
| `indexSafe` | `boolean` | True when this condition is expected to use an index safely. |

Example:

```json
{
  "type": "condition",
  "field": "deviceId",
  "operator": "equals",
  "value": "c584aef2-338b-4424-b9b8-b89a40ce5c96",
  "sqlCapable": true,
  "queryCost": "low",
  "indexSafe": true
}
```

---

## 15. `FilterGroup` attributes

Defined in `abac-solution-main/src/types/index.ts:138`.

```ts
export interface FilterGroup {
  type: "group";
  logic: ConditionLogic;
  conditions: Array<FilterNode | FilterGroup>;
}
```

Meaning:

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `"group"` | This is a group node. |
| `logic` | `"AND" \| "OR"` | How child conditions are combined. |
| `conditions` | Array | Child `FilterNode` or nested `FilterGroup` objects. |

Example:

```json
{
  "type": "group",
  "logic": "AND",
  "conditions": [
    { "type": "condition", "field": "status", "operator": "equals", "value": "ONLINE" },
    { "type": "condition", "field": "groupId", "operator": "equals", "value": "group-1" }
  ]
}
```

SQL meaning:

```sql
status = $1 AND groupId = $2
```

---

## 16. `ResidualCondition`

Defined in `abac-solution-main/src/types/index.ts:144`.

```ts
export interface ResidualCondition {
  policyId: string;
  policyName: string;
  condition: PolicyCondition;
  reason:
    | "non_resource_category"
    | "unresolvable_context_var"
    | "non_sql_operator"
    | "unknown_field"
    | "external_dependency";
}
```

Meaning:

| Attribute | Meaning |
|---|---|
| `policyId` | Policy that produced the residual. |
| `policyName` | Human-readable policy name. |
| `condition` | Original condition that could not be pushed to SQL. |
| `reason` | Why it could not be pushed to SQL. |

### Residual reasons

| Reason | Meaning | Example |
|---|---|---|
| `non_resource_category` | Condition is on `subject` or `environment`, not a DB column. | `subject.role equals "admin"` |
| `unknown_field` | Field is not known for the target resource. | `resource.serialNumber` for devices when not defined. |
| `non_sql_operator` | Operator cannot be translated to SQL. | `regex` if not marked SQL-capable. |
| `unresolvable_context_var` | Context variable cannot be resolved at plan time. | `{environment.now}` for SQL. |
| `external_dependency` | Condition is marked `external: true`. | External runtime dependency. |

If any residual exists:

```ts
requiresVerification = true;
```

DPBE will verify candidate rows one by one after SQL filtering.

---

## 17. `requiresVerification`

`requiresVerification` means:

```text
The partial SQL filter is incomplete, so DPBE must run point-in-time ABAC per row.
```

It is set to `true` when:

1. A policy has a residual condition.
2. A condition cannot be safely pushed to SQL.
3. The AST cannot fully represent the policy decision.

In DPBE, verification is handled by:

```ts
verifyDeviceRows(...)
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:138`.

The verifier calls Auth API `EvaluateABAC` for each candidate row:

```ts
resourceContext: stringifyRecord(params.row)
```

Location: `DPBE-main/src/shared/authz/verifier.ts:40`.

---

## 18. `defaultEffect`

`defaultEffect` is the decision when no policy matches.

Possible values:

| Value | Meaning |
|---|---|
| `"allow"` | If no policy matches, access is allowed. |
| `"deny"` | If no policy matches, access is denied. |

In the current Auth API partial evaluator, the engine is created with:

```ts
const abac = new ABAC({ defaultEffect: "allow" });
```

Location: `auth-api-main/src/grpc/handlers.ts:444`.

So current list partial evaluation defaults to allow unless a deny policy excludes rows.

---

## 19. `schemaVersion`

`schemaVersion` is the response schema version.

Current value:

```ts
schema_version: 1
```

Location: `auth-api-main/src/grpc/handlers.ts:488`.

It lets DPBE know how to parse the response format.

---

## 20. `policyIds`

`policyIds` is the list of active policy IDs considered for the target resource/action.

Built in AST builder:

```ts
const policyIds = active.map((policy) => policy.id);
```

Location: `abac-solution-main/src/utils/ast-builder.ts:270`.

Meaning:

```text
These are the policies that matched resource/action scope and were considered by partial evaluation.
```

They are returned for logging/debugging.

---

## 21. `warnings`

`warnings` is an advisory array. It does not deny access by itself.

Built in:

```ts
const warnings = buildPolicyWarnings(policyGroups, denyGroups, allResiduals);
```

Location: `abac-solution-main/src/utils/ast-builder.ts:392`.

Logged as:

```json
{
  "stage": "AST_FILTER_RESULT_WARNINGS",
  "warnings": []
}
```

Location: `abac-solution-main/src/utils/ast-builder.ts:393`.

### What the log means

The log means:

```text
ABAC finished assembling partial-evaluation warnings.
```

`warnings: []` means:

```text
No residual conditions require verification and no high-cost SQL authorization fields were detected.
```

### Warning types

`buildPolicyWarnings()` emits two kinds of warnings.

#### 19.1 Residual warning

```ts
if (residuals.length > 0) {
  const warning = `${residuals.length} residual condition(s) require verification`;
  warnings.push(warning);
}
```

Location: `abac-solution-main/src/utils/ast-builder.ts:170`.

Meaning:

```text
One or more conditions could not be pushed to SQL. DPBE must verify rows one by one.
```

#### 19.2 High-cost SQL warning

```ts
if (highCostFields.length > 0) {
  const warning = `High-cost SQL authorization fields: ${Array.from(new Set(highCostFields)).join(", ")}`;
  warnings.push(warning);
}
```

Location: `abac-solution-main/src/utils/ast-builder.ts:183`.

Meaning:

```text
A SQL authorization filter may be expensive. Consider adding an index or refining the policy.
```

---

## 22. SQL translation in ABAC

File: `abac-solution-main/src/utils/sql-translator.ts`.

### 22.1 Include filter SQL

Function:

```ts
export function toSql(node: FilterNode | FilterGroup, offset = 0): SqlFragment { ... }
```

Location: `abac-solution-main/src/utils/sql-translator.ts:16`.

It translates `includeFilter` into a SQL fragment.

Example:

```json
{
  "type": "condition",
  "field": "status",
  "operator": "equals",
  "value": "ONLINE"
}
```

SQL:

```sql
"status" = $1
```

### 22.2 Exclude filter SQL

Function:

```ts
export function excludeToSqlParts(
  excludeFilter: FilterNode | FilterGroup,
  offset = 0,
): SqlFragment[] { ... }
```

Location: `abac-solution-main/src/utils/sql-translator.ts:34`.

It returns an array of SQL veto parts.

For deny equals, it emits null-safe negation:

```ts
fragment = { sql: `"${node.field}" IS NULL OR NOT (${sql})`, params };
```

Location: `abac-solution-main/src/utils/sql-translator.ts:63`.

Meaning:

```sql
field IS NULL OR NOT (field = $1)
```

This keeps null rows unless the policy explicitly denies null.

---

## 23. DPBE authorization plan

File: `DPBE-main/src/shared/authz/types.ts`.

Partial response type:

```ts
export interface PartialEvaluateResponse {
  schemaVersion: 1;
  includeFilter: AuthorizationFilter;
  excludeFilter: AuthorizationFilter;
  requiresVerification: boolean;
  residualConditions: ResidualCondition[];
  defaultEffect: PolicyEffect;
  policyIds: string[];
  warnings: string[];
}
```

Location: `DPBE-main/src/shared/authz/types.ts:87`.

Authorization plan type:

```ts
export interface AuthorizationPlan {
  hardConstraints: SQLConstraint[];
  includeFilter: AuthorizationFilter;
  excludeFilter: AuthorizationFilter;
  rebacPlan?: ReBACPlan;
  requiresVerification: boolean;
  residualConditions: ResidualCondition[];
  defaultEffect: PolicyEffect;
  policyIds: string[];
  warnings: string[];
}
```

Location: `DPBE-main/src/shared/authz/types.ts:98`.

Meaning:

| Plan field | Source | Meaning |
|---|---|---|
| `hardConstraints` | DPBE | Tenant/resource safety filters. |
| `includeFilter` | Auth API ABAC | Allow-derived filter. |
| `excludeFilter` | Auth API ABAC | Deny-derived filter. |
| `requiresVerification` | Auth API ABAC | Whether per-row verification is needed. |
| `residualConditions` | Auth API ABAC | Conditions not pushed to SQL. |
| `defaultEffect` | Auth API ABAC | Default decision. |
| `policyIds` | Auth API ABAC | Active policy IDs. |
| `warnings` | Auth API ABAC | Advisory warnings. |

---

## 24. DPBE planner and WHERE clause

File: `DPBE-main/src/shared/authz/planner.ts`.

For devices:

```ts
export function buildDevicesAuthPlan(params: {
  request: AuthorizationRequest;
  partialEvalResult: PartialEvaluateResponse;
}): AuthorizationPlan { ... }
```

Location: `DPBE-main/src/shared/authz/planner.ts:346`.

It builds hard constraints and copies partial evaluation filters:

```ts
return {
  hardConstraints: buildDevicesHardConstraints(params.request),
  includeFilter: normalizeDefaultEffect(result.includeFilter, result.defaultEffect, result.requiresVerification, result.residualConditions),
  excludeFilter: result.excludeFilter,
  requiresVerification: result.requiresVerification,
  residualConditions: result.residualConditions,
  defaultEffect: result.defaultEffect,
  policyIds: result.policyIds,
  warnings: result.warnings,
};
```

Location: `DPBE-main/src/shared/authz/planner.ts:352`.

Then DPBE builds the WHERE clause:

```ts
const includeFilter = filterToSql(devices, params.authPlan.includeFilter);
const excludeParts = excludeFilterToSqlParts(devices, params.authPlan.excludeFilter);
const hardConstraints = params.authPlan.hardConstraints.map((constraint) => constraint.sql);
const whereClause = combineWhere(
  ...hardConstraints,
  includeFilter,
  ...excludeParts,
  params.userQueryFilter,
);
```

Location: `DPBE-main/src/shared/authz/planner.ts:373`.

Final WHERE order:

```text
tenant/resource hard constraints
AND includeFilter
AND exclude veto 1
AND exclude veto 2
AND user query filter
```

---

## 25. DPBE field mapping to columns

File: `DPBE-main/src/shared/authz/filter-to-drizzle.ts`.

Function:

```ts
export function filterToSql(table: Record<string, any>, filter: AuthorizationFilter): SQL | undefined { ... }
```

Location: `DPBE-main/src/shared/authz/filter-to-drizzle.ts:129`.

Function:

```ts
export function excludeFilterToSqlParts(table: Record<string, any>, excludeFilter: AuthorizationFilter): SQL[] { ... }
```

Location: `DPBE-main/src/shared/authz/filter-to-drizzle.ts:135`.

Function:

```ts
export function combineWhere(...filters: Array<SQL | undefined | null>): SQL | undefined { ... }
```

Location: `DPBE-main/src/shared/authz/filter-to-drizzle.ts:149`.

### Field aliases

```ts
const FIELD_ALIASES: Record<string, Record<string, string>> = {
  devices: {
    deviceId: "uuid",
    deviceID: "uuid",
  },
};
```

Location: `DPBE-main/src/shared/authz/filter-to-drizzle.ts:22`.

Meaning:

```text
ABAC field deviceId maps to PostgreSQL column devices.uuid.
```

This is why a policy like:

```text
resource.deviceId equals "c584aef2-338b-4424-b9b8-b89a40ce5c96"
```

can filter the `devices` table even though the DB column is `uuid`.

---

## 26. Devices service final execution

File: `DPBE-main/src/routes/devices/devices.service.ts`.

Function:

```ts
async getAllDevices({ query, request }: { query: paginationQueryType; request?: AuthenticatedRequest }) { ... }
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:58`.

### 26.1 Extract authorization request

```ts
const authRequest: AuthorizationRequest | undefined = request ? extractAuthorizationRequest(request) : undefined;
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:76`.

### 26.2 Partial evaluate

```ts
const partialEvalResult = authRequest ? await partialEvaluateAuthorization(authRequest) : undefined;
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:77`.

### 26.3 Build auth plan

```ts
const authPlan: AuthorizationPlan | undefined = authRequest && partialEvalResult
  ? buildDevicesAuthPlan({ request: authRequest, partialEvalResult })
  : undefined;
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:79`.

### 26.4 Build auth WHERE clause

```ts
const authWhereClause = authRequest && authPlan
  ? buildDevicesAuthWhereClauseFromPlan({ request: authRequest, authPlan }).whereClause
  : undefined;
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:80`.

### 26.5 Combine with tenant and user filters

```ts
const whereClause = combineWhere(tenantFilter, authWhereClause, userQueryFilter);
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:82`.

### 26.6 Query DB

```ts
const totalResults = await db
  .select({ count: count() })
  .from(devices)
  .where(whereClause)
  .execute()
  .then((res: any) => res[0].count);
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:91`.

Then fetch rows:

```ts
const rawItems = await db.query.devices.findMany({
  where: whereClause,
  columns: shouldVerify ? undefined : columns,
  with: cleanedWith as any,
  orderBy: query.sort ? applySortOrder(devices, query.sort) : undefined,
  limit: shouldVerify ? Math.min(totalResults, MAX_VERIFICATION_CANDIDATES) : query.limit,
  offset: shouldVerify ? undefined : query.skip,
});
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:116`.

### 26.7 Verify if needed

```ts
if (shouldVerify && authRequest && authPlan) {
  const verifiedItems = await verifyDeviceRows({
    request: authRequest,
    plan: authPlan,
    rows: items,
  });
  items = verifiedItems;
  verifiedTotalResults = verifiedItems.length;
}
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:138`.

### 26.8 Return response

If verification ran:

```ts
return { totalResults: verifiedTotalResults, results: items.slice(query.skip, query.skip + query.limit) };
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:150`.

Otherwise:

```ts
return { totalResults, results: items };
```

Location: `DPBE-main/src/routes/devices/devices.service.ts:154`.

---

## 27. Example end-to-end lifecycle

### Request

```text
GET /api/v1/devices
```

User:

```text
tenant_id = tenant-a
user_id = user-1
```

Policies:

```text
Allow devices where status = ONLINE
Deny devices where groupId = blocked-group
```

### Step-by-step

```text
1. Browser calls GET /api/v1/devices.
2. DPBE authenticate() validates the JWT.
3. DPBE multiTenantAccess() resolves effective tenant.
4. DPBE role-access extracts:
   - resource = devices
   - resourceId = undefined
   - action = read
5. DPBE resource-loader returns {} because this is a list request.
6. Devices service calls partialEvaluateAuthorization().
7. DPBE gRPC client sends PartialEvalABACRequest:
   - tenant_id = tenant-a
   - user_id = user-1
   - resource = devices
   - action = read
   - subject = { userId, email, username, role, tenantId, isActive }
   - environment = { ipAddress, requestMethod, requestPath, userAgent }
8. Auth API partialEvaluateABAC() loads tenant/global policies.
9. Auth API builds context and calls abac.partialEvaluate().
10. ABAC buildFilterResult() selects active policies.
11. Allow policy becomes includeFilter.
12. Deny policy becomes excludeFilter.
13. Auth API returns PartialEvalABACResponse.
14. DPBE parses include_filter/exclude_filter JSON strings.
15. DPBE builds AuthorizationPlan.
16. DPBE filter-to-drizzle maps fields to DB columns.
17. DPBE combines tenant filter + include filter + exclude filter + user query filter.
18. PostgreSQL returns candidate rows.
19. If requiresVerification is true, DPBE verifies rows one by one.
20. DPBE returns:
    {
      totalResults,
      results
    }
```

---

## 28. Example partial evaluation response

Example response from Auth API:

```json
{
  "include_filter": "{\"type\":\"group\",\"logic\":\"AND\",\"conditions\":[{\"type\":\"condition\",\"field\":\"status\",\"operator\":\"equals\",\"value\":\"ONLINE\",\"sqlCapable\":true,\"queryCost\":\"low\",\"indexSafe\":true}]}",
  "exclude_filter": "{\"type\":\"group\",\"logic\":\"AND\",\"conditions\":[{\"type\":\"condition\",\"field\":\"groupId\",\"operator\":\"equals\",\"value\":\"blocked-group\",\"sqlCapable\":true,\"queryCost\":\"low\",\"indexSafe\":true}]}",
  "requires_verification": false,
  "residual_conditions": "[]",
  "default_effect": "allow",
  "schema_version": 1,
  "policy_ids": ["policy-1", "policy-2"],
  "warnings": []
}
```

Parsed meaning:

| Field | Meaning |
|---|---|
| `include_filter` | Include rows where `status = ONLINE`. |
| `exclude_filter` | Exclude rows where `groupId = blocked-group`. |
| `requires_verification` | `false` because all conditions were SQL-capable. |
| `residual_conditions` | `[]` because no condition needed per-row verification. |
| `default_effect` | `"allow"` because the ABAC engine was configured with default allow. |
| `schema_version` | `1`. |
| `policy_ids` | Active policies considered. |
| `warnings` | `[]` because no residual or high-cost warning exists. |

Final SQL shape:

```sql
tenant_id = $tenant
AND status = $1
AND (group_id IS NULL OR NOT (group_id = $2))
```

---

## 29. DeviceID example

Policy:

```text
Allow devices where deviceId equals "c584aef2-338b-4424-b9b8-b89a40ce5c96"
```

ABAC `includeFilter`:

```json
{
  "type": "group",
  "logic": "AND",
  "conditions": [
    {
      "type": "condition",
      "field": "deviceId",
      "operator": "equals",
      "value": "c584aef2-338b-4424-b9b8-b89a40ce5c96",
      "sqlCapable": true,
      "queryCost": "low",
      "indexSafe": true
    }
  ]
}
```

DPBE maps:

```text
devices.deviceId → devices.uuid
```

File: `DPBE-main/src/shared/authz/filter-to-drizzle.ts:22`.

SQL shape:

```sql
devices.uuid::text = $deviceId
```

The `::text` comparison is used because the policy value is a string and the database column is UUID.

---

## 30. Summary of request-to-response ownership

| Stage | File/function | Output |
|---|---|---|
| Validate token | `DPBE-main/src/shared/middleware/auth.ts:26` | `req.user`, tenant context. |
| Resolve tenant | `DPBE-main/src/shared/middleware/multi-tenant-access.ts:16` | `effectiveTenantId`. |
| Extract resource/action | `DPBE-main/src/shared/middleware/role-access.ts:247` | `resource`, `resourceId`, `action`. |
| Build subject | `DPBE-main/src/shared/middleware/role-access.ts:257` | `subject` map. |
| Build environment | `DPBE-main/src/shared/middleware/role-access.ts:266` | `environment` map. |
| Load resource context | `DPBE-main/src/shared/utils/resource-loader.ts:28` | `resourceContext` or `{}`. |
| Call partial eval | `DPBE-main/src/shared/authz/abac-client.ts:34` | `PartialEvaluateResponse`. |
| gRPC call | `DPBE-main/src/config/grpc-client.ts:173` | Auth API response. |
| Auth API handler | `auth-api-main/src/grpc/handlers.ts:400` | JSON filter strings. |
| ABAC partial eval | `abac-solution-main/src/abac.ts:442` | `FilterResult`. |
| AST builder | `abac-solution-main/src/utils/ast-builder.ts:247` | `includeFilter`, `excludeFilter`, residuals. |
| SQL translator | `abac-solution-main/src/utils/sql-translator.ts:16` | SQL fragments. |
| DPBE plan | `DPBE-main/src/shared/authz/planner.ts:346` | `AuthorizationPlan`. |
| Drizzle filter | `DPBE-main/src/shared/authz/filter-to-drizzle.ts:129` | SQL `WHERE`. |
| Devices service | `DPBE-main/src/routes/devices/devices.service.ts:58` | Final user response. |
