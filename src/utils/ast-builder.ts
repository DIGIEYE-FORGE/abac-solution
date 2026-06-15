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
import { logAbac } from "./logger";

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
  logAbac("AST_SQL_CAPABLE_START", "Checking if condition can be pushed to SQL", {
    conditionId: condition.id,
    condition,
    knownResourceFields: Array.from(knownResourceFields),
  });

  if (condition.external === true) {
    logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked non-SQL because it is external", { conditionId: condition.id });
    return { capable: false, reason: "external_dependency" };
  }

  if (condition.category !== "resource") {
    logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked non-SQL because category is not resource", {
      conditionId: condition.id,
      category: condition.category,
    });
    return { capable: false, reason: "non_resource_category" };
  }

  if (!knownResourceFields.has(condition.attribute.key)) {
    logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked non-SQL because field is unknown", {
      conditionId: condition.id,
      field: condition.attribute.key,
    });
    return { capable: false, reason: "unknown_field" };
  }

  if (!SQL_OPERATOR_META[condition.attribute.operator]?.capable) {
    logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked non-SQL because operator is not SQL capable", {
      conditionId: condition.id,
      operator: condition.attribute.operator,
    });
    return { capable: false, reason: "non_sql_operator" };
  }

  const val = condition.attribute.value;
  if (typeof val === "string" && isContextVariable(val)) {
    const path = val.slice(1, -1);
    if (!path.startsWith("subject.")) {
      logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked non-SQL because context variable is not subject scoped", {
        conditionId: condition.id,
        path,
      });
      return { capable: false, reason: "unresolvable_context_var" };
    }
    const key = path.slice(8);
    if (context.subject[key] === undefined) {
      logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked non-SQL because subject context value is missing", {
        conditionId: condition.id,
        subjectKey: key,
      });
      return { capable: false, reason: "unresolvable_context_var" };
    }
  }

  logAbac("AST_SQL_CAPABLE_RESULT", "Condition marked SQL capable", { conditionId: condition.id });
  return { capable: true };
}

// ── resolveAtPlanTime ────────────────────────────────────────────────────────
// Resolves {subject.X} context variables to their actual value at plan time.
// Literals are returned as-is.

export function resolveAtPlanTime(
  value: PolicyCondition["attribute"]["value"],
  context: EvaluationContext,
): PolicyCondition["attribute"]["value"] {
  logAbac("AST_RESOLVE_PLAN_TIME_START", "Resolving policy value at plan time", { value });

  if (typeof value === "string" && value.startsWith("{subject.") && value.endsWith("}")) {
    const key = value.slice(9, -1);
    const resolved = context.subject[key];
    logAbac("AST_RESOLVE_PLAN_TIME_SUBJECT", "Resolved subject context variable", { key, resolved });
    if (
      typeof resolved === "string" ||
      typeof resolved === "number" ||
      typeof resolved === "boolean"
    ) return resolved;
    if (Array.isArray(resolved)) return resolved as string[];
  }

  logAbac("AST_RESOLVE_PLAN_TIME_RESULT", "Policy value kept as literal at plan time", { value });
  return value;
}

// ── buildFilterNode ──────────────────────────────────────────────────────────

export function buildFilterNode(
  condition: PolicyCondition,
  context: EvaluationContext,
): FilterNode {
  const meta = SQL_OPERATOR_META[condition.attribute.operator];
  const node: FilterNode = {
    type: "condition",
    field: condition.attribute.key,
    operator: condition.attribute.operator,
    value: resolveAtPlanTime(condition.attribute.value, context),
    sqlCapable: true,
    queryCost: meta?.cost ?? "medium",
    indexSafe: meta?.indexSafe ?? false,
  };

  logAbac("AST_BUILD_FILTER_NODE", "Built SQL filter node", { condition, node });
  return node;
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
  logAbac("AST_BUILD_WARNINGS_START", "Building policy warnings", {
    policyGroupCount: policyGroups.length,
    denyGroupCount: denyGroups.length,
    residualCount: residuals.length,
  });

  if (residuals.length > 0) {
    const warning = `${residuals.length} residual condition(s) require verification`;
    warnings.push(warning);
    logAbac("AST_BUILD_WARNINGS_RESIDUAL", "Added residual warning", { residualCount: residuals.length, residuals });
  }

  const highCostFields: string[] = [];
  for (const group of [...policyGroups, ...denyGroups]) {
    visitFilterNode(group, (node) => {
      if (node.queryCost === "high") highCostFields.push(node.field);
    });
  }

  if (highCostFields.length > 0) {
    const warning = `High-cost SQL authorization fields: ${Array.from(new Set(highCostFields)).join(", ")}`;
    warnings.push(warning);
    logAbac("AST_BUILD_WARNINGS_COST", "Added high-cost warning", { highCostFields: Array.from(new Set(highCostFields)) });
  }

  logAbac("AST_BUILD_WARNINGS_RESULT", "Policy warnings built", { warnings });
  return warnings;
}

// ── processPolicyConditions ──────────────────────────────────────────────────

function processPolicyConditions(
  policy: Policy,
  context: EvaluationContext,
  knownResourceFields: Set<string>,
): { sqlNodes: FilterNode[]; residuals: ResidualCondition[]; isComplete: boolean } {
  logAbac("AST_PROCESS_POLICY_START", "Processing policy conditions", {
    policyId: policy.id,
    policyName: policy.name,
    effect: policy.effect,
    conditionCount: policy.conditions.length,
  });

  const sqlNodes: FilterNode[] = [];
  const residuals: ResidualCondition[] = [];

  for (const condition of policy.conditions) {
    const { capable, reason } = isSqlCapable(condition, context, knownResourceFields);
    if (capable) {
      const node = buildFilterNode(condition, context);
      sqlNodes.push(node);
      logAbac("AST_PROCESS_POLICY_SQL_NODE", "Added SQL-capable condition node", {
        policyId: policy.id,
        conditionId: condition.id,
        node,
      });
    } else {
      const residual: ResidualCondition = { policyId: policy.id, policyName: policy.name, condition, reason: reason! };
      residuals.push(residual);
      logAbac("AST_PROCESS_POLICY_RESIDUAL", "Added residual condition", { residual });
    }
  }

  const isComplete = residuals.length === 0;
  logAbac("AST_PROCESS_POLICY_RESULT", "Policy condition processing completed", {
    policyId: policy.id,
    sqlNodeCount: sqlNodes.length,
    residualCount: residuals.length,
    isComplete,
  });

  return { sqlNodes, residuals, isComplete };
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
  logAbac("AST_BUILD_FILTER_RESULT_START", "Building partial-evaluation filter result", {
    targetResource,
    action: context.action,
    policyCount: policies.length,
    knownResourceFields: Array.from(knownResourceFields),
    defaultEffect,
    subject: context.subject,
    environment: context.environment,
    resource: context.resource,
  });

  const active = policies
    .filter((p) => p.isActive)
    .filter((p) => p.resources.includes("*") || p.resources.includes(targetResource))
    .filter((p) => p.actions.includes("*") || p.actions.includes(context.action))
    .sort((a, b) => b.priority - a.priority);
  const policyIds = active.map((policy) => policy.id);
  logAbac("AST_ACTIVE_POLICIES", "Active policies selected for target resource/action", {
    targetResource,
    action: context.action,
    activePolicyIds: policyIds,
    activePolicies: active.map((p) => ({ id: p.id, name: p.name, effect: p.effect, priority: p.priority })),
  });

  const allowPolicies = active.filter((p) => p.effect === "allow");
  const denyPolicies  = active.filter((p) => p.effect === "deny");
  logAbac("AST_POLICY_SPLIT", "Active policies split by effect", {
    allowCount: allowPolicies.length,
    denyCount: denyPolicies.length,
    allowPolicyIds: allowPolicies.map((p) => p.id),
    denyPolicyIds: denyPolicies.map((p) => p.id),
  });

  const allResiduals: ResidualCondition[] = [];
  let requiresVerification = false;
  const denyGroups: FilterGroup[] = [];

  // ── DENY policies ──────────────────────────────────────────────────────────
  // SQL-able deny conditions → denyGroups (become excludeFilter)
  // Non-SQL-able deny conditions → residuals + requiresVerification = true
  for (const policy of denyPolicies) {
    const hasResourceCondition = policy.conditions.some((c) => c.category === "resource");
    logAbac("AST_DENY_POLICY_START", "Processing deny policy for partial evaluation", {
      policyId: policy.id,
      policyName: policy.name,
      hasResourceCondition,
      conditionCount: policy.conditions.length,
    });
    if (!hasResourceCondition) {
      logAbac("AST_DENY_POLICY_SKIP", "Deny policy skipped because it has no resource condition", {
        policyId: policy.id,
        policyName: policy.name,
      });
      continue;
    }

    const { sqlNodes, residuals, isComplete } = processPolicyConditions(
      policy, context, knownResourceFields,
    );

    if (sqlNodes.length > 0) {
      const group = { type: "group", logic: policy.conditionLogic, conditions: sqlNodes } as FilterGroup;
      denyGroups.push(group);
      logAbac("AST_DENY_POLICY_GROUP", "Added deny policy filter group", {
        policyId: policy.id,
        policyName: policy.name,
        group,
      });
    }

    if (!isComplete) {
      requiresVerification = true;
      allResiduals.push(...residuals);
      logAbac("AST_DENY_POLICY_RESIDUAL", "Deny policy has residual conditions", {
        policyId: policy.id,
        residualCount: residuals.length,
        residuals,
      });
    }
  }

  // Issue #1 fix: AND join so SQL translator wraps each child in NOT() independently
  const excludeFilter: FilterGroup | FilterNode | null =
    denyGroups.length === 0
      ? null
      : denyGroups.length === 1
        ? denyGroups[0]!
        : { type: "group", logic: "AND", conditions: denyGroups };

  logAbac("AST_EXCLUDE_FILTER", "Built exclude filter from deny policies", { excludeFilter });

  // ── ALLOW policies ─────────────────────────────────────────────────────────
  let hasUnconditionalAllow = false;
  const policyGroups: FilterGroup[] = [];

  for (const policy of allowPolicies) {
    logAbac("AST_ALLOW_POLICY_START", "Processing allow policy for partial evaluation", {
      policyId: policy.id,
      policyName: policy.name,
      conditionCount: policy.conditions.length,
    });

    // Issue #2 fix: never early-return here — excludeFilter must always be assembled first
    if (policy.conditions.length === 0) {
      hasUnconditionalAllow = true;
      logAbac("AST_ALLOW_POLICY_UNCONDITIONAL", "Allow policy is unconditional", {
        policyId: policy.id,
        policyName: policy.name,
      });
      continue;
    }

    const { sqlNodes, residuals, isComplete } = processPolicyConditions(
      policy, context, knownResourceFields,
    );

    allResiduals.push(...residuals);
    if (!isComplete) requiresVerification = true;

    if (sqlNodes.length > 0) {
      const group = { type: "group", logic: policy.conditionLogic, conditions: sqlNodes } as FilterGroup;
      policyGroups.push(group);
      logAbac("AST_ALLOW_POLICY_GROUP", "Added allow policy filter group", {
        policyId: policy.id,
        policyName: policy.name,
        group,
      });
    }

    if (!isComplete) {
      logAbac("AST_ALLOW_POLICY_RESIDUAL", "Allow policy has residual conditions", {
        policyId: policy.id,
        residualCount: residuals.length,
        residuals,
      });
    }
  }

  const warnings = buildPolicyWarnings(policyGroups, denyGroups, allResiduals);
  logAbac("AST_FILTER_RESULT_WARNINGS", "Partial-evaluation warnings assembled", { warnings });

  // Issue #2 fix: unconditional ALLOW — return null includeFilter but preserve excludeFilter
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
    logAbac("AST_FILTER_RESULT_UNCONDITIONAL_ALLOW", "Partial-evaluation result returned with unconditional allow", { result });
    return result;
  }

  // Issue #3 fix: no matching ALLOW + defaultEffect="deny" → NEVER_MATCH sentinel
  if (policyGroups.length === 0) {
    const result: FilterResult = {
      schemaVersion: 1,
      includeFilter: defaultEffect === "deny" ? NEVER_MATCH : null,
      excludeFilter,
      requiresVerification: false, // NEVER_MATCH returns zero rows — verification is pointless
      residualConditions: allResiduals,
      defaultEffect,
      policyIds,
      warnings,
    };
    logAbac("AST_FILTER_RESULT_DEFAULT_DENY", "Partial-evaluation result returned for default deny/no allow", { result });
    return result;
  }

  const includeFilter: FilterGroup | FilterNode =
    policyGroups.length === 1
      ? policyGroups[0]!
      : { type: "group", logic: "OR", conditions: policyGroups };
  logAbac("AST_INCLUDE_FILTER", "Built include filter from allow policies", { includeFilter });

  const result: FilterResult = {
    schemaVersion: 1,
    includeFilter,
    excludeFilter,
    requiresVerification,
    residualConditions: allResiduals,
    defaultEffect,
    policyIds,
    warnings,
  };
  logAbac("AST_FILTER_RESULT_FINAL", "Partial-evaluation result returned", { result });
  return result;
}
