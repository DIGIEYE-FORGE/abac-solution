import type {
  ABACConfig,
  AccessDecisionResult,
  AuthorizationPlan,
  CompiledPolicySet,
  ConditionValue,
  EnvironmentResolver,
  EvaluationContext,
  FilterGroup,
  FilterNode,
  Policy,
  PolicyEffect,
} from "./types";
import { DEFAULT_ENVIRONMENT_RESOLVERS } from "./config/defaults";
import { buildFilterResultFromCompiledPolicySet, compilePolicies } from "./utils/ast-builder";
import { logAbac } from "./utils/logger";
import { compare } from "./utils/operators";

// =====================================================
// COMPILED ABAC ENGINE
// =====================================================

/**
 * Compiles policy slices and turns them into portable authorization plans.
 * Auth API owns policy validation and dynamic platform metadata; consumers own
 * enforcement of the returned allow, deny, or filter_required decision.
 */
export class ABAC {
  readonly environmentResolvers: EnvironmentResolver[];
  readonly defaultEffect: PolicyEffect;

  constructor(config?: ABACConfig) {
    this.environmentResolvers = mergeResolvers(
      DEFAULT_ENVIRONMENT_RESOLVERS,
      config?.environmentResolvers,
    );
    this.defaultEffect = config?.defaultEffect ?? "deny";

    logAbac("ABAC_INIT", "ABAC instance initialized", {
      defaultEffect: this.defaultEffect,
      environmentResolverCount: this.environmentResolvers.length,
    });
  }

  // =====================================================
  // REQUEST CONTEXT
  // =====================================================

  /**
   * Builds request-time environment facts such as current time and day.
   * Explicit service values win so HTTP metadata and deterministic test values
   * can replace package defaults.
   */
  buildEnvironmentContext(extra?: Record<string, unknown>): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    for (const resolver of this.environmentResolvers) {
      if (!resolver.resolve) continue;
      const value = resolver.resolve();
      base[resolver.key] = value;
      for (const attributeKey of resolver.forAttributeKeys ?? []) {
        base[attributeKey] = value;
      }
    }
    return { ...base, ...extra };
  }

  // =====================================================
  // POLICY COMPILATION
  // =====================================================

  /**
   * Compiles the active policies for one tenant/resource/action slice.
   * Auth API can cache this portable set before planning repeated requests.
   */
  compilePolicies(params: {
    policies: Policy[];
    tenantId: string;
    resource: string;
    action: string;
    defaultEffect?: PolicyEffect;
    updatedAt?: Date | string;
  }): CompiledPolicySet {
    return compilePolicies({
      ...params,
      defaultEffect: params.defaultEffect ?? this.defaultEffect,
    });
  }

  // =====================================================
  // AUTHORIZATION PLANNING
  // =====================================================

  /**
   * Produces the complete service-facing authorization plan.
   * Concrete resources can be decided immediately; list and bulk requests may
   * return filter_required so the consuming service applies the filter AST.
   */
  planCompiledAccess(params: {
    compiledPolicySet: CompiledPolicySet;
    requestId?: string;
    tenantId: string;
    userId: string;
    resource: string;
    action: string;
    mode: AuthorizationPlan["mode"];
    subject: Record<string, unknown>;
    environment?: Record<string, unknown>;
    resourceContext?: Record<string, unknown>;
  }): AuthorizationPlan {
    const context: EvaluationContext = {
      subject: params.subject,
      action: params.action,
      environment: params.environment ?? this.buildEnvironmentContext(),
      resource: params.resourceContext,
    };
    const result = buildFilterResultFromCompiledPolicySet(params.compiledPolicySet, context);
    const decision = decideAccess({
      mode: params.mode,
      includeFilter: result.includeFilter,
      excludeFilter: result.excludeFilter,
      decision: result.decision,
      defaultEffect: result.defaultEffect,
      resourceContext: params.resourceContext,
    });

    const plan: AuthorizationPlan = {
      requestId: params.requestId ?? "",
      tenantId: params.tenantId,
      userId: params.userId,
      resource: params.resource,
      action: params.action,
      mode: params.mode,
      decision,
      reason: reasonForDecision(decision, result.defaultEffect),
      includeFilter: result.includeFilter,
      excludeFilter: result.excludeFilter,
      defaultEffect: result.defaultEffect,
      policyIds: result.policyIds,
    };

    logAbac("PLAN_COMPILED_ACCESS_RESULT", "ABAC compiled access plan completed", { plan });
    return plan;
  }
}

// =====================================================
// CONCRETE RESOURCE EVALUATION
// =====================================================

/** Evaluates the portable filter AST against a concrete resource object. */
function evaluateFilterValue(
  node: FilterNode | FilterGroup,
  resourceContext: Record<string, unknown> | undefined,
): boolean {
  if (!resourceContext) return false;

  if (node.type === "condition") {
    const left = resourceContext[node.field];
    if (left === undefined || left === null) return false;
    return compare(left, node.value as ConditionValue, node.operator);
  }

  if (node.logic === "OR") {
    return node.conditions.some((child) => evaluateFilterValue(child, resourceContext));
  }
  return node.conditions.every((child) => evaluateFilterValue(child, resourceContext));
}

/** Returns true when a deny filter matches the current concrete resource. */
function evaluateDenyFilterValue(
  excludeFilter: FilterNode | FilterGroup | null,
  resourceContext: Record<string, unknown> | undefined,
): boolean {
  if (!excludeFilter || !resourceContext) return false;
  return evaluateFilterValue(excludeFilter, resourceContext);
}

/** Converts filter-builder output into the enforcement decision sent to a service. */
function decideAccess(params: {
  mode: AuthorizationPlan["mode"];
  includeFilter: FilterNode | FilterGroup | null;
  excludeFilter: FilterNode | FilterGroup | null;
  decision?: "allow" | "deny";
  defaultEffect: PolicyEffect;
  resourceContext?: Record<string, unknown>;
}): AccessDecisionResult {
  if (params.decision === "deny") return "deny";

  if (params.mode === "create" || params.mode === "single") {
    if (evaluateDenyFilterValue(params.excludeFilter, params.resourceContext)) return "deny";
    if (
      params.includeFilter &&
      (!params.resourceContext || !evaluateFilterValue(params.includeFilter, params.resourceContext))
    ) {
      return "deny";
    }
    if (params.decision === "allow" || params.includeFilter) return "allow";
    return params.defaultEffect === "deny" ? "deny" : "allow";
  }

  if (params.includeFilter || params.excludeFilter) return "filter_required";
  if (params.decision === "allow") return "allow";
  return params.defaultEffect === "deny" ? "deny" : "allow";
}

// =====================================================
// CONFIGURATION HELPERS
// =====================================================

/** Produces stable reason text consumed by API errors, logs, and diagnostics. */
function reasonForDecision(decision: AccessDecisionResult, defaultEffect: PolicyEffect): string {
  if (decision === "deny") {
    return defaultEffect === "deny"
      ? "No matching allow policy and default effect is deny"
      : "Denied by policy";
  }
  if (decision === "filter_required") {
    return "Apply authorization filters before returning or mutating rows";
  }
  return "Allowed by policy";
}

/** Merges resolver overrides by key without discarding unrelated defaults. */
function mergeResolvers(
  defaults: EnvironmentResolver[],
  overrides?: EnvironmentResolver[],
): EnvironmentResolver[] {
  if (!overrides?.length) return defaults;

  const resolvers = new Map<string, EnvironmentResolver>();
  for (const resolver of defaults) resolvers.set(resolver.key, resolver);
  for (const resolver of overrides) {
    resolvers.set(resolver.key, { ...resolvers.get(resolver.key), ...resolver });
  }
  return Array.from(resolvers.values());
}