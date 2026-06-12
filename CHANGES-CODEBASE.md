# ABAC Codebase — Full Change Report

This document is a complete record of every change made across all repositories as part of the ABAC system improvement initiative. Changes are grouped by session. Each entry describes the file changed, what was changed, and the reasoning behind the decision.

---

## Background

The `@digieye/abac` package (`abac-solution-main`) is a pure TypeScript ABAC (Attribute-Based Access Control) engine. It has no database connections and no network calls. It receives data and evaluates policies. It is consumed by two services:

- **`auth-api-main`** — acts as the Policy Decision Point (PDP). Receives evaluation requests via gRPC from DPBE, fetches policies from its database, and calls the engine.
- **`DPBE-main`** — the IoT data platform backend. Every incoming request passes through a `role-access.ts` middleware that calls auth-api via gRPC to get an allow/deny decision.


The frontend for policy management lives in **`auth-frontend-main`** at `src/pages/private/iam/policies/`.

The changes documented here span six implementation sessions:

- **Session 1** — Added the `resource` condition category across all four repositories (engine, auth-api, DPBE, frontend).
- **Session 2** — Engine-level improvements: `between` operator, skip reasons, `contextVariables` completeness, `can()` API fix, orphan cleanup, `httpMethods` documentation.
- **Session 3** — Frontend fix: `execute` and `manage` actions were defined in the type system and constants but never rendered in the action selector UI due to a hardcoded local array.
- **Session 4** — Two-phase partial evaluation system: upgraded the engine from a per-request allow/deny model to a query-planning + verification model that can push access control constraints into database queries.
- **Session 5** — Frontend condition builder alignment: synced the policy UI operator set, subject attribute list, and condition builder component with all backend changes made in Sessions 2–4.
- **Session 6** — ABAC V2 Phase 5 DPBE hardening: tenant hierarchy support, hard-constraint coverage for protected resources, middleware fail-closed/read-empty behavior, and DPBE route wiring for dashboards, alerts, groups, and workflows.

---

## Session 1 — Resource Context & System-Wide Fixes

### Problem being solved

The ABAC system could only make decisions based on two things:
1. **Who the user is** — their role, email, tenantId (subject attributes)
2. **The context of the request** — time, IP, HTTP method (environment attributes)

It had no way to make decisions based on **the thing being accessed**. Policies like "deny delete if the device is ONLINE", "only the dashboard owner can edit it", or "deny if the resource belongs to a different tenant" were impossible to express because the engine had no resource data to evaluate against.

The root cause was in `DPBE-main/src/shared/middleware/role-access.ts`. It extracted the resource **type** from the URL path (e.g. `"devices"`) but never extracted the resource **ID**, so there was no way to look up the resource's actual attributes from the database. The gRPC call to auth-api carried no resource data at all.

The fix follows the same pattern used by Cerbos and other production authorization systems: the backend fetches the resource from the database first, then passes its attributes to the authorization engine as context. The engine itself never touches the database.

A second critical problem was discovered during this work: the `evaluateConditions` function inside `auth-api-main/src/grpc/handlers.ts` was a hand-rolled reimplementation of the ABAC engine that only handled the `subject` category and only supported 4 operators (`equals`, `not_equals`, `contains`, `in`). It completely ignored `environment` conditions. This meant the `@digieye/abac` package was barely being used — only its policy fetching, not its evaluation logic. This was replaced entirely with a proper call to `evaluateAccess()`.

---

### `abac-solution-main/src/types/index.ts`

**What changed:**
- Added `"resource"` to the `AttributeCategory` union type
- Added `resource?: Record<string, unknown>` as an optional field on the `EvaluationContext` interface
- Added `resource?: AttributeDefinition[]` to the `ABACConfig.attributes` object

**Why:** The engine's type system only recognised `"subject"` and `"environment"` as valid condition categories. Any condition with `category: "resource"` would hit the guard in `evaluateCondition()` and silently return `true` (condition always passes). Making `resource` optional on `EvaluationContext` preserves backward compatibility — existing callers that don't pass resource data continue to work.

---

### `abac-solution-main/src/abac.ts`

**What changed:**
- Added `DEFAULT_RESOURCE_ATTRIBUTES` to the import from `./config/defaults`
- Added `resource: AttributeDefinition[]` to the `attributes` property declaration on the class
- Initialised `resource` in the constructor: `config?.attributes?.resource ?? DEFAULT_RESOURCE_ATTRIBUTES`
- Added `resource` entry to `_attrMap` in the constructor
- Updated `evaluateCondition()` to handle `"resource"`: reads from `context.resource` instead of `context[category]`

**Why:** The constructor needed to store resource attribute definitions so the engine can expose them to UI helpers. The `evaluateCondition()` change makes `resource` conditions actually work — it reads the correct bucket (`context.resource`) and runs the comparison logic the same way subject and environment conditions do.

---

### `abac-solution-main/src/config/defaults.ts`

**What changed (subject attributes):**
- Removed `groups` — there is no user groups concept in the database. Groups in the DPBE DB are for devices and assets only. This field caused false confidence when writing policies.
- Removed `roleIds` — redundant with `role`. The `role` key already captures the user's role name. Having both caused confusion about which one to use.
- Removed `dashboardId` — this is a property of a dashboard resource, not a user attribute. It belonged in the `resource` category, not `subject`.
- Added `status` — maps to `users.status` (enum `ONLINE/OFFLINE`). Enables policies like "deny sensitive actions if the user session is OFFLINE".
- Added `twoFa` — maps to `users.twoFa` (boolean). Enables policies like "deny access to admin resources if 2FA is not enabled", which is a common compliance requirement.
- Added `isFirstLogin` — maps to `users.isFirstLogin` (boolean). Enables policies like "restrict users on their first login to read-only until profile is complete".
- Added `lastSeenAt` — maps to `users.lastSeenAt` (timestamp). Enables policies like "deny access to accounts inactive for more than 90 days". This was previously listed as `lastLogin` which did not match the actual database column name.
- Added `phone` — maps to `users.phone`. Allows region-based access rules using phone number prefixes.

**What changed (environment attributes):**
- Removed `locale` — had no resolver that computed it automatically, and no backend code ever injected it. Never referenced in any policy in the codebase. Dead weight.
- Added `tenantTimezone` — source: `tenants.timezone` in auth-api DB. Work-hour policies currently evaluate in server time. If a tenant is in a different timezone, "08:00-18:00" means different things. Injecting `tenantTimezone` lets policies become timezone-aware.
- Added `licenseStatus` — source: `licenses.expiresAt` vs now. Enables ABAC-based feature gating: "deny create/update if licenseStatus equals EXPIRED" instead of hard-blocking everything in middleware.

**What changed (new export):**
- Added `DEFAULT_RESOURCE_ATTRIBUTES` — a new export containing 7 attribute definitions mapped directly to fields in the DPBE database:
  - `tenantId` — exists on every resource table. Powers full tenant isolation policies.
  - `ownerId` — `dashboards.ownerId`. Powers "only the owner can edit this dashboard" policies.
  - `status` — `devices.status`, `assets.status`, `alerts.status`. Powers state-based access control.
  - `severity` — `alerts.severity`. Powers role-gated alert handling ("only senior roles can acknowledge CRITICAL alerts").
  - `groupId` — `devices.groupId`, `assets.groupId`. Powers group-scoped access policies.
  - `isEditable` — `dashboards.isEditable`. Powers dashboard lock enforcement.
  - `createdAt` — exists on every resource table. Powers age-based resource access policies.

**Why:** Every removed field was either absent from the real database, redundant, or categorically wrong. Every added field is grounded in an actual column in the `auth-api-main` or `DPBE-main` database schemas with a concrete policy use case.

---

### `abac-solution-main/src/config/schemas.ts`

**What changed:**
- Added `"resource"` to the `attributeCategorySchema` Zod enum

**Why:** `validatePolicy()` uses this schema to validate policy objects. Without adding `"resource"` here, any policy condition with `category: "resource"` would fail validation with a Zod error even though the engine now supports it. The schema must stay in sync with the type system.

---

### `abac-solution-main/src/utils/resolver.ts`

**What changed:**
- Updated `resolveSingle()` to handle the `resource` prefix in context variable paths
- Added `"resource"` to the allowed prefix check so `{resource.tenantId}`, `{resource.ownerId}` etc. resolve correctly
- Added logic to read from `(context as any).resource` when the prefix is `"resource"`

**Why:** Context variables like `{subject.userId}` and `{environment.ipAddress}` were already resolved by this function. Without this change, `{resource.tenantId}` in a condition value would return the raw string `"{resource.tenantId}"` instead of the actual value from `context.resource`. This would make cross-category comparisons like "resource.tenantId equals {subject.tenantId}" impossible.

---

### `abac-solution-main/src/index.ts`

**What changed:**
- `DEFAULT_RESOURCE_ATTRIBUTES` is exported from `./config/defaults` via the existing `export *` wildcard — no explicit line needed, but the export was verified to be included in the public surface.

**Why:** Consuming services (DPBE, auth-api) need to be able to import `DEFAULT_RESOURCE_ATTRIBUTES` directly from `@digieye/abac` when configuring their ABAC instances.

---

### `auth-api-main/proto/auth.proto`

**What changed:**
- Added `map<string, string> resource_context = 7` to the `EvaluateABACRequest` message

**Why:** The protobuf file defines the gRPC contract between DPBE and auth-api. Without this field, there is no way to transmit resource attributes over the wire. Field number 7 was chosen as the next sequential number after the existing 6 fields.

---

### `auth-api-main/src/grpc/handlers.ts`

**What changed:**
- Updated the `evaluateABAC` handler to read `call.request.resource_context` from the gRPC request
- Replaced the entire hand-rolled `evaluateConditions` function with a proper call to `abac.evaluateAccess()`, passing `subject`, `action`, `environment`, and `resource` (from `resource_context`) as the `EvaluationContext`
- Deleted the `evaluateConditions` function entirely

**Why:** The `evaluateConditions` function was a critical bug. It was a re-implementation of the evaluation logic that only understood the `subject` category and only handled 4 operators. Any policy condition using `environment` category (time-based, IP-based, etc.) silently returned `true` — the condition was always considered passing. Replacing it with `evaluateAccess()` means the actual `@digieye/abac` engine is now used for evaluation, with full support for all categories, all operators, and proper `defaultEffect` handling.

---

### `DPBE-main/src/config/abac.ts`

**What changed:**
- Changed `defaultEffect` from `"allow"` to `"deny"`

**Why:** When no policy matches a request, `defaultEffect: "allow"` meant access was granted automatically. This is the opposite of security best practice. Industry standard is deny-by-default: if nothing explicitly permits you, you are blocked. With `"allow"`, every new resource or endpoint added to DPBE was automatically accessible to everyone until someone wrote an explicit deny policy. With `"deny"`, new resources are locked by default and require explicit allow policies — which is the correct security posture.

---

### `DPBE-main/src/config/grpc-client.ts`

**What changed:**
- Added `resourceContext?: Record<string, string>` to the `evaluateABAC` function's parameter type
- Added `resource_context: params.resourceContext ?? {}` to the gRPC call body

**Why:** This is the TypeScript wrapper that DPBE uses to send gRPC requests to auth-api. Without updating the function signature here, the `resourceContext` data collected by `role-access.ts` would be dropped before reaching the wire even after the proto file was updated.

---

### `DPBE-main/src/shared/middleware/role-access.ts`

**What changed:**
- Added `getResourceIdFromPath()` function — extracts the second URL segment after stripping the API prefix (e.g. `"abc-123"` from `/api/v1/devices/abc-123`, `undefined` from `/api/v1/devices`)
- Added import of `loadResourceContext` from `../utils/resource-loader`
- Calls `loadResourceContext(resource, resourceId)` before the gRPC call to fetch resource attributes from the DPBE database
- Passes the result as `resourceContext` in the `evaluateABAC` call
- Expanded the `subject` object to include `role` and `tenantId` (previously missing — the engine was evaluating role-based conditions without `role` in the subject)
- Replaced `console.log` calls with `logger.info` and `logger.warn`

**Why:** This middleware was the gap between the capability the engine gained and the data it received. Without extracting the resource ID from the URL and loading its attributes, resource conditions would always evaluate against an empty object — meaning they would always fail. The `role` field on `subject` was missing despite being the most important attribute for role-based policies.

---

### `DPBE-main/src/shared/utils/resource-loader.ts` *(new file)*

**What changed:**
- Created new utility file with a single exported function: `loadResourceContext(resourceType, resourceId)`
- Handles 6 resource types: `devices`, `assets`, `dashboards`, `alerts`, `groups`, `workflows`
- Returns a flat `Record<string, string>` of the resource's relevant attributes
- Returns `{}` when no `resourceId` is provided (list routes) or for unrecognised resource types

**Why:** This file is the "fetcher" in the PDP pattern. The engine is a pure computation function — it cannot touch the database. Something in the calling service must fetch the resource data and pass it in. This utility centralises that DB lookup logic so `role-access.ts` doesn't become cluttered with per-resource query logic. Returning `{}` for list routes and unknown types is safe — the engine will simply have no resource attributes to evaluate conditions against, so resource conditions on those routes will fail (return false), which is the correct secure default.

---

### `DPBE-main/src/routes/policies/type.ts`

**What changed:**
- Added `"resource"` to the condition category enum in the policies route type definitions

**Why:** The policies CRUD API in DPBE validates policy objects before storing them. Without `"resource"` in the allowed category list, any policy created via the API with a resource condition would be rejected at the API layer before ever reaching the ABAC engine.

---

### `auth-frontend-main/src/pages/private/iam/policies/constants.ts`

**What changed:**
- Added `"resource"` to the `AttributeCategory` type
- Added `"date"` and `"time"` to the `AttributeValueType` type (were missing despite the engine supporting them)
- Added `date` and `time` entries to `OPERATORS_BY_TYPE` so the operator dropdown shows correct options for those value types
- Updated `DEFAULT_SUBJECT_ATTRIBUTES` to match the real database: removed `groups`, `roleIds`, `dashboardId`; added `status`, `twoFa`, `isFirstLogin`, `phone`, `lastSeenAt`
- Updated `DEFAULT_ENVIRONMENT_ATTRIBUTES` to remove `locale`, add `tenantTimezone` and `licenseStatus`
- Added `RESOURCE_ATTRIBUTES` export — the full list of 7 resource attributes matching `DEFAULT_RESOURCE_ATTRIBUTES` in the engine
- Updated `getAttributesByCategory()` to return `RESOURCE_ATTRIBUTES` when `category === "resource"`

**Why:** The frontend policy builder was displaying attributes that don't exist in the database, and missing attributes that do. A policy built in the UI with a stale attribute like `groups` or `dashboardId` would never match at runtime because those fields are never present in the subject context that DPBE sends. The frontend must reflect exactly what the engine and the backend actually support.

---

### `auth-frontend-main/src/pages/private/iam/policies/components/condition-builder.tsx`

**What changed:**
- Added `Database` icon import from `lucide-react`
- Updated `getCategoryColor()` to return emerald colour classes for `"resource"`
- Updated the `CategoryIcon` component selection logic to render `Database` icon for `"resource"`
- Added `<option value="resource">Resource</option>` to the category dropdown

**Why:** The condition builder UI had no way to create resource conditions — the dropdown only showed `subject` and `environment`. Without adding the third option here, none of the engine or backend changes would be accessible from the UI.

---

### `auth-frontend-main/src/lib/locales/en.json`

**What changed:**
- Added `resourceOption: "Resource"` translation key for the category dropdown label
- Updated `subjectAttributes` section to match the corrected attribute list (removed stale keys, added new ones)
- Updated `environmentAttributes` section to include `tenantTimezone` and `licenseStatus`, remove `locale`
- Added new `resourceAttributes` section with `label` and `description` translation strings for all 7 resource attributes

**Why:** The condition builder uses dynamic i18n keys in the format `policies.${category}Attributes.${attr.key}.label`. Without the locale keys, attribute labels would display as raw translation key strings (e.g. `policies.resourceAttributes.tenantId.label`) instead of human-readable text.

---

## Session 2 — Engine Improvements

### Problem being solved

After Session 1, a review of the engine and the `ABAC_IMPROVEMENT_GUIDE.md` identified six remaining gaps:

1. The `workHoursRange` concept from the guide was never properly resolved. The functions `timeToMinutes()` and `getCurrentMinutes()` existed in `functions.ts` but were never called in any evaluation path. There was no way to express a time range in a single condition.
2. The orphaned `locale` resolver still existed in `DEFAULT_ENVIRONMENT_RESOLVERS` even after the `locale` attribute definition was removed. No attribute referenced it.
3. The `contextVariables` getter only included subject attributes and environment resolvers. Resource attributes like `{resource.tenantId}` were not surfaced in the context variable picker, so they could not be used as dynamic values in condition values.
4. The `can()` shorthand method built an `EvaluationContext` without a `resource` field, meaning any policy with resource conditions would always fail when called via `can()`.
5. The `explainAccess()` method returned `skipped: Policy[]` with no indication of *why* each policy was skipped, making debugging impossible.
6. The `ActionConfig` type had no way to communicate which HTTP methods map to which actions, making the `execute` and `manage` actions opaque to consuming services.

---

### `abac-solution-main/src/types/index.ts`

**What changed:**
- Added `"between"` to the `AttributeOperator` union type
- Added `httpMethods?: string[]` optional field to the `ActionConfig` interface
- Added new `SkippedPolicy` interface: `{ policy: Policy; reason: "resource_mismatch" | "action_mismatch" | "condition_failed" }`
- Updated `AccessExplanation` — changed `skipped: Policy[]` to `skipped: SkippedPolicy[]`

**Why (`between`):** The `workHour` attribute has `valueType: "time"` and is resolved by the `currentHHMM` resolver. Expressing a time range required two separate conditions with `conditionLogic: "AND"`. The `between` operator makes this expressible as a single condition: `workHour between "08:00-17:30"`, which is both more readable and less error-prone.

**Why (`httpMethods`):** The `execute` and `manage` actions are never produced by the HTTP method → action mapping in DPBE because there is no HTTP method that maps to them. Adding `httpMethods` to `ActionConfig` documents this relationship explicitly. For `execute` and `manage` the value is `[]`, signalling to consuming services that these actions must be set explicitly on specific routes, not derived from the HTTP method. This prevents policy authors from writing policies that use these actions without understanding they will never fire from standard HTTP requests.

**Why (`SkippedPolicy` / `AccessExplanation`):** When a policy is skipped during evaluation there are three distinct reasons: the resource didn't match, the action didn't match, or the conditions evaluated to false. The old `Policy[]` return type gave no indication of which reason applied. With `SkippedPolicy`, a caller can inspect the explanation and see exactly which policies were skipped and why — critical for debugging access control issues in production ("why is this policy not firing?").

---

### `abac-solution-main/src/config/constants.ts`

**What changed:**
- Added `"between"` to the `time` entry in `OPERATORS_BY_TYPE`

**Why:** `OPERATORS_BY_TYPE` controls which operators are offered in the UI for each value type. Without adding `"between"` here, `getOperatorsFor("time")` would not include it and the operator would not appear in the condition builder dropdown even though the engine supports it.

---

### `abac-solution-main/src/config/defaults.ts`

**What changed:**
- Added `{ value: "between", label: "Between", description: "Value is between two time values (HH:MM-HH:MM)" }` to `DEFAULT_OPERATORS`
- Added `httpMethods` arrays to all entries in `DEFAULT_ACTIONS`: `POST` for create, `GET` for read, `PUT/PATCH` for update, `DELETE` for delete, `[]` for execute and manage
- Removed the `locale` resolver from `DEFAULT_ENVIRONMENT_RESOLVERS`

**Why (`between` in operators):** `DEFAULT_OPERATORS` is the list of operators the engine exposes. Without the entry here, the operator has no label or description and would not appear in calls to `getOperatorsFor()`.

**Why (`httpMethods` on actions):** Documents the HTTP method mapping directly on each action definition. `execute` and `manage` have empty arrays to make it explicit that they are not auto-derivable from HTTP methods and must be set by routing logic.

**Why (locale resolver removal):** The `locale` attribute definition was removed in Session 1 because no backend code ever injected this value. However the corresponding resolver entry in `DEFAULT_ENVIRONMENT_RESOLVERS` was left behind by mistake. It had no `resolve` function (it was an override-only resolver) and no attribute in `DEFAULT_ENVIRONMENT_ATTRIBUTES` referenced it. Removing it eliminates the orphan.

---

### `abac-solution-main/src/config/schemas.ts`

**What changed:**
- Added `"between"` to the `attributeOperatorSchema` Zod enum

**Why:** `validatePolicy()` uses the Zod schema to validate policy objects before the engine processes them. Without `"between"` in the Zod enum, any policy that uses the `between` operator would fail validation and be rejected before reaching the evaluation logic. The type system, the constants, the defaults, and the Zod schema must all agree on the set of valid operators.

---

### `abac-solution-main/src/utils/operators.ts`

**What changed:**
- Added import of `timeToMinutes` from `./functions`
- Added `case "between"` to the `compare()` switch statement

The `between` implementation:
1. Requires both `left` (the attribute value, e.g. `"14:30"`) and `right` (the range string, e.g. `"08:00-17:30"`) to be strings
2. Finds the `-` separator by searching from position 3 (to skip past the `HH:` prefix and avoid splitting on the colon in `08:00`)
3. Splits into `start` and `end` time strings
4. Converts all three values to minutes-since-midnight using `timeToMinutes()`
5. Returns `cur >= start && cur <= end`

**Why:** `timeToMinutes()` and `getCurrentMinutes()` were already present in `functions.ts` but were never called from any evaluation path. The `between` case is the connection that makes them useful. The implementation uses `right.indexOf("-", 3)` rather than a simple `right.split("-")` because a naive split on `-` would break for ranges that start at midnight-adjacent times where the colon characters could be ambiguous. Starting the search at position 3 (after `HH:`) ensures we find the range separator dash and not a character inside the time value itself.

---

### `abac-solution-main/src/abac.ts`

**What changed:**
- Added `SkippedPolicy` to the import list from `"./types"`
- Updated the `contextVariables` getter — added a new block that maps `this.attributes.resource` to context variable entries with `{resource.X}` format values, placed between the subject block and the environment resolvers block
- Updated `explainAccess()` — changed `skipped: Policy[]` to `skipped: SkippedPolicy[]`, replaced the single `evaluatePolicy()` call with an inlined three-step check that records a specific skip reason at each step
- Updated `can()` — added `resourceContext?: Record<string, unknown>` to the params type, wired it into `context.resource`

**Why (`contextVariables`):** The context variable picker in the UI calls `getContextVariablesFor()` which filters `contextVariables`. Before this change, `{resource.tenantId}`, `{resource.ownerId}` etc. were not in the list. This meant that when building a condition like "resource.tenantId equals {subject.tenantId}" (full tenant isolation), the `{subject.tenantId}` variable was available in the picker but `{resource.X}` variables were not. The resource attributes are now included with `forCategories` set to all three categories so they appear when picking values for any condition type.

**Why (`explainAccess()`):** The previous implementation delegated to `evaluatePolicy()` which returned a single boolean and gave no information about the failure reason. The new implementation records the reason at each decision point — if the resource didn't match, `reason: "resource_mismatch"`. If the action didn't match, `reason: "action_mismatch"`. If conditions evaluated to false, `reason: "condition_failed"`. This makes the output of `explainAccess()` actually useful for debugging and for building diagnostic UIs that show administrators why a specific policy did not fire.

**Why (`can()`):** The `can()` method is the simple API for one-shot access checks. With `context.resource` being `undefined`, any resource condition would read from an empty bucket and return `false` (attribute not found → condition fails). A caller using `can()` with resource conditions would always get denied even if the resource attributes were present and the condition should pass. The `resourceContext` parameter fixes this.

---

---

## Session 3 — Frontend Action Selector Fix

### Problem being solved

`execute` and `manage` were fully defined in the type system (`ActionType` in `constants.ts`), present in the `ACTIONS` array in `constants.ts` with labels, descriptions, and colour classes, and documented with `httpMethods: []` on the engine's `ActionConfig`. But they were completely invisible in the policy builder UI.

The cause was in `action-selector.tsx`. Instead of importing and iterating over the `ACTIONS` array from `constants.ts`, the component had its own hardcoded local array called `CRUD_ACTIONS` containing only the four HTTP-mapped actions (`create`, `read`, `update`, `delete`). Every piece of logic in the component — the render loop, the select-all toggle, the counter badge — was wired to that local array. The `constants.ts` `ACTIONS` array was never used by this component at all.

The same gap existed in the locale file: `actionsDetail` only had translation keys for the four CRUD actions. The `execute` and `manage` keys were absent, meaning even if they had been rendered, their labels and descriptions would have fallen back to the raw hardcoded strings in the component instead of the translated values.

---

### `auth-frontend-main/src/pages/private/iam/policies/components/action-selector.tsx`

**What changed:**
- Removed the hardcoded local `CRUD_ACTIONS` array (4 entries) entirely
- Imported `ACTIONS` and `ActionType` from `../constants` — the single source of truth for all 6 actions
- Added `Play` icon import from `lucide-react` — assigned to `execute`
- Added `Settings2` icon import from `lucide-react` — assigned to `manage`
- Added `execute: Play` and `manage: Settings2` entries to the `ACTION_ICONS` map
- Replaced all 4 references to `CRUD_ACTIONS` with `ACTIONS`:
  - `isAllSelected` check now iterates all 6 actions
  - `handleSelectAll` now selects/deselects all 6 actions
  - The counter badge now reads `value.length / ACTIONS.length` (was hardcoded to 4)
  - The render loop now maps over all 6 actions

**Why:** The component was self-contained with a local definition that duplicated and truncated what `constants.ts` already provided. Any future action added to `ACTIONS` in `constants.ts` would still be invisible in the UI until someone also updated this local array — a maintenance trap. Using the imported `ACTIONS` directly makes the component automatically reflect any future additions. The grid renders all 6 actions in a `3×2` layout instead of `2×2`.

---

### `auth-frontend-main/src/lib/locales/en.json`

**What changed:**
- Added `execute` entry to `policies.actionsDetail`: `{ "label": "Execute", "description": "Run commands and operations" }`
- Added `manage` entry to `policies.actionsDetail`: `{ "label": "Manage", "description": "Full management capabilities" }`
- Updated `policies.actionsHint` from `"Allowed operations (create, read, update, delete)"` to `"Allowed operations (create, read, update, delete, execute, manage)"`

**Why:** The action selector renders labels and descriptions using dynamic i18n keys: `t("policies.actionsDetail.${action.value}.label", action.label)`. The second argument is a fallback — it uses the hardcoded string if the key is missing. Without the locale keys, the rendered labels would work but would be untranslatable and inconsistent with how every other label in the UI is handled. Adding them makes `execute` and `manage` behave identically to the other four actions in all language contexts.

---

## Files Changed — Complete Reference

| File | Repository | Session | Change type |
|---|---|---|---|
| `src/types/index.ts` | abac-solution-main | 1 + 2 + 4 | Modified |
| `src/abac.ts` | abac-solution-main | 1 + 2 + 4 | Modified |
| `src/config/defaults.ts` | abac-solution-main | 1 + 2 | Modified |
| `src/config/schemas.ts` | abac-solution-main | 1 + 2 + 4 | Modified |
| `src/config/constants.ts` | abac-solution-main | 2 + 4 | Modified |
| `src/utils/resolver.ts` | abac-solution-main | 1 | Modified |
| `src/utils/operators.ts` | abac-solution-main | 2 | Modified |
| `src/utils/functions.ts` | abac-solution-main | — | No change (used by new operator) |
| `src/index.ts` | abac-solution-main | 1 + 4 | Modified |
| `src/utils/ast-builder.ts` | abac-solution-main | 4 | Created (new file) |
| `src/utils/sql-translator.ts` | abac-solution-main | 4 | Created (new file) |
| `proto/auth.proto` | auth-api-main | 1 + 4 | Modified |
| `src/grpc/handlers.ts` | auth-api-main | 1 + 4 | Modified |
| `src/grpc/server.ts` | auth-api-main | 4 | Modified |
| `src/config/abac.ts` | DPBE-main | 1 | Modified — defaultEffect fix |
| `src/config/grpc-client.ts` | DPBE-main | 1 + 4 | Modified |
| `src/shared/middleware/role-access.ts` | DPBE-main | 1 + 6 | Modified |
| `src/shared/middleware/multi-tenant-access.ts` | DPBE-main | 6 | Modified |
| `src/shared/utils/resource-loader.ts` | DPBE-main | 1 | Created (new file) |
| `src/shared/utils/filter-translator.ts` | DPBE-main | 4 | Created (new file) |
| `src/shared/utils/hard-constraints.ts` | DPBE-main | 4 | Created (new file) |
| `src/shared/authz/abac-client.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/filter-to-drizzle.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/hard-constraints.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/planner.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/request-extractor.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/types.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/types/common.ts` | DPBE-main | 6 | Modified |
| `src/routes/policies/type.ts` | DPBE-main | 1 | Modified |
| `src/routes/assets/assets.service.ts` | DPBE-main | 6 | Modified |
| `src/routes/devices/devices.service.ts` | DPBE-main | 6 | Modified |
| `src/routes/dashboards/dashboards.service.ts` | DPBE-main | 6 | Modified |
| `src/routes/alerts/alerts.service.ts` | DPBE-main | 6 | Modified |
| `src/routes/alerts/alerts.controller.ts` | DPBE-main | 6 | Modified |
| `src/routes/alerts/index.ts` | DPBE-main | 6 | Modified |
| `src/routes/groups/groups.service.ts` | DPBE-main | 6 | Modified |
| `src/routes/workflows/workflows.service.ts` | DPBE-main | 6 | Modified |
| `src/shared/middleware/__tests__/role-access.test.ts` | DPBE-main | 6 | Modified |
| `src/shared/authz/__tests__/hard-constraints.test.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/__tests__/request-extractor.test.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/__tests__/planner.test.ts` | DPBE-main | 6 | Created (new file) |
| `src/shared/authz/__tests__/filter-to-drizzle.test.ts` | DPBE-main | 6 | Created (new file) |
| `src/pages/private/iam/policies/constants.ts` | auth-frontend-main | 1 + 5 | Modified |
| `src/pages/private/iam/policies/components/condition-builder.tsx` | auth-frontend-main | 1 + 5 | Modified |
| `src/pages/private/iam/policies/components/action-selector.tsx` | auth-frontend-main | 3 | Modified |
| `src/lib/locales/en.json` | auth-frontend-main | 1 + 3 + 5 | Modified |
| `package.json` | DPBE-main | 6 | Modified — restored `@digieye/abac`, added ESLint plugin |
| `pnpm-lock.yaml` | DPBE-main | 6 | Modified — dependency install update |

---

---

## Session 4 — Two-Phase Partial Evaluation System

### Problem being solved

The ABAC engine was a pure per-request allow/deny gate. Every list endpoint (`GET /devices`, `GET /assets`, etc.) worked like this:

```
GET /devices
→ role-access.ts calls evaluateABAC → returns { allowed: true }
→ DPBE runs: SELECT * FROM devices WHERE tenant_id = $1
→ returns ALL rows the tenant owns
```

The problem: policies like "users can only see devices in their group" or "only see ONLINE devices" were evaluated at the action level but never applied to the query. The engine approved the request, and DPBE returned every row regardless of what the policies said about which rows a user should see.

The only workaround was the per-resource fetch in `resource-loader.ts` — but that only applies to single-resource routes (`GET /devices/:id`). For list routes you cannot fetch every row, evaluate each one, and then filter — that defeats pagination and breaks at scale.

The solution is a two-phase model:

- **Phase 1 — Partial Evaluation:** The engine analyses the active policies and extracts everything that can be expressed as a database filter. It returns an AST (Abstract Syntax Tree) — a structured, database-agnostic representation of the filter conditions — plus a flag `requiresVerification` signalling whether Phase 2 is needed.
- **Phase 2 — Per-Row Verification (conditional):** If `requiresVerification` is `true`, the database query runs with the partial filter (narrowing the candidate set), then the engine runs `evaluateAccess()` on each returned row with its actual data as `context.resource`. Rows that fail are stripped before the response is sent.

This is the same architecture used by Cerbos for list filtering. Phase 1 is always fast. Phase 2 only runs when needed and operates on a pre-filtered smaller set.

During design, four additional correctness problems were identified and fixed before implementation:

**Issue #1 — DENY policies must be independently negated.** The original plan joined DENY policy groups with OR before negating: `NOT (A OR B)`. By De Morgan's law this equals `NOT A AND NOT B`, which merges conditions from separate policies into intersected restrictions — stricter than any individual policy intended. The fix is AND-join: each deny policy is wrapped in its own independent `NOT(...)`, producing `AND NOT(policyA) AND NOT(policyB)`.

**Issue #2 — Unconditional ALLOW must not short-circuit DENY processing.** A policy with no conditions (unconditional allow) was causing an early `return` inside the ALLOW processing loop, before the `denyGroups` array had been assembled into `excludeFilter`. This meant a tenant with "ALLOW: everyone can read devices" plus "DENY: status = deleted" would return deleted devices because the deny filter was dropped at the early return.

**Issue #3 — `null` includeFilter is ambiguous.** When no ALLOW policies matched and `defaultEffect` was `"deny"`, the engine returned `includeFilter: null`. But `null` means two different things depending on `defaultEffect`: "show everything" or "show nothing". This pushed a safety check onto every DPBE call site — a developer who forgot the check would accidentally return all rows. The fix is the `NEVER_MATCH` sentinel: a `FilterNode` that translates to `WHERE "1" = 0`, making the engine self-contained regardless of defaultEffect.

**Gap 1 — DENY conditions that are SQL-able should go into `excludeFilter`, not verification.** The original plan sent all DENY policies to `requiresVerification = true`. A policy like `DENY if status = "deleted"` is 100% SQL-able and should become `AND NOT (status = 'deleted')` in the query, not a per-row check. On a table with 100,000 rows where 20% are soft-deleted, that is 20,000 unnecessary per-row engine calls eliminated by a single `NOT` clause.

**Gap 2 — Query cost hints.** The binary `sqlCapable: boolean` flag gives no information about performance impact. `LIKE '%val%'` is SQL-able but causes a full table scan. The fix adds `queryCost` (advisory: `"low" | "medium" | "high"`) and `indexSafe: boolean` to every `FilterNode`. DPBE — which knows its index layout — can read these and optionally demote high-cost nodes to verification instead of SQL.

**Gap 3 — Hard constraints must be enforced unconditionally.** Tenant isolation must not depend on ABAC being configured correctly. A new `buildHardConstraints()` utility in DPBE enforces `tenant_id` (and optionally `deleted_at IS NULL`) at the query level before any ABAC filter is applied. If ABAC is misconfigured, tenant isolation still holds.

**Gap 4 — External dependency marker.** Some future policy conditions may need to call an external system (LDAP, feature flags). The optional `external?: boolean` field on `PolicyCondition` future-proofs the engine: `isSqlCapable()` routes any condition marked `external: true` directly to residuals without needing a new operator.

---

### `abac-solution-main/src/types/index.ts`

**What changed:**
- Added `external?: boolean` to `PolicyCondition` — optional flag for conditions requiring external runtime checks; `isSqlCapable()` routes these directly to residuals
- Added `FilterNodeCost` type alias: `"low" | "medium" | "high"`
- Added `OperatorSqlMeta` interface: `{ capable: boolean; cost: FilterNodeCost; indexSafe: boolean }`
- Added `FilterNode` interface — a single leaf AST node with `type: "condition"`, `field`, `operator`, `value`, `sqlCapable`, `queryCost`, `indexSafe`
- Added `FilterGroup` interface — a composite AST node with `type: "group"`, `logic: "AND" | "OR"`, and a recursive `conditions` array
- Added `ResidualCondition` interface — captures conditions that could not be pushed to SQL: `policyId`, `policyName`, `condition`, and a typed `reason` (`"non_resource_category" | "unresolvable_context_var" | "non_sql_operator" | "unknown_field" | "external_dependency"`)
- Added `FilterResult` interface — the full output of `partialEvaluate()`: `includeFilter`, `excludeFilter` (with documented semantics on the comment: each child is an independent `NOT(...)` veto), `requiresVerification`, `residualConditions`, `defaultEffect`

**Why:** These types are the complete contract between the ABAC engine and DPBE. Every field has a specific role in the two-phase model. The comments on `excludeFilter` explicitly document the NOT-per-child semantics to prevent future developers from misusing the field.

---

### `abac-solution-main/src/config/constants.ts`

**What changed:**
- Updated import to include `OperatorSqlMeta` from `"../types"`
- Added `SQL_OPERATOR_META: Record<AttributeOperator, OperatorSqlMeta>` — a full per-operator metadata table. Key entries:
  - `equals`, `not_equals`, `in`, `not_in`, comparison operators: `low` cost, `indexSafe: true`
  - `starts_with`: `medium` cost, `indexSafe: true` — `LIKE 'val%'` can use a B-tree index prefix scan
  - `ends_with`: `medium` cost, `indexSafe: false` — `LIKE '%val'` cannot use an index
  - `contains`, `not_contains`: `high` cost, `indexSafe: false` — `LIKE '%val%'` forces a full table scan
  - `regex`: `capable: false`, `high` cost — not SQL-translatable at all
- Added `SQL_CAPABLE_OPERATORS: Record<AttributeOperator, boolean>` — derived from `SQL_OPERATOR_META` for backward compatibility and simple lookup in `isSqlCapable()`

**Why:** Separating the metadata table from the boolean map gives DPBE useful advisory information (cost, indexSafe) while keeping the `isSqlCapable()` logic in `ast-builder.ts` simple. `SQL_CAPABLE_OPERATORS` is derived rather than hand-maintained so the two never drift out of sync.

---

### `abac-solution-main/src/utils/ast-builder.ts` *(new file)*

**What changed:**
- Created new module. Contains all the pure functions that drive `partialEvaluate()`.

**`NEVER_MATCH` sentinel constant:**
A `FilterNode` with `field: "1"`, `operator: "equals"`, `value: 0`. Translates to `WHERE "1" = 0` — a condition that is always false. Returned as `includeFilter` when `defaultEffect` is `"deny"` and no ALLOW policies matched. Makes the engine self-contained: callers never need to check `defaultEffect` themselves to decide whether to return zero rows.

**`isSqlCapable(condition, context, knownResourceFields)`:**
Checks five gates in order:
1. `condition.external === true` → `"external_dependency"` — routes to residuals immediately
2. `condition.category !== "resource"` → `"non_resource_category"` — subject/environment conditions are not DB columns
3. Field not in `knownResourceFields` → `"unknown_field"` — the attribute isn't in the resource's schema
4. Operator not capable per `SQL_OPERATOR_META` → `"non_sql_operator"` — e.g. `regex`
5. Value is a context variable and the prefix is not `"subject."` → `"unresolvable_context_var"` — `{environment.time}` cannot be resolved at plan time; `{subject.userId}` can because the subject is known

**`resolveAtPlanTime(value, context)`:**
For `{subject.X}` variables, reads the actual value from `context.subject` at plan time and inlines it into the `FilterNode`. For literals, returns as-is. This is what allows `resource.groupId == {subject.groupId}` to be SQL-able: the subject's `groupId` is known when the query is being planned.

**`buildFilterNode(condition, context)`:**
Builds a `FilterNode` from a confirmed SQL-able condition. Reads cost and indexSafe from `SQL_OPERATOR_META` and populates the node's advisory fields.

**`buildFilterResult(policies, context, targetResource, knownResourceFields, defaultEffect)`:**
The main entry point. Key implementation decisions:
- Filters to active policies that match the resource type and action before processing
- Processes DENY policies first, before the ALLOW loop, so `denyGroups` is fully assembled before any return path fires (Issue #2 fix)
- SQL-able DENY conditions go into `denyGroups`; non-SQL-able DENY conditions go to `allResiduals` + `requiresVerification = true`
- `excludeFilter` is assembled from `denyGroups` with AND logic (Issue #1 fix): single group returned as-is; multiple groups wrapped in `{ logic: "AND" }` so the SQL translator can iterate and wrap each child in `NOT()` independently
- Inside the ALLOW loop: `policy.conditions.length === 0` sets `hasUnconditionalAllow = true` and `continue`s — never returns early (Issue #2 fix)
- After the ALLOW loop: if `hasUnconditionalAllow`, returns `includeFilter: null` with `excludeFilter` preserved
- If `policyGroups.length === 0` and `defaultEffect === "deny"`, returns `includeFilter: NEVER_MATCH` (Issue #3 fix)
- Multiple ALLOW policies are joined with OR logic: any matching policy grants access

**Why a separate file:** The AST building logic has no side effects, is independently testable, and has no dependency on the ABAC class — only on the types and the SQL metadata. Keeping it separate makes the class smaller and keeps the two concerns (evaluation and query planning) clearly separated.

---

### `abac-solution-main/src/utils/sql-translator.ts` *(new file)*

**What changed:**
- Created new module. Converts `FilterNode | FilterGroup` AST into parameterised PostgreSQL SQL.

**`toSql(node, offset)`:**
Recursive translator. For `FilterNode`: maps each operator to its SQL fragment using positional parameters (`$1`, `$2`, ...). For `FilterGroup`: recursively translates each child, tracks parameter offsets cumulatively across children so parameter numbers never repeat. Groups with multiple conditions are joined with ` AND ` or ` OR ` and wrapped in parentheses when needed for precedence. The `between` case uses `str.indexOf("-", 3)` to find the range separator — starting at position 3 to skip past the `HH:` part of `HH:MM` time strings and avoid splitting on the colon.

**`excludeToSqlParts(excludeFilter, offset)`:**
Specialised translator for the `excludeFilter` from `FilterResult`. This exists as a separate function because `excludeFilter` must NOT be wrapped in a single `NOT()`. The correct output is one `NOT(...)` fragment per deny policy.
- If `excludeFilter` is a single `FilterNode`: returns `[{ sql: "NOT (field = $1)", params }]`
- If `excludeFilter` is a group with `logic: "AND"` (multiple deny policies): iterates each child and returns a separate `NOT(child)` fragment for each, tracking parameter offsets across iterations
- If `excludeFilter` is a group with `logic: "OR"` (single deny policy with OR-logic conditions): wraps the whole group in one `NOT()`

**Why a separate file:** The AST is database-agnostic. DPBE uses drizzle-orm with PostgreSQL positional params (`$1`). A MySQL service would use `?` params. Having the translator as a separate exportable function decouples the AST format from the SQL dialect — a different translator could be written for a different database without touching the engine.

---

### `abac-solution-main/src/abac.ts`

**What changed:**
- Added `FilterResult` to the type imports from `"./types"`
- Added `buildFilterResult` to the imports from `"./utils/ast-builder"`
- Added `partialEvaluate(policies, context, targetResource)` method to the ABAC class

The method signature takes `Omit<EvaluationContext, "resource">` because at list-query plan time, no specific resource instance is known — that is the point of Phase 1. It builds the `knownResourceFields` set from `this.attributes.resource` and delegates to `buildFilterResult()`. The `defaultEffect` is read from the class instance so it matches the configured behaviour of the engine instance.

**Why:** The method is a thin wrapper on `buildFilterResult()`. It lives on the class so consuming services can call `abac.partialEvaluate()` consistently with the other evaluation methods, and so it automatically has access to the configured resource attributes and defaultEffect.

---

### `abac-solution-main/src/config/schemas.ts`

**What changed:**
- Added `external: z.boolean().optional()` to `policyConditionSchema` — allows policies with externally-evaluated conditions to be validated without error
- Added `filterNodeSchema` — validates a `FilterNode` JSON object with all required fields including `queryCost` and `indexSafe`
- Added `filterGroupSchema` — recursive schema using `z.lazy()` to handle the self-referential `conditions` array
- Added `filterResultSchema` — validates the complete `FilterResult` shape including both filter fields and the typed `reason` enum in `residualConditions`

**Why:** The AST is transmitted over gRPC as JSON strings. When DPBE calls `JSON.parse()` on the response, it gets `unknown`. Running `filterResultSchema.parse(parsed)` validates the shape before it reaches `buildDrizzleWhereClause()`, preventing silent type errors from malformed or mismatched responses. The `z.lazy()` on `filterGroupSchema` is required because the `conditions` array can contain `FilterGroup` itself — without lazy evaluation Zod would throw a reference error during module initialisation.

---

### `abac-solution-main/src/index.ts`

**What changed:**
- Added explicit export of `buildFilterResult`, `buildFilterNode`, `isSqlCapable`, `resolveAtPlanTime`, `NEVER_MATCH` from `"./utils/ast-builder"`
- Added explicit export of `toSql`, `excludeToSqlParts` from `"./utils/sql-translator"`

**Why:** DPBE's `filter-translator.ts` imports `toSql` and `excludeToSqlParts` directly from `@digieye/abac`. Without explicit exports these functions would not be on the package's public surface. The engine's types (`FilterNode`, `FilterGroup`, `FilterResult`) are already covered by the existing `export * from "./types"` wildcard.

---

### `auth-api-main/proto/auth.proto`

**What changed:**
- Added `rpc PartialEvaluateABAC(PartialEvalABACRequest) returns (PartialEvalABACResponse)` to the `AuthService` service definition
- Added `PartialEvalABACRequest` message — same fields as `EvaluateABACRequest` minus `resource_context` (no single resource at list-query time)
- Added `PartialEvalABACResponse` message — eight fields:
  - `include_filter: string` — JSON-serialised `FilterNode | FilterGroup | null`
  - `exclude_filter: string` — JSON-serialised `FilterNode | FilterGroup | null`
  - `requires_verification: bool`
  - `residual_conditions: string` — JSON-serialised `ResidualCondition[]`
  - `default_effect: string` — `"allow"` or `"deny"`
  - `schema_version: uint32`
  - `policy_ids: repeated string`
  - `warnings: repeated string`

The AST fields use `string` type (JSON) rather than a nested protobuf message structure because the `FilterGroup` type is recursive. Protobuf handles recursive structures poorly without significant nesting overhead. JSON-in-string is the same approach used by Cerbos for its plan response.

**Why a new RPC:** The existing `EvaluateABAC` RPC returns `{ allowed, reason, matched_policy_name }` — a completely different shape. Adding a second RPC keeps the two use cases independent: single-resource access checks continue to use `EvaluateABAC`; list queries use `PartialEvaluateABAC`. There is no shared structure to merge.

---

### `auth-api-main/src/grpc/handlers.ts`

**What changed:**
- Added `partialEvaluateABAC` handler function following the same code structure as the existing `evaluateABAC` handler

The handler:
1. Returns a no-filter/allow-all response immediately if `tenant_id` is missing (same guard as `evaluateABAC`)
2. Fetches tenant policies and user roles from the database (same queries as `evaluateABAC`)
3. Maps raw DB rows to typed `Policy` objects (same mapping logic as `evaluateABAC`)
4. Builds a context with `subject` (userId, roles, and request subject fields) and `environment` — no `resource` bucket, since this is a list query
5. Calls `abac.partialEvaluate(mappedPolicies, context, resource)`
6. Logs the result with tenant, user, action, resource, `requiresVerification`, and residuals count
7. Returns JSON-serialised `includeFilter`, `excludeFilter`, `residualConditions`, `requiresVerification`, `defaultEffect`, `schemaVersion`, `policyIds`, and `warnings`
8. On any error, returns a safe default: `includeFilter: "null"`, `excludeFilter: "null"`, `requiresVerification: true`, `defaultEffect: "deny"` — forces Phase 2 verification on error so access control degrades safely rather than openly

**Why:** auth-api is the PDP. It owns the policy store and the ABAC engine instance. DPBE never has direct access to the policies — it always goes through auth-api. The handler reuses the same DB query pattern and policy mapping logic as `evaluateABAC` to keep the two handlers consistent and avoid duplication that could drift.

---

### `auth-api-main/src/grpc/server.ts`

**What changed:**
- Added `partialEvaluateABAC` to the import from `"./handlers"`
- Added `PartialEvaluateABAC: partialEvaluateABAC` to the service map in `server.addService()`

**Why:** The gRPC server maps proto RPC names to handler functions in the service map. Without this registration, calling `PartialEvaluateABAC` from DPBE would return an `UNIMPLEMENTED` gRPC error. The service map key `PartialEvaluateABAC` must match the RPC name defined in the proto file exactly (case-sensitive).

---

### `DPBE-main/src/config/grpc-client.ts`

**What changed:**
- Added `PartialEvalResponse` interface with fields matching the proto response: `includeFilter`, `excludeFilter`, `requiresVerification`, `residualConditions`, `defaultEffect`, `schemaVersion`, `policyIds`, and `warnings`
- Added `partialEvaluateABAC(params)` function — a Promise wrapper around `getClient().PartialEvaluateABAC()` following the same pattern as the existing `evaluateABAC` wrapper

The function maps proto field names (`include_filter`, `exclude_filter`, etc.) to camelCase TypeScript names on the response object. This is consistent with how `evaluateABAC` maps `matched_policy_name` to `matchedPolicyName`.

**Why:** This file is DPBE's single point of contact with all gRPC methods. Adding the new function here keeps the pattern consistent — every gRPC call in DPBE goes through a typed wrapper in this file, never a raw `getClient()` call in application code. Route handlers and middleware import from here, not from the gRPC client directly.

---

### `DPBE-main/src/shared/utils/filter-translator.ts` *(new file)*

**What changed:**
- Created new utility with two exported functions:

**`buildDrizzleWhereClause(result, hardConstraints)`:**
Takes a `FilterResult` and a mandatory `hardConstraints` SQL expression (from `buildHardConstraints()`). Assembles the final WHERE clause in three layers:
1. `hardConstraints` — always first, unconditional
2. If `includeFilter` is not null: calls `toSql(result.includeFilter)` and wraps in parentheses
3. If `excludeFilter` is not null: calls `excludeToSqlParts(result.excludeFilter)` which returns one fragment per deny policy, each already wrapped in `NOT(...)`, and pushes each one as a separate AND condition

Returns a drizzle-orm `SQL` expression via `and(...parts)`. Uses drizzle's `sql.raw()` with params for all ABAC-generated fragments.

**`parsePartialEvalResponse(res)`:**
Convenience function that takes the raw gRPC response object (with JSON strings) and parses them into a typed `FilterResult`. JSON.parse on `includeFilter` and `excludeFilter` gives back `FilterNode | FilterGroup | null`. `residualConditions` parses to the typed array. `defaultEffect` is cast to `"allow" | "deny"`.

**Why:** drizzle-orm's `sql` tag is a DPBE dependency — the engine package must not depend on any ORM. Keeping the drizzle adapter in DPBE means the engine's `toSql()` output (generic `{ sql, params }`) stays database-agnostic. This file is the boundary where the package's SQL fragments become drizzle-specific expressions. The `parsePartialEvalResponse` helper prevents repetition of the same JSON.parse pattern in every list handler.

---

### `DPBE-main/src/shared/utils/hard-constraints.ts` *(new file)*

**What changed:**
- Created new utility with `HardConstraintOptions` interface and `buildHardConstraints(table, options)` function

The function builds a drizzle-orm SQL expression from a table object and options:
- Always includes `eq(table.tenantId, options.tenantId)` — the core tenant isolation guard
- If `options.excludeSoftDeleted` is `true` AND `table.deletedAt` exists: also includes `isNull(table.deletedAt)` — the soft-delete guard

The `table` parameter is typed as `Record<string, any>` so the function works with any drizzle table object that has a `tenantId` column.

**Why:** Tenant isolation must be a hard guarantee — it cannot depend on ABAC being configured correctly. If a policy is misconfigured to grant cross-tenant access, or if the partial evaluator has a bug, the `tenant_id` filter in the WHERE clause still prevents data from leaking across tenant boundaries. The soft-delete guard is optional because not all tables have soft-delete, and passing `excludeSoftDeleted: true` for a table that has no `deletedAt` column safely skips it.

**Relationship to ABAC filters:** The ABAC-derived `includeFilter` and `excludeFilter` in `buildDrizzleWhereClause` are layered ON TOP of hard constraints. Hard constraints are system-enforced invariants. ABAC filters are policy-driven and configurable by administrators. The two are complementary and independent — an administrator can never write a policy that overrides tenant isolation.

---

## Session 5 — Frontend Condition Builder Alignment

### Problem being solved

After Sessions 2 and 4, the backend engine supported 14 operators (including `between`, `regex`, `greater_than_or_equal`, `less_than_or_equal`), the `PolicyCondition` type had a new `external?: boolean` field, and the partial evaluation system exposed `queryCost`/`indexSafe` advisory data per `FilterNode`. None of these were reflected in the frontend policy builder.

Three specific gaps existed:

1. **Missing operators in the UI** — the frontend `AttributeOperator` type had 10 values. The engine had 14. `between`, `regex`, `greater_than_or_equal`, and `less_than_or_equal` were completely absent from the operator dropdown. A policy saved through the UI could never use a time-range condition (`workHour between "08:00-17:30"`) because the operator was not offered.

2. **Stale subject attributes** — `SUBJECT_ATTRIBUTES` in `constants.ts` still listed 14 fields including `isActive`, `status` (Online Status), `twoFa`, `isFirstLogin`, `createdAt`, `lastSeenAt`, and `clearanceLevel`. These 7 fields either carry internal implementation detail that policy authors should not condition on, or they are date/boolean fields that require more context than the UI currently provides to use safely. The list was trimmed to the 7 fields that are both meaningful for policy writing and stable: `role`, `userId`, `tenantId`, `email`, `username`, `phone`, `department`.

3. **No `between` UI** — the `ValueInput` component rendered a plain text input for all time-type conditions. A user selecting `between` would need to know the exact `"HH:MM-HH:MM"` format and type it manually with no guidance. The `external` field had no UI at all, and the `queryCost`/`indexSafe` metadata coming from the engine had no surface in the frontend.

---

### `auth-frontend-main/src/pages/private/iam/policies/constants.ts`

**What changed — `AttributeOperator` type:**
- Added `"greater_than_or_equal"`, `"less_than_or_equal"`, `"between"`, `"regex"` to the union
- Type now has 14 members, matching the engine's `AttributeOperator` exactly

**What changed — `PolicyCondition` interface:**
- Added `external?: boolean` — matches the backend `PolicyCondition` type added in Session 4. When set to `true`, the engine's `isSqlCapable()` routes the condition to `residualConditions` immediately, bypassing SQL translation.

**What changed — `OPERATORS` array:**
- Added `greater_than_or_equal`: label `"≥ Greater or Equal"`, description `"Greater than or equal"`
- Added `less_than_or_equal`: label `"≤ Less or Equal"`, description `"Less than or equal"`
- Added `between`: label `"Between (time range)"`, description explicitly states the `HH:MM-HH:MM` format so it appears in any tooltip or description surface
- Added `regex`: label `"Regex Match"`, description notes it is not pushed to SQL — important advisory for policy authors using `resource` conditions

**What changed — `OPERATOR_COST` map (new export):**
A new exported constant `OPERATOR_COST: Record<AttributeOperator, { cost: "low" | "medium" | "high"; indexSafe: boolean }>` that mirrors `SQL_OPERATOR_META` from the engine exactly, with the same values for all 14 operators. This is consumed by the condition builder to show advisory warnings. Key entries:
- `contains`, `not_contains`, `regex`: `high` cost, `indexSafe: false` — full table scan
- `ends_with`: `medium` cost, `indexSafe: false` — `LIKE '%val'` cannot use an index
- `starts_with`: `medium` cost, `indexSafe: true` — `LIKE 'val%'` can use a prefix scan
- All comparison and equality operators: `low` cost, `indexSafe: true`

**What changed — `OPERATORS_BY_TYPE`:**
- `number`: added `"greater_than_or_equal"`, `"less_than_or_equal"`
- `date`: added `"greater_than_or_equal"`, `"less_than_or_equal"`
- `time`: added `"greater_than_or_equal"`, `"less_than_or_equal"`, `"between"`
- `string`: added `"regex"`

Before this change, `getOperatorsForValueType("date")` returned only 4 operators. After, it returns 6. `getOperatorsForValueType("time")` now includes `between`, which is the primary use case for that operator.

**What changed — `SUBJECT_ATTRIBUTES`:**
Removed 7 fields: `isActive`, `status`, `twoFa`, `isFirstLogin`, `createdAt`, `lastSeenAt`, `clearanceLevel`.

Kept 7 fields: `role`, `userId`, `tenantId`, `email`, `username`, `phone`, `department`.

Rationale for each removal:
- `isActive` — an internal account flag set by the system, not meaningful as a policy discriminator in normal operations. Policies should use `role` or `tenantId` for access control, not whether an account is technically active.
- `status` (Online Status) — a real-time ONLINE/OFFLINE presence flag. Conditioning policies on this is architecturally fragile — a user's session status can change mid-request.
- `twoFa` — a boolean that changes when a user enables/disables 2FA. Safe in principle but creates support complexity when 2FA is temporarily disabled for a reset.
- `isFirstLogin` — a one-time transient flag. Using it in a long-lived policy creates invisible edge cases.
- `createdAt` — a date field. Date comparisons require knowing the exact format injected by `role-access.ts`, and the current UI has no date picker for condition values.
- `lastSeenAt` — same date format issue as `createdAt`, and the semantics ("deny if not seen in 90 days") require a relative date calculation the current engine does not support.
- `clearanceLevel` — a number field from `users.attributes.clearanceLevel` (stored in a JSON column, not a top-level column). The path to inject it reliably into the subject context is not yet wired.

**Why:** The removed fields do not break any existing saved policies — the engine and `role-access.ts` still inject those values at runtime. The change only affects the picker UI: new policies can no longer be created with those attributes. Existing policies that already use them continue to evaluate correctly.

---

### `auth-frontend-main/src/pages/private/iam/policies/components/condition-builder.tsx`

**What changed — imports:**
- Added `AlertTriangle` and `ExternalLink` to the lucide-react icon imports
- Added `OPERATOR_COST` to the imports from `"../constants"`

**What changed — `ValueInputProps` interface:**
- Added `operator: AttributeOperator` as a required prop so `ValueInput` can inspect the selected operator, not just the attribute's value type

**What changed — new `BetweenTimeInput` component:**
A new internal component that renders two `<input type="time">` fields side by side with `From` and `To` labels. It:
- Parses the stored `"HH:MM-HH:MM"` string by calling `indexOf("-", 3)` to find the separator — starting at position 3 to skip past the colon inside `HH:MM`, matching the exact same logic used in the backend's `operators.ts` `compare()` function and `sql-translator.ts` `conditionToSql()` function
- Updates either the from or to part and rejoins with `-` as the separator
- Produces a value that the engine's `between` case can parse without any transformation

**What changed — `ValueInput` function:**
- Added a new branch at the top of the function: `if (operator === "between" && valueType === "time")` → renders `BetweenTimeInput`. This branch fires before all other type-based branches, giving `between` dedicated treatment.

**What changed — `ConditionCard` component:**

*Cost warning badge under operator select:*
After the operator `<select>` element, a conditional `<p>` renders when:
1. `condition.category === "resource"` — cost warnings only apply to resource conditions since subject/environment conditions are never pushed to SQL
2. `costMeta.cost === "high"` OR (`costMeta.cost === "medium"` AND `!costMeta.indexSafe`) — medium cost is only warned when it is also not index-safe

The warning shows an `AlertTriangle` icon with the appropriate locale key. The text for `high` cost reads: `"Full table scan — may be slow on large datasets"`. For `medium` non-index-safe: `"Partial index — consider for large tables"`.

*External toggle button in the condition header:*
The header now has a two-element right side instead of a single delete button:
- An `"External Check"` toggle button using the `ExternalLink` icon. When inactive it shows as a muted border button. When active (`condition.external === true`) it fills with amber background. Clicking it calls `onChange({ ...condition, external: !condition.external })` — toggles the `external` flag on the condition.
- An amber `"External"` badge in the left side of the header that appears when `condition.external === true`, giving a persistent visual indicator that the condition will bypass SQL translation.
- The delete button is preserved, now part of the right-side group alongside the external toggle.

*`col-span-2` for `between` value:*
The value field's `col-span-2` logic was extended: it now also spans full width when `condition.attribute.operator === "between" && selectedAttribute?.valueType === "time"`. The two time picker inputs need the full row width to be usable.

---

### `auth-frontend-main/src/lib/locales/en.json`

**What changed — `policies.operators`:**
Added 4 new keys:
- `"greater_than_or_equal"`: `"≥ Greater or Equal"`
- `"less_than_or_equal"`: `"≤ Less or Equal"`
- `"between"`: `"Between (time range)"`
- `"regex"`: `"Regex Match"`

**What changed — `policies.subjectAttributes`:**
Removed 7 entries matching the attributes removed from `SUBJECT_ATTRIBUTES`: `isActive`, `status`, `twoFa`, `isFirstLogin`, `createdAt`, `lastSeenAt`, `clearanceLevel`.
Kept 7 entries: `role`, `userId`, `tenantId`, `email`, `username`, `phone`, `department`.

**What changed — new keys added:**
- `policies.betweenFromLabel`: `"From"` — label above the first time picker in `BetweenTimeInput`
- `policies.betweenToLabel`: `"To"` — label above the second time picker
- `policies.externalLabel`: `"External"` — the badge text shown in the condition card header when external is active
- `policies.externalConditionLabel`: `"External Check"` — the toggle button label and its `title` attribute
- `policies.externalConditionDesc`: `"This condition requires a runtime external check and will not be pushed to the database query"` — available for tooltips
- `policies.operatorCostHigh`: `"Full table scan — may be slow on large datasets"` — the warning text for high-cost operators
- `policies.operatorCostMedium`: `"Partial index — consider for large tables"` — the warning text for medium-cost non-index-safe operators

---

## Session 6 — ABAC V2 Phase 5 DPBE Hardening and Route Wiring

### Problem being solved

Session 4 implemented the engine-level two-phase partial evaluation model, but several DPBE integration gaps remained before the design was safe for real list endpoints:

1. **Hard constraints were not consistently applied to every protected resource.** Tenant isolation and resource identity checks had to be enforced at the DPBE query layer, independent of ABAC policy output.
2. **Tenant hierarchy support was missing.** A user with access to multiple descendant tenants needed row queries scoped to all accessible tenants, while still falling back to the effective tenant when hierarchy expansion was unavailable.
3. **Several DPBE resources were not wired to list-route ABAC filtering.** Dashboards, alerts, groups, and workflows needed the same partial-evaluation + residual verification path already added for devices/assets.
4. **Middleware read-empty and fail-closed behavior was incomplete.** Denied collection/detail reads needed to return empty results instead of leaking 403 responses, and protected detail updates/deletes needed to fail closed when resource attributes were missing.
5. **Alert action endpoints could leak cross-tenant config/history.** `GET /alerts/actions/schema` and `GET /alerts/:id/history` needed to resolve the alert through tenant/resource hard constraints before returning config schema or action history.

The result is a DPBE-side hardening pass that keeps `@digieye/abac` as the Policy Decision Point while making DPBE the Policy Enforcement Point for query boundaries.

---

### `DPBE-main/src/shared/authz/types.ts` *(new file)*

**What changed:**
- Added DPBE authorization types for the partial-evaluation integration:
  - `AuthorizationRequest`
  - `PartialEvaluateResponse`
  - `AuthorizationPlan`
  - `AuthorizationWhereClauseResult`
  - `AuthorizationFilter`
  - `FilterNode`
  - `FilterGroup`
  - `ResidualCondition`
  - `SQLConstraint`
- Added `accessibleTenantIds?: string[]` to `AuthorizationRequest`.
- Added `policyIds: string[]` and `warnings: string[]` to `PartialEvaluateResponse` and `AuthorizationPlan`.

**Why:** DPBE needs a typed contract between extracted request context, auth-api partial evaluation responses, auth plans, and Drizzle WHERE clauses. The extra `policyIds` and `warnings` fields preserve diagnostic data returned by auth-api so list-route logging can show which policies and cost warnings affected a query.

---

### `DPBE-main/src/shared/types/common.ts`

**What changed:**
- Added `accessibleTenantIds?: string[]` to `AuthenticatedRequest`.

**Why:** Multi-tenant access checks can expand a user's effective tenant into descendant tenants. DPBE middleware and downstream authz extraction need access to that expanded tenant list without coupling route handlers to the tenant hierarchy implementation.

---

### `DPBE-main/src/shared/authz/request-extractor.ts` *(new file)*

**What changed:**
- Added `extractAuthorizationRequest(req, tenantId?)`.
- Normalizes request path, resource, resource id, action, query, body, subject, and environment into `AuthorizationRequest`.
- Maps command send/retry/cancel routes to `action: "execute"`.
- Extracts device ids from command device routes.
- Carries `req.accessibleTenantIds` into `AuthorizationRequest.accessibleTenantIds`.
- Serializes `accessibleTenantIds` into `environment.accessibleTenantIds` as a comma-separated string.

**Why:** The auth-api partial evaluation RPC accepts string environment fields. DPBE can carry the expanded tenant array internally, but it must serialize it into the gRPC environment map for the ABAC engine to see it during partial evaluation.

---

### `DPBE-main/src/shared/authz/hard-constraints.ts` *(new file)*

**What changed:**
- Added `buildTenantConstraint(tenantId, column, accessibleTenantIds?)`.
  - Multiple accessible tenants produce `inArray(column, accessibleTenantIds)` with `reason: "tenant_hierarchy"`.
  - A single expanded tenant or the effective tenant produces `eq(column, tenantId)` with `reason: "tenant_scope"`.
  - Missing tenant returns `null`.
- Added UUID validation for resource ids.
- Added `buildResourceIdConstraint(request, idColumn)`.
  - Valid resource id produces `eq(idColumn, resourceId)` with `reason: "resource_identity"`.
  - Malformed resource id produces `eq(idColumn, "00000000-0000-0000-0000-000000000000")` with `reason: "malformed_resource_id"`, which is never true for real rows.
- Added resource-specific hard constraint builders:
  - `buildAssetsHardConstraints`
  - `buildDevicesHardConstraints`
  - `buildDashboardsHardConstraints`
  - `buildAlertsHardConstraints`
  - `buildGroupsHardConstraints`
  - `buildWorkflowsHardConstraints`
- Added `buildHardConstraintWhere(constraints)` to combine constraints into a single WHERE clause.

**Why:** Tenant isolation and resource identity are system invariants. They must be enforced in the database query regardless of whether ABAC policies are configured correctly. Malformed ids should not accidentally match another row; the never-matching UUID constraint makes the query safely return zero rows.

---

### `DPBE-main/src/shared/authz/filter-to-drizzle.ts` *(new file)*

**What changed:**
- Added `filterToSql(table, filter)` to translate `AuthorizationFilter` into Drizzle SQL.
- Added `excludeFilterToSqlParts(table, excludeFilter)` to translate `excludeFilter` into independent `NOT(...)` fragments.
- Added `combineWhere(...filters)` to combine hard constraints, ABAC filters, exclude filters, and user query filters.
- Supports ABAC operators:
  - `equals`
  - `not_equals`
  - `greater_than`
  - `less_than`
  - `greater_than_or_equal`
  - `less_than_or_equal`
  - `contains`
  - `not_contains`
  - `starts_with`
  - `ends_with`
  - `in`
  - `not_in`
  - `between`
- Escapes `%` and `_` for `LIKE`/`NOT LIKE` conditions.
- Handles empty `in` as `1 = 0` and empty `not_in` as `1 = 1`.

**Why:** The ABAC engine emits a database-agnostic AST. DPBE needs a Drizzle-specific adapter to turn that AST into SQL while preserving the semantic correctness fixes from the engine, especially independent negation of each DENY policy.

---

### `DPBE-main/src/shared/authz/abac-client.ts` *(new file)*

**What changed:**
- Added `partialEvaluateAuthorization(request)`.
- Calls `partialEvaluateABAC` from `src/config/grpc-client`.
- Parses JSON `includeFilter`, `excludeFilter`, and `residualConditions` from auth-api.
- Normalizes `defaultEffect` to `"allow"` or `"deny"`.
- Returns a `PartialEvaluateResponse` with `schemaVersion`, filters, residual conditions, `policyIds`, and `warnings`.

**Why:** List routes need a typed DPBE wrapper around the auth-api partial evaluation RPC. This keeps parsing and normalization out of every route handler.

---

### `DPBE-main/src/shared/authz/planner.ts` *(new file)*

**What changed:**
- Added auth plan builders and WHERE clause builders for:
  - `assets`
  - `dashboards`
  - `alerts`
  - `groups`
  - `workflows`
  - `devices`
- Added `normalizeDefaultEffect(includeFilter, defaultEffect, requiresVerification, residualConditions)`.
  - If an include filter exists, it is preserved.
  - If `defaultEffect: "deny"` and there are no residual conditions, returns `NEVER_MATCH`.
  - If `defaultEffect: "deny"` but `requiresVerification: true` and residuals exist, keeps `includeFilter: null` so residual verification can run and strip unauthorized rows.
- Combines hard constraints, include filters, exclude filters, and user query filters into one WHERE clause.
- Exports `isNeverMatch` and `normalizeDefaultEffect`.

**Why:** DPBE list routes need a reusable plan object that combines system hard constraints with ABAC policy filters. The default-deny residual case is intentionally different from the engine's normal `NEVER_MATCH` case: if the engine says residual verification is required, DPBE must keep the candidate set open so Phase 2 can remove unauthorized rows.

---

### `DPBE-main/src/routes/assets/assets.service.ts`

**What changed:**
- `getAllAssets` now builds an `AuthorizationRequest`, calls `partialEvaluateAuthorization`, builds an assets auth plan, and combines the auth WHERE clause with tenant/user filters.
- Residual verification is applied after fetching candidates when `authPlan.requiresVerification` is true.
- Detail/update/delete paths use `buildAssetsHardConstraints` to enforce tenant/resource identity before DB reads or writes.

**Why:** Assets list and detail routes now enforce both ABAC policy filters and DPBE hard constraints at the query layer.

---

### `DPBE-main/src/routes/devices/devices.service.ts`

**What changed:**
- `getAllDevices` now builds an `AuthorizationRequest`, calls `partialEvaluateAuthorization`, builds a devices auth plan, and combines the auth WHERE clause with tenant/user filters.
- Residual verification is applied after fetching candidates when `authPlan.requiresVerification` is true.
- Detail/update/delete paths use `buildDevicesHardConstraints` to enforce tenant/resource identity before DB reads or writes.

**Why:** Devices now share the same ABAC V2 query planning and hard-constraint path as other protected resources.

---

### `DPBE-main/src/routes/dashboards/dashboards.service.ts`

**What changed:**
- `getAllDashboards` now uses `partialEvaluateAuthorization`, `buildDashboardsAuthPlan`, and `buildDashboardsAuthWhereClauseFromPlan`.
- Adds residual verification for dashboards when required.
- Applies `MAX_VERIFICATION_CANDIDATES` guard to avoid unbounded residual verification.
- `getDashboardById`, update, and delete paths use `buildDashboardsHardConstraints`.

**Why:** Dashboards were added to the protected resource set and now cannot leak rows outside the tenant/resource hard boundary.

---

### `DPBE-main/src/routes/alerts/alerts.service.ts`

**What changed:**
- `getAllAlerts` now uses `partialEvaluateAuthorization`, `buildAlertsAuthPlan`, and `buildAlertsAuthWhereClauseFromPlan`.
- Adds residual verification for alerts when required.
- Applies `MAX_VERIFICATION_CANDIDATES` guard to avoid unbounded residual verification.
- `getAlertById`, `updateAlertById`, `deleteAlertById`, and `getStatistics` now apply alert hard constraints.
- `processAction` now fetches the alert through hard constraints before validating and applying the action.
- `getActionSchema({ alertId })` now fetches the alert through hard constraints before resolving `configAlertId`.
- `getActionHistory(alertId, request)` now fetches the alert through hard constraints before returning auth-api action history.
- `batchProcessAction` delegates to the constrained `processAction` path for each alert.

**Why:** Alert endpoints had multiple secondary lookup paths that could leak cross-tenant config schema or history if they resolved an alert id without tenant/resource checks. The alert route is now constrained at every read/write/history boundary.

---

### `DPBE-main/src/routes/alerts/alerts.controller.ts`

**What changed:**
- `getActionSchema`, `processAction`, and `getActionHistory` now accept and forward `AuthenticatedRequest`.

**Why:** Alert action schema and history need the request context so the service can build constrained auth requests before resolving alert ids or returning logs.

---

### `DPBE-main/src/routes/alerts/index.ts`

**What changed:**
- `/alerts/actions/schema` now passes `request: req` into the controller.
- `/alerts/:id/action` now passes `request: req` into the controller.
- `/alerts/:id/history` now passes `request: req` into the controller.
- Batch, create, update, delete, and list routes continue passing request context where needed.

**Why:** The alert action endpoints need the authenticated request context to enforce tenant/resource hard constraints.

---

### `DPBE-main/src/routes/groups/groups.service.ts`

**What changed:**
- `getAllGroups` now uses `partialEvaluateAuthorization`, `buildGroupsAuthPlan`, and `buildGroupsAuthWhereClauseFromPlan`.
- Recursive group expansion now applies auth WHERE clauses before verification.
- Residual verification is applied to both direct and recursive group result sets.
- Detail/update/delete paths use `buildGroupsHardConstraints`.

**Why:** Groups can contain nested membership, so both the initial candidate query and recursive expansion must stay within ABAC/hard-constraint boundaries.

---

### `DPBE-main/src/routes/workflows/workflows.service.ts`

**What changed:**
- `getAllWorkflows` now uses `partialEvaluateAuthorization`, `buildWorkflowsAuthPlan`, and `buildWorkflowsAuthWhereClauseFromPlan`.
- Adds residual verification for workflows when required.
- Detail/update/delete paths use `buildWorkflowsHardConstraints`.

**Why:** Workflows are now protected by the same DPBE ABAC V2 query boundary model as the other resource types.

---

### `DPBE-main/src/shared/middleware/role-access.ts`

**What changed:**
- Expanded `REQUIRED_RESOURCE_ATTRIBUTES`:
  - `dashboards: ["tenantId"]`
  - `alerts: ["tenantId", "status"]`
  - `groups: ["tenantId"]`
  - `workflows: ["tenantId"]`
- Expanded `FAIL_CLOSED_RESOURCES` to include `dashboards`, `alerts`, `groups`, and `workflows`.
- Expanded `COLLECTION_AUTHZ_RESOURCES` to include `dashboards`, `alerts`, `groups`, and `workflows`.
- `handleDeniedReadAccess` now returns:
  - `{ totalResults: 0, results: [] }` for denied collection reads.
  - `{}` for denied detail reads.
- Protected detail `PATCH`/`DELETE` requests now fail closed with 403 when required resource attributes are missing.

**Why:** Denied reads should not leak authorization failure details to clients, and protected mutating detail routes must not evaluate resource-based ABAC policies with incomplete resource context.

---

### `DPBE-main/src/shared/middleware/multi-tenant-access.ts`

**What changed:**
- Added `accessibleTenantIds` to the request object when a user is authorized to access a descendant tenant.
- For GET/DELETE, reads the requested tenant from `tenant-id` header or falls back to the user's own tenant.
- For POST/PATCH/PUT, reads the requested tenant from `req.body.tenantId` or falls back to the user's own tenant.
- For cross-tenant reads/writes, fetches the tenant tree with `getOrFetchTenantTree(user.tenantId)` and verifies the requested tenant is included.
- Corrects `req.query.tenantId` back to the user's own tenant when a cross-tenant read header is stale or invalid.
- Sets `effectiveTenantId` to the requested descendant tenant when access is valid.

**Why:** ABAC hard constraints need to know both the effective tenant being queried and the full set of descendant tenants the user may access. This middleware centralizes tenant hierarchy expansion and exposes it to `request-extractor.ts` and hard-constraint builders.

---

### `DPBE-main/src/shared/middleware/__tests__/role-access.test.ts`

**What changed:**
- Added dashboard denied collection read test.
- Added dashboard denied detail read test.
- Added fail-closed test for protected alert updates when `status` is missing.

**Why:** These tests lock in the read-empty and fail-closed behavior for newly protected resources.

---

### `DPBE-main/src/shared/authz/__tests__/hard-constraints.test.ts`

**What changed:**
- Added tests for `buildTenantConstraint` with multiple accessible tenants.
- Added fallback test for effective tenant scope when hierarchy is not expanded.
- Added hard-constraint tests for dashboards, alerts, groups, and workflows.
- Added malformed resource id tests for new resources.

**Why:** Tenant hierarchy and resource identity hard constraints are security-critical and need direct coverage.

---

### `DPBE-main/src/shared/authz/__tests__/request-extractor.test.ts`

**What changed:**
- Added tests for full original URL extraction.
- Added command action mapping tests for send/retry/cancel.
- Added command device id extraction tests.
- Added expanded tenant hierarchy environment propagation test.

**Why:** Request extraction is the bridge between Express and auth-api partial evaluation. Its path/action/resource/tenant behavior needs to be deterministic.

---

### `DPBE-main/src/shared/authz/__tests__/planner.test.ts`

**What changed:**
- Added default-deny residual verification tests for devices/assets.
- Added auth plan tests for dashboards, alerts, groups, and workflows.
- Added WHERE clause tests proving hard constraints and ABAC include filters are both present.

**Why:** The planner is where DPBE combines hard constraints with ABAC filters. The tests protect against accidentally dropping either layer.

---

### `DPBE-main/package.json` and `pnpm-lock.yaml`

**What changed:**
- Restored `@digieye/abac: "1.0.0"` after dependency install.
- Added `@typescript-eslint/eslint-plugin: "8.44.0"` so the lint script can run with the existing TypeScript ESLint parser.

**Why:** `src/shared/utils/filter-translator.ts` imports `@digieye/abac`, so the linked package must remain installed for type-checking. The ESLint plugin was needed to make the configured lint command executable, although full-repo lint still exposes broad pre-existing violations.

---

### Validation added in this session

- `pnpm exec tsc --noEmit` passes in `DPBE-main`.
- `pnpm exec jest --runInBand` passes in `DPBE-main`.
- Focused authz/middleware tests pass:
  - `planner.test.ts`
  - `filter-to-drizzle.test.ts`
  - `hard-constraints.test.ts`
  - `request-extractor.test.ts`
  - `role-access.test.ts`
- `abac-solution-main` remains validated by:
  - `pnpm test`
  - `pnpm exec tsc --noEmit`

## Invariants — What Was Never Changed

The following constraints were maintained throughout all six sessions:

- **No database schema changes** — no columns added, removed, or renamed in any `schema.ts` file in either `auth-api-main` or `DPBE-main`. All new attributes (subject, environment, resource) map to columns that already exist.
- **No breaking changes to the engine API** — all new fields on interfaces are optional. Callers that do not pass `resource` context continue to work. `evaluateAccess()`, `evaluatePolicy()`, `explainAccess()`, and `can()` signatures are backward compatible. The new `partialEvaluate()` method is purely additive.
- **`evaluateABAC` gRPC call untouched** — the existing `EvaluateABAC` RPC, its proto messages, its handler, and the DPBE wrapper function are not modified. Single-resource access checks continue to use the current flow.
- **Hard constraints remain DPBE-owned** — tenant isolation, resource identity, and malformed-id handling are enforced in DPBE query WHERE clauses before ABAC policy filters. ABAC can narrow access, but it cannot weaken tenant boundaries.
- **Tenant hierarchy support is additive** — expanded descendant tenants use an `IN` constraint; when no expanded hierarchy is available, DPBE falls back to the effective tenant scope.
- **Denied reads return empty results, not 403** — protected collection reads return `{ totalResults: 0, results: [] }` and protected detail reads return `{}` when denied.
- **Protected mutating detail routes fail closed on incomplete resource context** — `PATCH`/`DELETE` detail requests for protected resources return 403 when required resource attributes are missing.
- **Default-deny residual verification stays safe** — when `defaultEffect: "deny"` and `requiresVerification` is true, DPBE keeps the candidate set open so residual verification can strip unauthorized rows instead of accidentally returning all rows.
- **No removal of existing operators** — only `"between"`, `"regex"`, `"greater_than_or_equal"`, and `"less_than_or_equal"` were added in Sessions 2 and 5. All original operators remain.
- **`can()` remains backward compatible** — `resourceContext` is optional. Existing callers pass zero extra arguments.
- **`explainAccess()` return shape** — `matchedDenies`, `matchedAllows`, and `decision` are unchanged. Only `skipped` changed its element type from `Policy` to `SkippedPolicy` in Session 2. Consumers that only read `decision` are unaffected.
- **No frontend changes break existing saved policies** — the subject attribute removals in Session 5 only affect the picker UI. Existing policies already stored in the database with the removed keys (`isActive`, `status`, etc.) continue to evaluate correctly at runtime because the engine and backend still receive those values in the subject context from `role-access.ts`. The UI just no longer offers them as new choices.


#####

