import { z } from "zod";

/** Valid condition buckets; keeping this strict prevents policies from reading arbitrary request data. */
export const attributeCategorySchema = z.enum(["subject", "environment", "resource"]);

/** Operator contract shared by the UI, persisted policy JSON, and evaluator. */
export const attributeOperatorSchema = z.enum([
  "equals", "not_equals",
  "contains", "not_contains",
  "in", "not_in",
  "greater_than", "less_than",
  "greater_than_or_equal", "less_than_or_equal",
  "starts_with", "ends_with",
  "regex", "between",
]);

/** ABAC only supports explicit allow/deny effects; conflict resolution is handled by the engine. */
export const policyEffectSchema = z.enum(["allow", "deny"]);

/** Boolean connector used between ordered policy conditions. */
export const conditionLogicSchema = z.enum(["AND", "OR"]);

/** Supported persisted value types for policy comparisons. */
export const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

/** One persisted condition row from the policy builder. */
export const policyConditionSchema = z.object({
  id: z.string().min(1, "Condition id is required"),
  category: attributeCategorySchema,
  logic: conditionLogicSchema.optional(),
  attribute: z.object({
    key: z.string().min(1, "Attribute key is required"),
    value: conditionValueSchema,
    operator: attributeOperatorSchema,
  }),
  external: z.boolean().optional(),
});

/** Full policy schema used before a policy can be evaluated or compiled. */
export const policySchema = z.object({
  id: z.string().min(1, "Policy id is required"),
  name: z.string().min(1, "Policy name is required"),
  description: z.string().optional(),
  resources: z.array(z.string()).min(1, "At least one resource is required"),
  actions: z.array(z.string()).min(1, "At least one action is required"),
  effect: policyEffectSchema,
  conditions: z.array(policyConditionSchema),
  conditionLogic: conditionLogicSchema,
  priority: z.number().min(0, "Priority must be >= 0"),
  isActive: z.boolean(),
});

/** Single row-level filter condition returned to services for SQL translation. */
export const filterNodeSchema = z.object({
  type: z.literal("condition"),
  field: z.string(),
  operator: attributeOperatorSchema,
  value: conditionValueSchema,
});

/** Recursive filter group schema for nested AND/OR authorization filters. */
export const filterGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.literal("group"),
    logic: conditionLogicSchema,
    conditions: z.array(z.union([filterNodeSchema, filterGroupSchema])),
  }),
);

/** Low-level planner response before it is wrapped as a service authorization plan. */
export const filterResultSchema = z.object({
  schemaVersion: z.literal(4),
  includeFilter: z.union([filterNodeSchema, filterGroupSchema]).nullable(),
  excludeFilter: z.union([filterNodeSchema, filterGroupSchema]).nullable(),
  decision: z.enum(["allow", "deny"]).optional(),
  defaultEffect: policyEffectSchema,
  policyIds: z.array(z.string()),
});