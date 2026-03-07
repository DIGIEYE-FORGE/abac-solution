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
  AccessExplanation,
  PolicyValidationResult,
  ABACConfig,
  EnvironmentResolver,
  ResourceConfig,
  ActionConfig,
} from "./types";

import { policySchema } from "./config/schemas";
import { OPERATORS_BY_TYPE } from "./config/constants";
import {
  DEFAULT_OPERATORS,
  DEFAULT_SUBJECT_ATTRIBUTES,
  DEFAULT_ENVIRONMENT_ATTRIBUTES,
  DEFAULT_ENVIRONMENT_RESOLVERS,
  DEFAULT_RESOURCES,
  DEFAULT_ACTIONS,
} from "./config/defaults";
import { compare } from "./utils/operators";
import { resolveValue, isContextVariable } from "./utils/resolver";

export class ABAC {
  readonly attributes: {
    subject: AttributeDefinition[];
    environment: AttributeDefinition[];
  };
  readonly operators: OperatorConfig[];
  readonly environmentResolvers: EnvironmentResolver[];
  readonly resources: ResourceConfig[];
  readonly actions: ActionConfig[];
  readonly defaultEffect: PolicyEffect;

  private _contextVariables: ContextVariable[] | null = null;
  private _resourceCategories: string[] | null = null;
  private readonly _resolverMap: Map<string, EnvironmentResolver>;
  private readonly _attrMap: Record<AttributeCategory, Map<string, AttributeDefinition>>;
  private readonly _resourceMap: Map<string, ResourceConfig>;
  private readonly _actionMap: Map<string, ActionConfig>;
  private readonly _operatorSet: Map<string, Set<string>>;
  private readonly _operatorCache = new Map<string, OperatorConfig[]>();

  constructor(config?: ABACConfig) {
    this.attributes = {
      subject: config?.attributes?.subject ?? DEFAULT_SUBJECT_ATTRIBUTES,
      environment: config?.attributes?.environment ?? DEFAULT_ENVIRONMENT_ATTRIBUTES,
    };
    this.operators = config?.operators ?? DEFAULT_OPERATORS;
    this.environmentResolvers = mergeResolvers(
      DEFAULT_ENVIRONMENT_RESOLVERS,
      config?.environmentResolvers,
    );
    this.resources = config?.resources ?? DEFAULT_RESOURCES;
    this.actions = config?.actions ?? DEFAULT_ACTIONS;
    this.defaultEffect = config?.defaultEffect ?? "deny";

    this._resolverMap = new Map(this.environmentResolvers.map((r) => [r.key, r]));
    this._attrMap = {
      subject: new Map(this.attributes.subject.map((a) => [a.key, a])),
      environment: new Map(this.attributes.environment.map((a) => [a.key, a])),
    };
    this._resourceMap = new Map(this.resources.map((r) => [r.value, r]));
    this._actionMap = new Map(this.actions.map((a) => [a.value, a]));
    this._operatorSet = new Map(
      Object.entries(OPERATORS_BY_TYPE).map(([type, ops]) => [type, new Set<string>(ops)]),
    );
  }

  // ── Attribute accessors ─────────────────────────────────────────────

  getAttributes(category: AttributeCategory): AttributeDefinition[] {
    return this.attributes[category];
  }

  getAttribute(category: AttributeCategory, key: string): AttributeDefinition | undefined {
    return this._attrMap[category]?.get(key);
  }

  getAttributeLabel(category: AttributeCategory, key: string): string {
    return this.getAttribute(category, key)?.label ?? key;
  }


  getResources(category?: string): ResourceConfig[] {
    if (!category) return this.resources;
    return this.resources.filter((r) => r.category === category);
  }

  getResource(value: string): ResourceConfig | undefined {
    return this._resourceMap.get(value);
  }

  getResourceLabel(value: string): string {
    return this.getResource(value)?.label ?? value;
  }

  getResourceCategories(): string[] {
    if (this._resourceCategories) return this._resourceCategories;
    const cats = new Set<string>();
    for (const r of this.resources) {
      if (r.category) cats.add(r.category);
    }
    this._resourceCategories = Array.from(cats);
    return this._resourceCategories;
  }


  getActions(): ActionConfig[] {
    return this.actions;
  }

  getAction(value: string): ActionConfig | undefined {
    return this._actionMap.get(value);
  }

  getActionLabel(value: string): string {
    return this.getAction(value)?.label ?? value;
  }


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


  get contextVariables(): ContextVariable[] {
    if (this._contextVariables) return this._contextVariables;
    this._contextVariables = [
      ...this.attributes.subject.map((attr) => ({
        value: `{subject.${attr.key}}`,
        label: `User ${attr.label.toLowerCase()}`,
        description: `Resolved to the subject's ${attr.label.toLowerCase()}.`,
        forAttributeKeys: [attr.key],
        forCategories: ["subject" as AttributeCategory, "environment" as AttributeCategory],
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

  getContextVariablesFor(category: AttributeCategory, attributeKey: string): ContextVariable[] {
    return this.contextVariables.filter((v) => {
      const matchKey = !v.forAttributeKeys?.length || v.forAttributeKeys.includes(attributeKey);
      const matchCat = !v.forCategories?.length || v.forCategories.includes(category);
      return matchKey && matchCat;
    });
  }

  isContextVariable(value: unknown): boolean {
    return isContextVariable(value);
  }

  formatValue(value: unknown): string {
    if (typeof value === "string" && this.isContextVariable(value)) {
      return this.contextVariables.find((v) => v.value === value)?.label ?? value;
    }
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }


  buildEnvironmentContext(extra?: Record<string, unknown>): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    for (const resolver of this.environmentResolvers) {
      if (!resolver.resolve) continue;
      base[resolver.key] = resolver.resolve();
    }
    return { ...base, ...extra };
  }


  validatePolicy(policy: unknown): PolicyValidationResult {
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


  evaluateCondition(condition: PolicyCondition, context: EvaluationContext): boolean {
    const { category, attribute } = condition;
    if (category !== "subject" && category !== "environment") return true;

    const bucket = context[category];
    if (!bucket || typeof bucket !== "object") return false;

    const left = (bucket as Record<string, unknown>)[attribute.key];
    if (left === undefined) return false;

    const resolved = resolveValue(attribute.value, context, this._resolverMap);
    return compare(left, resolved, attribute.operator);
  }

  evaluatePolicy(policy: Policy, context: EvaluationContext, targetResource: string): boolean {
    if (!policy.resources.includes("*") && !policy.resources.includes(targetResource)) return false;
    if (!policy.actions.includes("*") && !policy.actions.includes(context.action)) return false;
    if (policy.conditions.length === 0) return true;

    return policy.conditionLogic === "OR"
      ? policy.conditions.some((c) => this.evaluateCondition(c, context))
      : policy.conditions.every((c) => this.evaluateCondition(c, context));
  }

  evaluateAccess(policies: Policy[], context: EvaluationContext, targetResource: string): AccessDecision {
    return this.explainAccess(policies, context, targetResource).decision;
  }

  explainAccess(policies: Policy[], context: EvaluationContext, targetResource: string): AccessExplanation {
    const sorted = policies.filter((p) => p.isActive).sort((a, b) => b.priority - a.priority);
    const matchedDenies: Policy[] = [];
    const matchedAllows: Policy[] = [];
    const skipped: Policy[] = [];

    for (const p of sorted) {
      if (!this.evaluatePolicy(p, context, targetResource)) {
        skipped.push(p);
        continue;
      }
      (p.effect === "deny" ? matchedDenies : matchedAllows).push(p);
    }

    let decision: AccessDecision;

    if (matchedDenies.length > 0) {
      decision = {
        allowed: false,
        reason: `Denied by policy: ${matchedDenies[0].name}`,
        matchedPolicy: matchedDenies[0],
      };
    } else if (matchedAllows.length > 0) {
      decision = {
        allowed: true,
        reason: `Allowed by policy: ${matchedAllows[0].name}`,
        matchedPolicy: matchedAllows[0],
      };
    } else {
      const allowed = this.defaultEffect !== "deny";
      decision = {
        allowed,
        reason: allowed
          ? "No matching deny policy (default allow)"
          : "No matching policy (default deny)",
      };
    }

    return { decision, matchedDenies, matchedAllows, skipped };
  }


  can(params: {
    policies: Policy[];
    action: string;
    resource: string;
    subject: Record<string, unknown>;
    environment?: Record<string, unknown>;
  }): AccessDecision {
    const context: EvaluationContext = {
      subject: params.subject,
      action: params.action,
      environment: params.environment ?? this.buildEnvironmentContext(),
    };
    return this.evaluateAccess(params.policies, context, params.resource);
  }
}

function mergeResolvers(
  defaults: EnvironmentResolver[],
  overrides?: EnvironmentResolver[],
): EnvironmentResolver[] {
  if (!overrides?.length) return defaults;
  const map = new Map<string, EnvironmentResolver>();
  for (const r of defaults) map.set(r.key, r);
  for (const r of overrides) map.set(r.key, { ...map.get(r.key), ...r });
  return Array.from(map.values());
}
