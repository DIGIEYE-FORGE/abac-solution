import type {
  AttributeCategory,
  AttributeValueType,
  AttributeDefinition,
  OperatorConfig,
  ContextVariable,
  PolicyCondition,
  Policy,
  PolicyEffect,
  EvaluationContext,
  AccessDecision,
  PolicyValidationResult,
  ABACConfig,
  EnvironmentResolver,
  ResourceConfig,
  ActionConfig,
  FilterNode,
  FilterGroup,
  ConditionValue,
  AccessDecisionResult,
  AuthorizationPlan,
} from "./types";

import { policySchema } from "./config/schemas";
import { OPERATORS_BY_TYPE } from "./config/constants";
import {
  DEFAULT_OPERATORS,
  DEFAULT_SUBJECT_ATTRIBUTES,
  DEFAULT_ENVIRONMENT_ATTRIBUTES,
  DEFAULT_RESOURCE_ATTRIBUTES,
  DEFAULT_ENVIRONMENT_RESOLVERS,
  DEFAULT_RESOURCES,
  DEFAULT_ACTIONS,
} from "./config/defaults";
import { compare } from "./utils/operators";
import { resolveValue, isContextVariable } from "./utils/resolver";
import { buildFilterResult, compilePolicies, buildFilterResultFromCompiledPolicySet } from "./utils/ast-builder";
import { logAbac } from "./utils/logger";

// =====================================================
// ABAC DOMAIN SERVICE
//
// This class is the auth service's in-process ABAC engine.
// It owns:
//
// - metadata used by the policy UI (attributes, resources, actions, operators)
// - policy validation
// - direct policy evaluation for single/batch checks
// - compiled policy planning for DPBE row-level filters
//
// The DPBE lifecycle usually calls planCompiledAccess() through gRPC and then
// translates include/exclude filters into Drizzle SQL.
// =====================================================

// =====================================================
// ABAC ENGINE CLASS
// =====================================================

export class ABAC {
  readonly attributes: {
    subject: AttributeDefinition[];
    environment: AttributeDefinition[];
    resource: AttributeDefinition[];
  };
  readonly operators: OperatorConfig[];
  readonly environmentResolvers: EnvironmentResolver[];
  readonly resources: ResourceConfig[];
  readonly actions: ActionConfig[];
  readonly defaultEffect: PolicyEffect;

  private _contextVariables: ContextVariable[] | null = null; // stores cached context variables
  private _resourceCategories: string[] | null = null; // stores resource categories like dataplatform reources or any platform
  private readonly _resolverMap: Map<string, EnvironmentResolver>; // maps resolver keys to implementations functions that does that job , like the ones that resloves that specifc function resolver 
  private readonly _attrMap: Record<AttributeCategory, Map<string, AttributeDefinition>>; /* stores attribute definitions by category and key like roles like "subject" (Drawer 1)
 │    └── "role" ──────> { id: 1, type: "string", description: "User's security role" }
 │    └── "clearance" ─> { id: 2, type: "number", description: "Security clearance level" }
 │
 ├── "resource" (Drawer 2)
 │    └── "ownerId" ───> { id: 8, type: "uuid",   description: "Who owns this document" }
 │    └── "isPrivate" ─> { id: 9, type: "boolean", description: "Privacy toggle flag" }
 │
 └── "environment" (Drawer 3)
      └── "time" ─────  */
  private readonly _resourceMap: Map<string, ResourceConfig>; // stores resources by value e.g ( "document" → { value: "document", label: "Document" } )
  private readonly _actionMap: Map<string, ActionConfig>;
  private readonly _operatorSet: Map<string, Set<string>>;
  private readonly _operatorCache = new Map<string, OperatorConfig[]>();

  // =====================================================
  // CONSTRUCTION / LOOKUP MAPS
  // =====================================================

  /**
   * Builds an ABAC engine instance with platform-specific overrides.
   * Auth-api uses this to combine package defaults with resources/actions coming from each product surface.
   */
  constructor(config?: ABACConfig) {
    // Config values extend or replace defaults so each platform can register
    // its own resources/attributes while still keeping common ABAC behavior.
    this.attributes = {
      subject: config?.attributes?.subject ?? DEFAULT_SUBJECT_ATTRIBUTES,
      environment: config?.attributes?.environment ?? DEFAULT_ENVIRONMENT_ATTRIBUTES,
      resource: config?.attributes?.resource ?? DEFAULT_RESOURCE_ATTRIBUTES,
    };
    this.operators = config?.operators ?? DEFAULT_OPERATORS;
    this.environmentResolvers = mergeResolvers(
      DEFAULT_ENVIRONMENT_RESOLVERS,
      config?.environmentResolvers,
    );
    this.resources = config?.resources ?? DEFAULT_RESOURCES;
    this.actions = config?.actions ?? DEFAULT_ACTIONS;
    this.defaultEffect = config?.defaultEffect ?? "deny";

    logAbac("ABAC_INIT", "ABAC instance initialized", {
      defaultEffect: this.defaultEffect,
      resourceCount: this.resources.length,
      actionCount: this.actions.length,
      subjectAttributeCount: this.attributes.subject.length,
      environmentAttributeCount: this.attributes.environment.length,
      resourceAttributeCount: this.attributes.resource.length,
    });

    // Hot-path lookups are precomputed once. Evaluation and UI metadata reads
    // should not scan arrays for every condition/resource/action.
    this._resolverMap = new Map(this.environmentResolvers.map((r) => [r.key, r]));
    this._attrMap = {
      subject: new Map(this.attributes.subject.map((a) => [a.key, a])),
      environment: new Map(this.attributes.environment.map((a) => [a.key, a])),
      resource: new Map(this.attributes.resource.map((a) => [a.key, a])),
    };
    this._resourceMap = new Map(this.resources.map((r) => [r.value, r]));
    this._actionMap = new Map(this.actions.map((a) => [a.value, a]));
    this._operatorSet = new Map(
      Object.entries(OPERATORS_BY_TYPE).map(([type, ops]) => [type, new Set<string>(ops)]),
    );
  }

  // =====================================================
  // METADATA READ HELPERS
  // =====================================================

  /** Returns all attributes for one category so UI builders can render the correct policy fields. */
  getAttributes(category: AttributeCategory): AttributeDefinition[] {
    return this.attributes[category];
  }

  /** Looks up one attribute definition so validation and UI labels can use the same metadata. */
  getAttribute(category: AttributeCategory, key: string): AttributeDefinition | undefined {
    return this._attrMap[category]?.get(key);
  }

  /** Returns a safe display label while falling back to the raw key for unknown/custom attributes. */
  getAttributeLabel(category: AttributeCategory, key: string): string {
    return this.getAttribute(category, key)?.label ?? key;
  }

  /** Lists resources, optionally by category, for dynamic platform/resource selectors in the policy UI. */
  getResources(category?: string): ResourceConfig[] {
    if (!category) return this.resources;
    return this.resources.filter((r) => r.category === category);
  }

  /** Fetches one resource definition for validation, labels, and category grouping. */
  getResource(value: string): ResourceConfig | undefined {
    return this._resourceMap.get(value);
  }

  /** Returns the resource label used in UI/logging without breaking if a resource was removed. */
  getResourceLabel(value: string): string {
    return this.getResource(value)?.label ?? value;
  }

  /** Computes resource categories once so UI filters do not rebuild the category list on every render. */
  getResourceCategories(): string[] {
    if (this._resourceCategories) return this._resourceCategories;
    const cats = new Set<string>();
    for (const r of this.resources) {
      if (r.category) cats.add(r.category);
    }
    this._resourceCategories = Array.from(cats);
    return this._resourceCategories;
  }

  /** Lists canonical actions so services and UI use create/read/update/delete consistently. */
  getActions(): ActionConfig[] {
    return this.actions;
  }

  /** Looks up one action definition for validation and display metadata. */
  getAction(value: string): ActionConfig | undefined {
    return this._actionMap.get(value);
  }

  /** Returns an action label while preserving unknown/custom action keys for diagnostics. */
  getActionLabel(value: string): string {
    return this.getAction(value)?.label ?? value;
  }

  /** Returns only operators valid for the selected attribute type, preventing invalid policy conditions. */
  getOperatorsFor(valueType: AttributeValueType): OperatorConfig[] {
    const cached = this._operatorCache.get(valueType);
    if (cached) return cached;

    const allowedSet = this._operatorSet.get(valueType);
    const result = allowedSet
      ? this.operators.filter((o) => allowedSet.has(o.value))
      : this.operators;

    this._operatorCache.set(valueType, result);
    return result;
  }

  // =====================================================
  // CONTEXT VARIABLE HELPERS
  // =====================================================

  /**
   * Builds the available dynamic placeholders for policy values.
   * These are exposed to the UI so users can compare attributes to context like {resource.ownerId}.
   */
  get contextVariables(): ContextVariable[] {
    // Context variables are the placeholders available in policy values,
    // for example "{subject.userId}" or "{resource.ownerId}".
    if (this._contextVariables) return this._contextVariables;
    this._contextVariables = [
      ...this.attributes.subject.map((attr) => ({
        value: `{subject.${attr.key}}`,
        label: `User ${attr.label.toLowerCase()}`,
        description: `Resolved to the subject's ${attr.label.toLowerCase()}.`,
        forAttributeKeys: [attr.key],
        forCategories: ["subject" as AttributeCategory, "environment" as AttributeCategory],
      })),
      ...this.attributes.resource.map((attr) => ({
        value: `{resource.${attr.key}}`,
        label: `Resource ${attr.label}`,
        description: `Resolved to the resource's ${attr.label.toLowerCase()}.`,
        forAttributeKeys: [attr.key],
        forCategories: ["subject" as AttributeCategory, "environment" as AttributeCategory, "resource" as AttributeCategory],
      })),
      ...this.environmentResolvers.map((r) => ({
        value: `{${r.key}}`,
        label: r.label,
        description: r.description,
        forAttributeKeys: r.forAttributeKeys,
        forCategories: ["environment" as AttributeCategory],
      })),
    ];
    return this._contextVariables;
  }

  /** Filters placeholders to the ones meaningful for the selected category/attribute pair. */
  getContextVariablesFor(category: AttributeCategory, attributeKey: string): ContextVariable[] {
    return this.contextVariables.filter((v) => {
      const matchKey = !v.forAttributeKeys?.length || v.forAttributeKeys.includes(attributeKey);
      const matchCat = !v.forCategories?.length || v.forCategories.includes(category);
      return matchKey && matchCat;
    });
  }

  /** Convenience wrapper used by consumers that should not import resolver internals directly. */
  isContextVariable(value: unknown): boolean {
    return isContextVariable(value);
  }

  /** Formats literal and context-variable values for readable policy summaries. */
  formatValue(value: unknown): string {
    if (typeof value === "string" && this.isContextVariable(value)) {
      return this.contextVariables.find((v) => v.value === value)?.label ?? value;
    }
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  // =====================================================
  // ENVIRONMENT / VALIDATION HELPERS
  // =====================================================

  /**
   * Produces the environment bucket used during evaluation.
   * Services pass request-specific facts in `extra`; resolvers fill in safe defaults such as current time.
   */
  buildEnvironmentContext(extra?: Record<string, unknown>): Record<string, unknown> {
    // Environment resolvers capture request-time facts such as time/day.
    // Explicit values from the caller win over defaults for testing/overrides.
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

  /** Validates an unknown object before it can be saved or evaluated as an ABAC policy. */
  validatePolicy(policy: unknown): PolicyValidationResult {
    // Validate the persisted/imported policy shape before it reaches
    // evaluation. This keeps malformed UI payloads out of the planner.
    const result = policySchema.safeParse(policy);
    if (result.success) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "";
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }

  // =====================================================
  // DIRECT POLICY EVALUATION
  // =====================================================

  /**
   * Evaluates an ordered condition list with per-condition AND/OR connectors.
   * This supports mixed boolean expressions from the policy builder without requiring nested groups in storage.
   */
  private evaluateConditions(
    conditions: PolicyCondition[],
    fallbackLogic: PolicyCondition["logic"],
    context: EvaluationContext,
  ): boolean {
    if (conditions.length === 0) return true;

    let result = this.evaluateCondition(conditions[0]!, context);
    for (let index = 1; index < conditions.length; index++) {
      const condition = conditions[index]!;
      const logic = condition.logic ?? fallbackLogic;
      const conditionResult = this.evaluateCondition(condition, context);

      result = logic === "OR"
        ? result || conditionResult
        : result && conditionResult;
    }

    return result;
  }

  /** Evaluates one condition by resolving its left/right operands and dispatching to the operator engine. */
  evaluateCondition(condition: PolicyCondition, context: EvaluationContext): boolean {
    // A condition compares one attribute from subject/environment/resource
    // against either a literal value or a resolved context variable.
    logAbac("EVAL_CONDITION_START", "Evaluating policy condition", {
      conditionId: condition.id,
      category: condition.category,
      attributeKey: condition.attribute.key,
      operator: condition.attribute.operator,
      value: condition.attribute.value,
    });

    if (condition.category !== "subject" && condition.category !== "environment" && condition.category !== "resource") {
      logAbac("EVAL_CONDITION_SKIP", "Condition skipped because category is invalid", { conditionId: condition.id, category: condition.category });
      return true;
    }

    const bucket = condition.category === "resource" ? context.resource : context[condition.category];
    if (!bucket || typeof bucket !== "object") {
      logAbac("EVAL_CONDITION_SKIP", "Condition skipped because context bucket is missing", { conditionId: condition.id, category: condition.category });
      return false;
    }

    const left = (bucket as Record<string, unknown>)[condition.attribute.key];
    logAbac("EVAL_CONDITION_LEFT", "Resolved condition left value", {
      conditionId: condition.id,
      attributeKey: condition.attribute.key,
      left,
    });

    if (left === undefined || left === null) {
      logAbac("EVAL_CONDITION_NULL", "Condition skipped because left value is null", {
        conditionId: condition.id,
        attributeKey: condition.attribute.key,
      });
      return false;
    }

    const resolved = resolveValue(condition.attribute.value, context, this._resolverMap);
    logAbac("EVAL_CONDITION_RIGHT", "Resolved condition right value", {
      conditionId: condition.id,
      operator: condition.attribute.operator,
      rawValue: condition.attribute.value,
      resolved,
    });

    const result = compare(left, resolved, condition.attribute.operator);
    logAbac("EVAL_CONDITION_RESULT", "Condition evaluation completed", {
      conditionId: condition.id,
      operator: condition.attribute.operator,
      left,
      right: resolved,
      result,
    });
    return result;
  }

  /** Checks whether one policy applies to the requested resource/action/context. */
  evaluatePolicy(policy: Policy, context: EvaluationContext, targetResource: string): boolean {
    // Direct policy evaluation is used when the caller has a complete resource
    // context. List endpoints generally use planCompiledAccess() instead.
    logAbac("EVAL_POLICY_START", "Evaluating policy match", {
      policyId: policy.id,
      policyName: policy.name,
      effect: policy.effect,
      priority: policy.priority,
      targetResource,
      action: context.action,
    });

    if (!policy.isActive) return false;
    if (!policy.resources.includes("*") && !policy.resources.includes(targetResource)) {
      logAbac("EVAL_POLICY_SKIP", "Policy skipped due to resource mismatch", {
        policyId: policy.id,
        policyName: policy.name,
        policyResources: policy.resources,
        targetResource,
      });
      return false;
    }
    if (!policy.actions.includes("*") && !policy.actions.includes(context.action)) {
      logAbac("EVAL_POLICY_SKIP", "Policy skipped due to action mismatch", {
        policyId: policy.id,
        policyName: policy.name,
        policyActions: policy.actions,
        action: context.action,
      });
      return false;
    }
    if (policy.conditions.length === 0) {
      logAbac("EVAL_POLICY_MATCH", "Unconditional policy matched", { policyId: policy.id, policyName: policy.name });
      return true;
    }

    const conditionsMet = this.evaluateConditions(policy.conditions, policy.conditionLogic, context);

    logAbac("EVAL_POLICY_RESULT", "Policy evaluation completed", {
      policyId: policy.id,
      policyName: policy.name,
      conditionLogic: policy.conditionLogic,
      conditionsMet,
    });
    return conditionsMet;
  }

  /** Applies deny-overrides-allow semantics across all matching direct-evaluation policies. */
  private evaluatePolicyDecision(policies: Policy[], context: EvaluationContext, targetResource: string): AccessDecision {
    // Deny overrides allow. Priority decides which matched policy is reported
    // first, but any matching deny is enough to deny the decision.
    const sorted = policies.filter((p) => p.isActive).sort((a, b) => b.priority - a.priority);
    const matchedDenies: Policy[] = [];
    const matchedAllows: Policy[] = [];

    for (const p of sorted) {
      if (!p.resources.includes("*") && !p.resources.includes(targetResource)) continue;
      if (!p.actions.includes("*") && !p.actions.includes(context.action)) continue;

      const conditionsMet = this.evaluateConditions(p.conditions, p.conditionLogic, context);
      if (!conditionsMet) continue;

      (p.effect === "deny" ? matchedDenies : matchedAllows).push(p);
    }

    if (matchedDenies.length > 0) {
      return {
        allowed: false,
        reason: `Denied by policy: ${matchedDenies[0].name}`,
        matchedPolicy: matchedDenies[0],
      };
    }
    if (matchedAllows.length > 0) {
      return {
        allowed: true,
        reason: `Allowed by policy: ${matchedAllows[0].name}`,
        matchedPolicy: matchedAllows[0],
      };
    }

    const allowed = this.defaultEffect !== "deny";
    return {
      allowed,
      reason: allowed
        ? "No matching deny policy (default allow)"
        : "No matching policy (default deny)",
    };
  }

  // =====================================================
  // COMPILED PLANNING API
  // =====================================================

  /**
   * Compiles policies for one tenant/resource/action slice.
   * Auth-api caches this shape so DPBE authorization calls do not reprocess the full policy table every time.
   */
  compilePolicies(params: {
    policies: Policy[];
    tenantId: string;
    resource: string;
    action: string;
    defaultEffect?: PolicyEffect;
    updatedAt?: Date | string;
  }) {
    // Compile one resource/action policy slice into the portable V4 shape used
    // by the planning path. The caller can persist/cache this if needed.
    return compilePolicies({
      ...params,
      defaultEffect: params.defaultEffect ?? this.defaultEffect,
    });
  }

  /**
   * Builds the final V4 authorization plan returned to services.
   * The plan is intentionally portable: services either deny, allow, or apply include/exclude filters locally.
   */
  planCompiledAccess(params: {
    compiledPolicySet: import("./types").CompiledPolicySet;
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
    // Main gRPC planning path:
    // CompiledPolicySet + request context -> include/exclude filters or a
    // final allow/deny decision. DPBE enforces the returned plan.
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
      schemaVersion: 4,
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

    logAbac("PLAN_COMPILED_ACCESS_RESULT", "ABAC V4 compiled access plan completed", { plan });
    return plan;
  }

}

// =====================================================
// FILTER EVALUATION HELPERS
// =====================================================

/**
 * Evaluates a filter AST against a concrete resource object.
 * This is needed for create/single-resource checks where auth-api can decide immediately without SQL translation.
 */
function evaluateFilterValue(
  node: FilterNode | FilterGroup,
  resourceContext: Record<string, unknown> | undefined,
): boolean {
  // In-memory evaluator for the same filter AST used by SQL planning.
  // This is used for create/single decisions where resourceContext is present.
  if (!resourceContext) return false;

  if (node.type === "condition") {
    const left = resourceContext[node.field];
    if (left === undefined || left === null) return false;
    return compare(left, node.value as ConditionValue, node.operator);
  }

  if (node.logic === "OR") return node.conditions.some((child) => evaluateFilterValue(child, resourceContext));
  return node.conditions.every((child) => evaluateFilterValue(child, resourceContext));
}

/** Returns whether a deny filter matches the current resource context. */
function evaluateDenyFilterValue(
  excludeFilter: FilterNode | FilterGroup | null,
  resourceContext: Record<string, unknown> | undefined,
): boolean {
  if (!excludeFilter || !resourceContext) return false;
  return evaluateFilterValue(excludeFilter, resourceContext);
}

/**
 * Converts filter-builder output into the service-facing decision state.
 * List/bulk requests receive filter_required when row-level SQL filters must still be applied by the caller.
 */
function decideAccess(params: {
  mode: AuthorizationPlan["mode"];
  includeFilter: FilterNode | FilterGroup | null;
  excludeFilter: FilterNode | FilterGroup | null;
  decision?: "allow" | "deny";
  defaultEffect: PolicyEffect;
  resourceContext?: Record<string, unknown>;
}): AccessDecisionResult {
  // Translate filter-planning output into an enforcement instruction:
  // allow/deny for single-row contexts, or filter_required for list/bulk.
  if (params.decision === "deny") return "deny";

  if (params.mode === "create" || params.mode === "single") {
    if (evaluateDenyFilterValue(params.excludeFilter, params.resourceContext)) return "deny";
    if (params.includeFilter && (!params.resourceContext || !evaluateFilterValue(params.includeFilter, params.resourceContext))) return "deny";
    if (params.decision === "allow") return "allow";
    if (params.includeFilter) return "allow";
    return params.defaultEffect === "deny" ? "deny" : "allow";
  }

  if (params.mode === "bulk" && (params.includeFilter || params.excludeFilter)) return "filter_required";
  if (params.includeFilter || params.excludeFilter) return "filter_required";
  if (params.decision === "allow") return "allow";
  return params.defaultEffect === "deny" ? "deny" : "allow";
}

// =====================================================
// DECISION / CONFIG HELPERS
// =====================================================

/** Builds a stable human-readable reason for logs, API errors, and debugging UI. */
function reasonForDecision(decision: AccessDecisionResult, defaultEffect: PolicyEffect): string {
  // Keep reasons stable because DPBE and UI logs use them for diagnostics.
  if (decision === "deny") {
    return defaultEffect === "deny"
      ? "No matching allow policy and default effect is deny"
      : "Denied by policy";
  }
  if (decision === "filter_required") return "Apply authorization filters before returning or mutating rows";
  return "Allowed by policy";
}

/**
 * Merges default and caller-provided environment resolvers by key.
 * This lets services override behavior such as current time while keeping the rest of the package defaults.
 */
function mergeResolvers(
  defaults: EnvironmentResolver[],
  overrides?: EnvironmentResolver[],
): EnvironmentResolver[] {
  // Resolver overrides patch defaults by key, so callers can replace only the
  // resolver implementation/metadata they need.
  if (!overrides?.length) return defaults;
  const map = new Map<string, EnvironmentResolver>();
  for (const r of defaults) map.set(r.key, r);
  for (const r of overrides) map.set(r.key, { ...map.get(r.key), ...r });
  return Array.from(map.values());
}