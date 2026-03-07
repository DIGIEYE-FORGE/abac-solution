import { z } from "zod";

export const attributeCategorySchema = z.enum(["subject", "environment"]);

export const attributeOperatorSchema = z.enum([
  "equals", "not_equals",
  "contains", "not_contains",
  "in", "not_in",
  "greater_than", "less_than",
  "greater_than_or_equal", "less_than_or_equal",
  "starts_with", "ends_with",
  "regex",
]);

export const policyEffectSchema = z.enum(["allow", "deny"]);

export const conditionLogicSchema = z.enum(["AND", "OR"]);

export const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const policyConditionSchema = z.object({
  id: z.string().min(1, "Condition id is required"),
  category: attributeCategorySchema,
  attribute: z.object({
    key: z.string().min(1, "Attribute key is required"),
    value: conditionValueSchema,
    operator: attributeOperatorSchema,
  }),
});

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
