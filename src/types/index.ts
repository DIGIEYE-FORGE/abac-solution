<<<<<<< HEAD
export type AttributeCategory = "subject" | "environment";
=======
export type AttributeCategory = "subject" | "environment" | "resource";
>>>>>>> Abac-V4

export type AttributeOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "in" | "not_in"
  | "greater_than" | "less_than"
  | "greater_than_or_equal" | "less_than_or_equal"
  | "starts_with" | "ends_with"
<<<<<<< HEAD
  | "regex";
=======
  | "regex" | "between";
>>>>>>> Abac-V4

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
<<<<<<< HEAD
=======
  httpMethods?: string[];
>>>>>>> Abac-V4
}

export interface PolicyCondition {
  id: string;
  category: AttributeCategory;
<<<<<<< HEAD
=======
  logic?: ConditionLogic;
>>>>>>> Abac-V4
  attribute: {
    key: string;
    value: ConditionValue;
    operator: AttributeOperator;
  };
<<<<<<< HEAD
=======
  external?: boolean;
>>>>>>> Abac-V4
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
<<<<<<< HEAD
=======
  resource?: Record<string, unknown>;
>>>>>>> Abac-V4
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchedPolicy?: Policy;
}

<<<<<<< HEAD
export interface AccessExplanation {
  decision: AccessDecision;
  matchedDenies: Policy[];
  matchedAllows: Policy[];
  skipped: Policy[];
=======

export type AuthorizationMode = "single" | "list" | "create" | "bulk";

export type AccessDecisionResult = "allow" | "deny" | "filter_required";

export interface AuthorizationPlan {
  schemaVersion: 4;
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
  schemaVersion: 4;
  tenantId: string;
  resource: string;
  action: string;
  defaultEffect: PolicyEffect;
  updatedAt: string;
  allowPolicies: CompiledPolicy[];
  denyPolicies: CompiledPolicy[];
>>>>>>> Abac-V4
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

<<<<<<< HEAD
=======
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
  schemaVersion: 4;
  includeFilter: FilterGroup | FilterNode | null;
  excludeFilter: FilterGroup | FilterNode | null;
  decision?: Extract<AccessDecisionResult, "allow" | "deny">;
  defaultEffect: PolicyEffect;
  policyIds: string[];
}

>>>>>>> Abac-V4
export interface ABACConfig {
  attributes?: {
    subject?: AttributeDefinition[];
    environment?: AttributeDefinition[];
<<<<<<< HEAD
=======
    resource?: AttributeDefinition[];
>>>>>>> Abac-V4
  };
  operators?: OperatorConfig[];
  environmentResolvers?: EnvironmentResolver[];
  resources?: ResourceConfig[];
  actions?: ActionConfig[];
  defaultEffect?: PolicyEffect;
}
