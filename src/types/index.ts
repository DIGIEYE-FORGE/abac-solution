export type AttributeCategory = "subject" | "environment" | "resource";

export type AttributeOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "in" | "not_in"
  | "greater_than" | "less_than"
  | "greater_than_or_equal" | "less_than_or_equal"
  | "starts_with" | "ends_with"
  | "regex" | "between";

export type AttributeValueType = "string" | "number" | "boolean" | "date" | "array" | "time";

export type ConditionValue = string | number | boolean | string[];

export type PolicyEffect = "allow" | "deny";

export type ConditionLogic = "AND" | "OR";

export interface AttributeDefinition {
  key: string;
  label: string;
  valueType: AttributeValueType;
  description?: string;
  options?: string[];
}

export interface OperatorConfig {
  value: AttributeOperator;
  label: string;
  description?: string;
}

export interface ContextVariable {
  value: string;
  label: string;
  description?: string;
  forAttributeKeys?: string[];
  forCategories?: AttributeCategory[];
}

export interface EnvironmentResolver {
  key: string;
  label: string;
  description?: string;
  forAttributeKeys?: string[];
  resolve?: () => ConditionValue;
}

export interface ResourceConfig {
  value: string;
  label: string;
  description?: string;
  category?: string;
}

export interface ActionConfig {
  value: string;
  label: string;
  description?: string;
  httpMethods?: string[];
}

export interface PolicyCondition {
  id: string;
  category: AttributeCategory;
  attribute: {
    key: string;
    value: ConditionValue;
    operator: AttributeOperator;
  };
  external?: boolean; // true = requires an external runtime check, always routes to residuals
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  resources: string[];
  actions: string[];
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  conditionLogic: ConditionLogic;
  priority: number;
  isActive: boolean;
}

export interface EvaluationContext {
  subject: Record<string, unknown>;
  action: string;
  environment: Record<string, unknown>;
  resource?: Record<string, unknown>;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchedPolicy?: Policy;
}

export interface SkippedPolicy {
  policy: Policy;
  reason: "resource_mismatch" | "action_mismatch" | "condition_failed";
}

export interface AccessExplanation {
  decision: AccessDecision;
  matchedDenies: Policy[];
  matchedAllows: Policy[];
  skipped: SkippedPolicy[];
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

// ── AST / Partial Evaluation types ────────────────────────────────────────────

export type FilterNodeCost = "low" | "medium" | "high";

export interface OperatorSqlMeta {
  capable: boolean;
  cost: FilterNodeCost;
  indexSafe: boolean;
}

export interface FilterNode {
  type: "condition";
  field: string;           // DB column name — same as attribute key
  operator: AttributeOperator;
  value: ConditionValue;
  sqlCapable: boolean;
  queryCost: FilterNodeCost;  // advisory: DPBE may defer high-cost nodes to verification
  indexSafe: boolean;         // false = no index can be used for this condition
}

export interface FilterGroup {
  type: "group";
  logic: ConditionLogic;
  conditions: Array<FilterNode | FilterGroup>;
}

export interface ResidualCondition {
  policyId: string;
  policyName: string;
  condition: PolicyCondition;
  reason: "non_resource_category" | "unresolvable_context_var" | "non_sql_operator" | "unknown_field" | "external_dependency";
}

export interface FilterResult {
  schemaVersion: 1;

  // Positive filter — from ALLOW policies. Pass to SQL builder as WHERE (includeFilter).
  // null = no row-level restriction (unconditional allow).
  // NEVER_MATCH sentinel = no matching policy and defaultEffect is "deny" → zero rows.
  includeFilter: FilterGroup | FilterNode | null;

  // Negative filter — from DENY policies with SQL-able resource conditions.
  // Each top-level child represents ONE deny policy's conditions.
  // SQL translator wraps each child in NOT() independently — NOT(child1) AND NOT(child2).
  // Do NOT emit NOT(excludeFilter) as a single expression.
  excludeFilter: FilterGroup | FilterNode | null;

  // true = AST is incomplete; run per-row evaluateAccess() after DB fetch
  requiresVerification: boolean;

  // Conditions that could not be pushed to SQL — for logging and Phase 2
  residualConditions: ResidualCondition[];

  defaultEffect: PolicyEffect;
  policyIds: string[];
  warnings: string[];
}

// ── ABAC configuration ─────────────────────────────────────────────────────────

export interface ABACConfig {
  attributes?: {
    subject?: AttributeDefinition[];
    environment?: AttributeDefinition[];
    resource?: AttributeDefinition[];
  };
  operators?: OperatorConfig[];
  environmentResolvers?: EnvironmentResolver[];
  resources?: ResourceConfig[];
  actions?: ActionConfig[];
  defaultEffect?: PolicyEffect;
}
