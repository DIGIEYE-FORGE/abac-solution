export type AttributeCategory = "subject" | "environment" | "resource";

export type AttributeOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "in" | "not_in"
  | "greater_than" | "less_than"
  | "greater_than_or_equal" | "less_than_or_equal"
  | "starts_with" | "ends_with"
  | "regex" | "between";

export type ConditionValue = string | number | boolean | string[];
export type PolicyEffect = "allow" | "deny";
export type ConditionLogic = "AND" | "OR";

export interface EnvironmentResolver {
  key: string;
  label: string;
  description?: string;
  forAttributeKeys?: string[];
  resolve?: () => ConditionValue;
}

export interface PolicyCondition {
  id: string;
  category: AttributeCategory;
  logic?: ConditionLogic;
  attribute: {
    key: string;
    value: ConditionValue;
    operator: AttributeOperator;
  };
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

export type AuthorizationMode = "single" | "list" | "create" | "bulk";
export type AccessDecisionResult = "allow" | "deny" | "filter_required";

export interface AuthorizationPlan {
  requestId: string;
  tenantId: string;
  userId: string;
  resource: string;
  action: string;
  mode: AuthorizationMode;
  decision: AccessDecisionResult;
  reason: string;
  includeFilter: FilterGroup | FilterNode | null;
  excludeFilter: FilterGroup | FilterNode | null;
  defaultEffect: PolicyEffect;
  policyIds: string[];
}

export interface CompiledPolicy {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  priority: number;
  conditionLogic: ConditionLogic;
  conditions: PolicyCondition[];
  updatedAt: string;
}

export interface CompiledPolicySet {
  tenantId: string;
  resource: string;
  action: string;
  defaultEffect: PolicyEffect;
  updatedAt: string;
  allowPolicies: CompiledPolicy[];
  denyPolicies: CompiledPolicy[];
}

export interface FilterNode {
  type: "condition";
  field: string;
  operator: AttributeOperator;
  value: ConditionValue;
}

export interface FilterGroup {
  type: "group";
  logic: ConditionLogic;
  conditions: Array<FilterNode | FilterGroup>;
}

export interface FilterResult {
  includeFilter: FilterGroup | FilterNode | null;
  excludeFilter: FilterGroup | FilterNode | null;
  decision?: Extract<AccessDecisionResult, "allow" | "deny">;
  defaultEffect: PolicyEffect;
  policyIds: string[];
}

export interface ABACConfig {
  environmentResolvers?: EnvironmentResolver[];
  defaultEffect?: PolicyEffect;
}