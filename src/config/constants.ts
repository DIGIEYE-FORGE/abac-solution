import type { AttributeValueType, AttributeOperator } from "../types";

export const CONTEXT_VAR_RE = /^\{[\w.]+\}$/;

export const OPERATORS_BY_TYPE: Record<AttributeValueType, AttributeOperator[]> = {
  boolean: ["equals", "not_equals"],
  number: [
    "equals", "not_equals",
    "greater_than", "less_than",
    "greater_than_or_equal", "less_than_or_equal",
    "in", "not_in",
  ],
  date: [
    "equals", "not_equals",
    "greater_than", "less_than",
    "greater_than_or_equal", "less_than_or_equal",
  ],
  time: [
    "equals", "not_equals",
    "greater_than", "less_than",
    "greater_than_or_equal", "less_than_or_equal",
  ],
  array: ["in", "not_in", "contains", "not_contains"],
  string: [
    "equals", "not_equals",
    "contains", "not_contains",
    "starts_with", "ends_with",
    "in", "not_in",
    "regex",
  ],
};
