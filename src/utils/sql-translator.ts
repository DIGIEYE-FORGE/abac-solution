import type { FilterNode, FilterGroup, ConditionValue } from "../types";

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

// ── toSql ────────────────────────────────────────────────────────────────────
// Translates a FilterNode or FilterGroup AST into a parameterised SQL WHERE fragment.
// Uses positional parameters ($1, $2, ...) — compatible with PostgreSQL / node-postgres.
//
// @param node   - Root node of the filter AST (FilterResult.includeFilter or one deny child)
// @param offset - Parameter index offset for recursive calls. Always pass 0 externally.

export function toSql(node: FilterNode | FilterGroup, offset = 0): SqlFragment {
  if (node.type === "condition") return conditionToSql(node, offset);
  return groupToSql(node, offset);
}

// ── excludeToSqlParts ────────────────────────────────────────────────────────
// Translates FilterResult.excludeFilter into individual NOT(...) SQL fragments.
//
// IMPORTANT: each deny policy must be negated independently.
// Do NOT wrap the whole excludeFilter in a single NOT() — that produces
// NOT(A AND B) = NOT A OR NOT B, which is semantically wrong (too permissive).
// The correct output is: NOT(policyA_conditions) AND NOT(policyB_conditions).
//
// Returns an array where each element is one deny policy wrapped in NOT(...).
// The caller ANDs all of them into the WHERE clause.

export function excludeToSqlParts(
  excludeFilter: FilterNode | FilterGroup,
  offset = 0,
): SqlFragment[] {
  // Single condition node
  if (excludeFilter.type === "condition") {
    const { sql, params } = conditionToSql(excludeFilter, offset);
    return [{ sql: `NOT (${sql})`, params }];
  }

  // AND group = multiple deny policies, each child is one policy — wrap each independently
  if (excludeFilter.logic === "AND" && excludeFilter.conditions.length > 0) {
    const parts: SqlFragment[] = [];
    let currentOffset = offset;
    for (const child of excludeFilter.conditions) {
      const { sql, params } = toSql(child, currentOffset);
      parts.push({ sql: `NOT (${sql})`, params });
      currentOffset += params.length;
    }
    return parts;
  }

  // OR group = single deny policy with OR-logic conditions — wrap the whole thing
  const { sql, params } = toSql(excludeFilter, offset);
  return [{ sql: `NOT (${sql})`, params }];
}

// ── internals ────────────────────────────────────────────────────────────────

function conditionToSql(node: FilterNode, offset: number): SqlFragment {
  const idx = offset + 1;
  const col = `"${node.field}"`;

  switch (node.operator) {
    case "equals":
      return { sql: `${col} = $${idx}`, params: [node.value] };
    case "not_equals":
      return { sql: `${col} != $${idx}`, params: [node.value] };
    case "greater_than":
      return { sql: `${col} > $${idx}`, params: [node.value] };
    case "less_than":
      return { sql: `${col} < $${idx}`, params: [node.value] };
    case "greater_than_or_equal":
      return { sql: `${col} >= $${idx}`, params: [node.value] };
    case "less_than_or_equal":
      return { sql: `${col} <= $${idx}`, params: [node.value] };
    case "contains":
      return { sql: `${col} LIKE $${idx}`, params: [`%${node.value}%`] };
    case "not_contains":
      return { sql: `${col} NOT LIKE $${idx}`, params: [`%${node.value}%`] };
    case "starts_with":
      return { sql: `${col} LIKE $${idx}`, params: [`${node.value}%`] };
    case "ends_with":
      return { sql: `${col} LIKE $${idx}`, params: [`%${node.value}`] };
    case "in": {
      const vals = Array.isArray(node.value) ? node.value : [node.value];
      const placeholders = (vals as ConditionValue[]).map((_, i) => `$${offset + i + 1}`).join(", ");
      return { sql: `${col} IN (${placeholders})`, params: vals };
    }
    case "not_in": {
      const vals = Array.isArray(node.value) ? node.value : [node.value];
      const placeholders = (vals as ConditionValue[]).map((_, i) => `$${offset + i + 1}`).join(", ");
      return { sql: `${col} NOT IN (${placeholders})`, params: vals };
    }
    case "between": {
      // value is "HH:MM-HH:MM" or "start-end"
      // indexOf("-", 3) skips the colon in HH:MM so we don't split on it
      const str = String(node.value);
      const dashIdx = str.indexOf("-", 3);
      if (dashIdx === -1) throw new Error(`Invalid between value: "${str}"`);
      const start = str.slice(0, dashIdx);
      const end   = str.slice(dashIdx + 1);
      return { sql: `${col} BETWEEN $${idx} AND $${idx + 1}`, params: [start, end] };
    }
    default:
      // regex and any non-SQL operators should never reach here — isSqlCapable() routes them to residuals
      throw new Error(`Operator "${node.operator}" is not SQL-translatable`);
  }
}

function groupToSql(group: FilterGroup, offset: number): SqlFragment {
  if (group.conditions.length === 0) return { sql: "1=1", params: [] };
  if (group.conditions.length === 1) return toSql(group.conditions[0]!, offset);

  const parts: string[] = [];
  const allParams: unknown[] = [];

  for (const child of group.conditions) {
    const fragment = toSql(child, offset + allParams.length);
    // wrap child in parens if it's a group with a different logic operator
    const needsParens = child.type === "group";
    parts.push(needsParens ? `(${fragment.sql})` : fragment.sql);
    allParams.push(...fragment.params);
  }

  const joinWord = group.logic === "OR" ? " OR " : " AND ";
  return { sql: parts.join(joinWord), params: allParams };
}
