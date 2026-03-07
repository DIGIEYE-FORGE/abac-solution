export type AttributeCategory = "subject" | "environment";

export type AttributeOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "in" | "not_in"
  | "greater_than" | "less_than"
  | "greater_than_or_equal" | "less_than_or_equal"
  | "starts_with" | "ends_with"
  | "regex";

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
}

export interface PolicyCondition {
  id: string;
  category: AttributeCategory;
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
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchedPolicy?: Policy;
}

export interface AccessExplanation {
  decision: AccessDecision;
  matchedDenies: Policy[];
  matchedAllows: Policy[];
  skipped: Policy[];
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ABACConfig {
  attributes?: {
    subject?: AttributeDefinition[];
    environment?: AttributeDefinition[];
  };
  operators?: OperatorConfig[];
  environmentResolvers?: EnvironmentResolver[];
  resources?: ResourceConfig[];
  actions?: ActionConfig[];
  defaultEffect?: PolicyEffect;
}
