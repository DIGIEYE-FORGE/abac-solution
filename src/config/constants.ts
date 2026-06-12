import type { AttributeValueType, AttributeOperator, OperatorSqlMeta } from "../types";

export const CONTEXT_VAR_RE = /^\{[\w.]+\}$/;

export const SQL_OPERATOR_META: Record<AttributeOperator, OperatorSqlMeta> = {
  equals:                 { capable: true,  cost: "low",    indexSafe: true  },
  not_equals:             { capable: true,  cost: "low",    indexSafe: true  },
  in:                     { capable: true,  cost: "low",    indexSafe: true  },
  not_in:                 { capable: true,  cost: "low",    indexSafe: true  },
  greater_than:           { capable: true,  cost: "low",    indexSafe: true  },
  less_than:              { capable: true,  cost: "low",    indexSafe: true  },
  greater_than_or_equal:  { capable: true,  cost: "low",    indexSafe: true  },
  less_than_or_equal:     { capable: true,  cost: "low",    indexSafe: true  },
  starts_with:            { capable: true,  cost: "medium", indexSafe: true  },
  ends_with:              { capable: true,  cost: "medium", indexSafe: false },
  contains:               { capable: true,  cost: "high",   indexSafe: false },
  not_contains:           { capable: true,  cost: "high",   indexSafe: false },
  between:                { capable: true,  cost: "low",    indexSafe: true  },
  regex:                  { capable: false, cost: "high",   indexSafe: false },
};

export const SQL_CAPABLE_OPERATORS: Record<AttributeOperator, boolean> = Object.fromEntries(
  Object.entries(SQL_OPERATOR_META).map(([k, v]) => [k, (v as OperatorSqlMeta).capable]),
) as Record<AttributeOperator, boolean>;

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
    "between",
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
