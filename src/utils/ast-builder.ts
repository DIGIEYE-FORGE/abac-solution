import type {
  Policy,
  PolicyCondition,
  PolicyEffect,
  FilterNode,
  FilterGroup,
  FilterResult,
  ResidualCondition,
  EvaluationContext,
} from "../types";
import { SQL_OPERATOR_META } from "../config/constants";
import { isContextVariable } from "./resolver";

// ── NEVER_MATCH sentinel ─────────────────────────────────────────────────────
// Translates to WHERE "1" = 0 → always returns zero rows.
// Returned as includeFilter when defaultEffect = "deny" and no ALLOW policies matched.
// Makes the engine self-contained — callers never need to check defaultEffect themselves.

export const NEVER_MATCH: FilterNode = {
  type: "condition",
  field: "1",
  operator: "equals",
  value: 0,
  sqlCapable: true,
  queryCost: "low",
  indexSafe: true,
};

// ── isSqlCapable ─────────────────────────────────────────────────────────────
// A condition is SQL-able when ALL of:
//   1. Not marked external: true
//   2. Category is "resource" (subject/environment are not DB columns)
//   3. Field exists in the known resource fields set
//   4. Operator is capable per SQL_OPERATOR_META
//   5. Value is a literal OR a {subject.X} variable (subject is known at plan time)

export function isSqlCapable(
  condition: PolicyCondition,
  context: EvaluationContext,
  knownResourceFields: Set<string>,
): { capable: boolean; reason?: ResidualCondition["reason"] } {
  if (condition.external === true) {
    return { capable: false, reason: "external_dependency" };
  }

  if (condition.category !== "resource") {
    return { capable: false, reason: "non_resource_category" };
  }

  if (!knownResourceFields.has(condition.attribute.key)) {
    return { capable: false, reason: "unknown_field" };
  }

  if (!SQL_OPERATOR_META[condition.attribute.operator]?.capable) {
    return { capable: false, reason: "non_sql_operator" };
  }

  const val = condition.attribute.value;
  if (typeof val === "string" && isContextVariable(val)) {
    const path = val.slice(1, -1); // strip { }
    if (!path.startsWith("subject.")) {
      return { capable: false, reason: "unresolvable_context_var" };
    }
    const key = path.slice(8); // strip "subject."
    if (context.subject[key] === undefined) {
      return { capable: false, reason: "unresolvable_context_var" };
    }
  }

  return { capable: true };
}

// ── resolveAtPlanTime ────────────────────────────────────────────────────────
// Resolves {subject.X} context variables to their actual value at plan time.
// Literals are returned as-is.

export function resolveAtPlanTime(
  value: PolicyCondition["attribute"]["value"],
  context: EvaluationContext,
): PolicyCondition["attribute"]["value"] {
  if (typeof value === "string" && value.startsWith("{subject.") && value.endsWith("}")) {
    const key = value.slice(9, -1);
    const resolved = context.subject[key];
    if (
      typeof resolved === "string" ||
      typeof resolved === "number" ||
      typeof resolved === "boolean"
    ) return resolved;
    if (Array.isArray(resolved)) return resolved as string[];
  }
  return value;
}

// ── buildFilterNode ──────────────────────────────────────────────────────────

export function buildFilterNode(
  condition: PolicyCondition,
  context: EvaluationContext,
): FilterNode {
  const meta = SQL_OPERATOR_META[condition.attribute.operator];
  return {
    type: "condition",
    field: condition.attribute.key,
    operator: condition.attribute.operator,
    value: resolveAtPlanTime(condition.attribute.value, context),
    sqlCapable: true,
    queryCost: meta?.cost ?? "medium",
    indexSafe: meta?.indexSafe ?? false,
  };
}

function visitFilterNode(node: FilterNode | FilterGroup | null, visit: (node: FilterNode) => void): void {
  if (!node) return;
  if (node.type === "condition") {
    visit(node);
    return;
  }
  for (const child of node.conditions) visitFilterNode(child, visit);
}

function buildPolicyWarnings(
  policyGroups: FilterGroup[],
  denyGroups: FilterGroup[],
  residuals: ResidualCondition[],
): string[] {
  const warnings: string[] = [];

  if (residuals.length > 0) {
    warnings.push(`${residuals.length} residual condition(s) require verification`);
  }

  const highCostFields: string[] = [];
  for (const group of [...policyGroups, ...denyGroups]) {
    visitFilterNode(group, (node) => {
      if (node.queryCost === "high") highCostFields.push(node.field);
    });
  }

  if (highCostFields.length > 0) {
    warnings.push(`High-cost SQL authorization fields: ${Array.from(new Set(highCostFields)).join(", ")}`);
  }

  return warnings;
}

// ── processPolicyConditions ──────────────────────────────────────────────────

function processPolicyConditions(
  policy: Policy,
  context: EvaluationContext,
  knownResourceFields: Set<string>,
): { sqlNodes: FilterNode[]; residuals: ResidualCondition[]; isComplete: boolean } {
  const sqlNodes: FilterNode[] = [];
  const residuals: ResidualCondition[] = [];

  for (const condition of policy.conditions) {
    const { capable, reason } = isSqlCapable(condition, context, knownResourceFields);
    if (capable) {
      sqlNodes.push(buildFilterNode(condition, context));
    } else {
      residuals.push({ policyId: policy.id, policyName: policy.name, condition, reason: reason! });
    }
  }

  return { sqlNodes, residuals, isComplete: residuals.length === 0 };
}

// ── buildFilterResult ────────────────────────────────────────────────────────
// Main entry point. Produces includeFilter (ALLOW AST) + excludeFilter (DENY AST)
// with all semantic correctness fixes applied:
//
// Issue #1: each DENY policy is an independent NOT(...) veto — AND join in excludeFilter,
//           SQL translator wraps each child in NOT() separately
// Issue #2: unconditional ALLOW does NOT early-return before excludeFilter is assembled
// Issue #3: no matching ALLOW + defaultEffect="deny" returns NEVER_MATCH (not null)

export function buildFilterResult(
  policies: Policy[],
  context: EvaluationContext,
  targetResource: string,
  knownResourceFields: Set<string>,
  defaultEffect: PolicyEffect,
): FilterResult {
  const active = policies
    .filter((p) => p.isActive)
    .filter((p) => p.resources.includes("*") || p.resources.includes(targetResource))
    .filter((p) => p.actions.includes("*") || p.actions.includes(context.action))
    .sort((a, b) => b.priority - a.priority);
  const policyIds = active.map((policy) => policy.id);

  const allowPolicies = active.filter((p) => p.effect === "allow");
  const denyPolicies  = active.filter((p) => p.effect === "deny");

  const allResiduals: ResidualCondition[] = [];
  let requiresVerification = false;
  const denyGroups: FilterGroup[] = [];

  // ── DENY policies ──────────────────────────────────────────────────────────
  // SQL-able deny conditions → denyGroups (become excludeFilter)
  // Non-SQL-able deny conditions → residuals + requiresVerification = true
  for (const policy of denyPolicies) {
    const hasResourceCondition = policy.conditions.some((c) => c.category === "resource");
    if (!hasResourceCondition) continue;

    const { sqlNodes, residuals, isComplete } = processPolicyConditions(
      policy, context, knownResourceFields,
    );

    if (sqlNodes.length > 0) {
      denyGroups.push({ type: "group", logic: policy.conditionLogic, conditions: sqlNodes });
    }

    if (!isComplete) {
      requiresVerification = true;
      allResiduals.push(...residuals);
    }
  }

  // Issue #1 fix: AND join so SQL translator wraps each child in NOT() independently
  const excludeFilter: FilterGroup | FilterNode | null =
    denyGroups.length === 0
      ? null
      : denyGroups.length === 1
        ? denyGroups[0]!
        : { type: "group", logic: "AND", conditions: denyGroups };

  // ── ALLOW policies ─────────────────────────────────────────────────────────
  let hasUnconditionalAllow = false;
  const policyGroups: FilterGroup[] = [];

  for (const policy of allowPolicies) {
    // Issue #2 fix: never early-return here — excludeFilter must always be assembled first
    if (policy.conditions.length === 0) {
      hasUnconditionalAllow = true;
      continue;
    }

    const { sqlNodes, residuals, isComplete } = processPolicyConditions(
      policy, context, knownResourceFields,
    );

    allResiduals.push(...residuals);
    if (!isComplete) requiresVerification = true;

    if (sqlNodes.length > 0) {
      policyGroups.push({ type: "group", logic: policy.conditionLogic, conditions: sqlNodes });
    }
  }

  const warnings = buildPolicyWarnings(policyGroups, denyGroups, allResiduals);

  // Issue #2 fix: unconditional ALLOW — return null includeFilter but preserve excludeFilter
  if (hasUnconditionalAllow) {
    return {
      schemaVersion: 1,
      includeFilter: null,
      excludeFilter,
      requiresVerification,
      residualConditions: allResiduals,
      defaultEffect,
      policyIds,
      warnings,
    };
  }

  // Issue #3 fix: no matching ALLOW + defaultEffect="deny" → NEVER_MATCH sentinel
  if (policyGroups.length === 0) {
    return {
      schemaVersion: 1,
      includeFilter: defaultEffect === "deny" ? NEVER_MATCH : null,
      excludeFilter,
      requiresVerification: false, // NEVER_MATCH returns zero rows — verification is pointless
      residualConditions: allResiduals,
      defaultEffect,
      policyIds,
      warnings,
    };
  }

  const includeFilter: FilterGroup | FilterNode =
    policyGroups.length === 1
      ? policyGroups[0]!
      : { type: "group", logic: "OR", conditions: policyGroups };

  return {
    schemaVersion: 1,
    includeFilter,
    excludeFilter,
    requiresVerification,
    residualConditions: allResiduals,
    defaultEffect,
    policyIds,
    warnings,
  };
}
