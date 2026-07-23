import type {
  ConditionValue,
  EnvironmentResolver,
  EvaluationContext,
  FilterGroup,
  FilterNode,
  FilterResult,
  Policy,
  PolicyCondition,
  PolicyEffect,
  CompiledPolicy,
  CompiledPolicySet,
} from "../types";
import { compare } from "./operators";
import { resolveValue } from "./resolver";


const EMPTY_RESOLVER_MAP: Map<string, EnvironmentResolver> = new Map();

type PlanExpression = boolean | FilterNode | FilterGroup;


/** Normalizes compile timestamps so cache keys and diagnostics have a stable string value. */
function toUpdatedAt(value?: Date | string): string {
  if (typeof value === "string") return value;
  return value?.toISOString() ?? new Date().toISOString();
}

/** Checks whether a policy belongs to the requested resource/action before any condition work is done. */
function policyMatchesTarget(policy: Policy, targetResource: string, action: string): boolean {
  return (
    policy.isActive &&
    (policy.resources.includes("*") || policy.resources.includes(targetResource)) &&
    (policy.actions.includes("*") || policy.actions.includes(action))
  );
}

/** Selects and priority-sorts the policies that can affect a single authorization plan. */
function selectActivePolicies(policies: Policy[], targetResource: string, action: string): Policy[] {
  return policies
    .filter((policy) => policyMatchesTarget(policy, targetResource, action))
    .sort((a, b) => b.priority - a.priority);
}

// =====================================================
// CONDITION EVALUATION
// =====================================================

/** Returns the subject/environment/resource bucket referenced by one condition. */
function bucketForCondition(condition: PolicyCondition, context: EvaluationContext): Record<string, unknown> | undefined {
  if (condition.category === "subject") return context.subject;
  if (condition.category === "environment") return context.environment;
  return context.resource;
}

/** Evaluates non-resource conditions immediately because their values are known at plan time. */
function evaluateCondition(condition: PolicyCondition, context: EvaluationContext): boolean {
  const bucket = bucketForCondition(condition, context);
  if (!bucket || typeof bucket !== "object") return false;

  const left = bucket[condition.attribute.key];
  if (left === undefined || left === null) return false;

  const right = resolveValue(condition.attribute.value, context, EMPTY_RESOLVER_MAP);
  return compare(left, right, condition.attribute.operator);
}

/** Resolves the boolean connector before a condition, falling back to the policy-level default. */
function conditionConnector(policy: Policy, condition: PolicyCondition, index: number): PolicyCondition["logic"] {
  if (index === 0) return undefined;
  return condition.logic ?? policy.conditionLogic;
}

/** Narrows a plan expression to a filter AST node/group instead of a plan-time boolean. */
function isFilterExpression(expression: PlanExpression): expression is FilterNode | FilterGroup {
  return typeof expression !== "boolean";
}

/**
 * Combines plan-time booleans and row-time filters while preserving AND/OR semantics.
 * This is the core bridge between policy-builder condition order and SQL-ready filter ASTs.
 */
function combineExpressions(
  left: PlanExpression,
  right: PlanExpression,
  logic: PolicyCondition["logic"],
): PlanExpression {
  const normalizedLogic = logic ?? "AND";

  // AND can fail immediately when either side is false; otherwise filters must both apply.
  if (normalizedLogic === "AND") {
    if (left === false || right === false) return false;
    if (left === true) return right;
    if (right === true) return left;
    return { type: "group", logic: "AND", conditions: [left, right] };
  }

  // OR succeeds immediately when either side is true; otherwise preserve whichever filters remain.
  if (left === true || right === true) return true;
  if (left === false) return right;
  if (right === false) return left;
  return { type: "group", logic: "OR", conditions: [left, right] };
}

/** Converts one condition into either an immediate boolean or a deferred resource filter. */
function conditionToPlanExpression(condition: PolicyCondition, context: EvaluationContext): PlanExpression {
  // Subject/environment conditions can be fully evaluated now. Resource
  // conditions are row-dependent, so they stay as filter AST leaves.
  return condition.category === "resource"
    ? buildFilterNode(condition, context)
    : evaluateCondition(condition, context);
}

/** Builds the complete expression tree for one policy using its ordered conditions. */
function buildPolicyExpression(policy: Policy, context: EvaluationContext): PlanExpression {
  if (policy.conditions.length === 0) return true;

  let expression = conditionToPlanExpression(policy.conditions[0]!, context);
  for (let index = 1; index < policy.conditions.length; index++) {
    const condition = policy.conditions[index]!;
    expression = combineExpressions(
      expression,
      conditionToPlanExpression(condition, context),
      conditionConnector(policy, condition, index),
    );
  }

  return expression;
}

/** Classifies whether a policy is already decided, skipped, or must become a row-level filter. */
function evaluatePlanTimeConditions(policy: Policy, context: EvaluationContext): "unconditional" | "filter" | "skip" {
  const expression = buildPolicyExpression(policy, context);
  if (expression === true) return "unconditional";
  if (expression === false) return "skip";
  return "filter";
}

// =====================================================
// FILTER GROUP BUILDERS
// =====================================================

/** Turns one matching policy into a resource filter group, or null when it was fully decided at plan time. */
function buildFilterGroup(policy: Policy, context: EvaluationContext): FilterGroup | null {
  const expression = buildPolicyExpression(policy, context);
  if (!isFilterExpression(expression)) return null;

  // A single policy's resource conditions keep the policy's connector logic.
  // Multiple allow policies are combined later as OR; deny policies as OR.
  return expression.type === "group"
    ? expression
    : { type: "group", logic: "AND", conditions: [expression] };
}

/** Builds the row-level filter groups for every allow or deny policy that still depends on resource data. */
function groupFromPolicies(policies: Policy[], context: EvaluationContext): FilterGroup[] {
  const groups: FilterGroup[] = [];

  for (const policy of policies) {
    const planTimeResult = evaluatePlanTimeConditions(policy, context);
    if (planTimeResult === "skip") continue;

    const group = buildFilterGroup(policy, context);
    if (group) groups.push(group);
  }

  return groups;
}

/** Combines allow filters into the include filter services must apply to list/bulk queries. */
function combineInclude(groups: FilterGroup[]): FilterGroup | FilterNode | null {
  // Any allow policy can include a row, so allow filters are ORed together.
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0]!;
  return { type: "group", logic: "OR", conditions: groups };
}

/** Combines deny filters into the exclude filter services must negate during enforcement. */
function combineExclude(groups: FilterGroup[]): FilterGroup | FilterNode | null {
  // Any deny policy can exclude a row, so deny filters are ORed together.
  // SQL translation later negates the whole deny expression safely.
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0]!;
  return { type: "group", logic: "OR", conditions: groups };
}

// =====================================================
// PUBLIC FILTER NODE / COMPILE API
// =====================================================

/**
 * Builds one portable filter leaf from a resource condition.
 * Services translate this AST later instead of auth-api knowing every service database schema.
 */
export function buildFilterNode(
  condition: PolicyCondition,
  context: EvaluationContext,
): FilterNode {
  const value = resolveValue(condition.attribute.value, context, EMPTY_RESOLVER_MAP);
  return {
    type: "condition",
    field: condition.attribute.key,
    operator: condition.attribute.operator,
    value: value as ConditionValue,
  };
}

/**
 * Public compiler used by auth-api before caching policy slices.
 * It keeps only policy data relevant to the requested tenant/resource/action pair.
 */
export function compilePolicies(params: {
  policies: Policy[];
  tenantId: string;
  resource: string;
  action: string;
  defaultEffect?: PolicyEffect;
  updatedAt?: Date | string;
}): CompiledPolicySet {
  // Compilation strips inactive/non-target policies and packages only the
  // rules needed for one tenant/resource/action tuple. DPBE can cache or
  // request this compact shape without loading the whole policy catalog.
  const defaultEffect = params.defaultEffect ?? "deny";
  const updatedAt = toUpdatedAt(params.updatedAt);
  const active = selectActivePolicies(params.policies, params.resource, params.action);

  return {
    tenantId: params.tenantId,
    resource: params.resource,
    action: params.action,
    defaultEffect,
    updatedAt,
    allowPolicies: active
      .filter((policy) => policy.effect === "allow")
      .map((policy) => ({
        id: policy.id,
        name: policy.name,
        description: policy.description,
        effect: policy.effect,
        priority: policy.priority,
        conditionLogic: policy.conditionLogic,
        conditions: policy.conditions,
        updatedAt,
      })),
    denyPolicies: active
      .filter((policy) => policy.effect === "deny")
      .map((policy) => ({
        id: policy.id,
        name: policy.name,
        description: policy.description,
        effect: policy.effect,
        priority: policy.priority,
        conditionLogic: policy.conditionLogic,
        conditions: policy.conditions,
        updatedAt,
      })),
  };
}

// =====================================================
// COMPILED POLICY HELPERS
// =====================================================

/** Rehydrates cached compiled policy rows so the normal filter builder can be reused. */
function compiledPolicyToPolicy(compiled: CompiledPolicy, resource: string, action: string): Policy {
  return {
    id: compiled.id,
    name: compiled.name,
    description: compiled.description,
    resources: [resource],
    actions: [action],
    effect: compiled.effect,
    conditions: compiled.conditions,
    conditionLogic: compiled.conditionLogic,
    priority: compiled.priority,
    isActive: true,
  };
}

/**
 * Builds a filter result from the cached compiled policy set returned by auth-api storage/cache.
 * This avoids maintaining two separate planning implementations.
 */
export function buildFilterResultFromCompiledPolicySet(
  compiledPolicySet: CompiledPolicySet,
  context: EvaluationContext,
): FilterResult {
  // Rehydrate the compact compiled policy entries into the normal policy
  // shape so the same filter builder handles live and compiled evaluation.
  const policies = [
    ...compiledPolicySet.allowPolicies,
    ...compiledPolicySet.denyPolicies,
  ].map((policy) => compiledPolicyToPolicy(policy, compiledPolicySet.resource, compiledPolicySet.action));

  return buildFilterResult(
    policies,
    context,
    compiledPolicySet.resource,
    compiledPolicySet.defaultEffect,
  );
}

// =====================================================
// FILTER RESULT PLANNING
// =====================================================

/**
 * Builds the final include/exclude filter result for one authorization request.
 * This is the low-level output that ABAC.planCompiledAccess wraps into a service-facing plan.
 */
export function buildFilterResult(
  policies: Policy[],
  context: EvaluationContext,
  targetResource: string,
  defaultEffect: PolicyEffect,
): FilterResult {
  // Final planning result used by the auth API:
  // - decision=deny is terminal
  // - decision=allow with excludeFilter means allow unless a deny filter matches
  // - includeFilter/excludeFilter means the caller must apply row filters
  const active = selectActivePolicies(policies, targetResource, context.action);
  const policyIds = active.map((policy) => policy.id);
  const allowPolicies = active.filter((policy) => policy.effect === "allow");
  const denyPolicies = active.filter((policy) => policy.effect === "deny");

  const denyAll = denyPolicies.some((policy) => evaluatePlanTimeConditions(policy, context) === "unconditional");
  const allowAll = allowPolicies.some((policy) => evaluatePlanTimeConditions(policy, context) === "unconditional");
  const includeGroups = groupFromPolicies(allowPolicies, context);
  const excludeGroups = groupFromPolicies(denyPolicies, context);

  // An unconditional deny is terminal because deny policies override all allows.
  if (denyAll) {
    return {
      includeFilter: null,
      excludeFilter: null,
      decision: "deny",
      defaultEffect,
      policyIds,
    };
  }

  const includeFilter = combineInclude(includeGroups);
  const excludeFilter = combineExclude(excludeGroups);

  // An unconditional allow still keeps excludeFilter so deny-by-resource policies can remove rows.
  if (allowAll) {
    return {
      includeFilter: null,
      excludeFilter,
      decision: "allow",
      defaultEffect,
      policyIds,
    };
  }

  return {
    includeFilter,
    excludeFilter,
    defaultEffect,
    policyIds,
  };
}