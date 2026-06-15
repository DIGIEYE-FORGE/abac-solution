import type { FilterNode, FilterGroup, ConditionValue } from "../types";
import { logAbac } from "./logger";

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
  logAbac("SQL_TO_SQL_START", "Translating include filter node to SQL", { node, offset });
  const fragment = node.type === "condition" ? conditionToSql(node, offset) : groupToSql(node, offset);
  logAbac("SQL_TO_SQL_RESULT", "Include filter SQL translation completed", { nodeType: node.type, fragment });
  return fragment;
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
  logAbac("SQL_EXCLUDE_START", "Translating exclude filter to SQL veto parts", { excludeFilter, offset });
  let parts: SqlFragment[];

  if (excludeFilter.type === "condition") {
    parts = [negateFilterToSql(excludeFilter, offset)];
  } else if (excludeFilter.logic === "AND" && excludeFilter.conditions.length > 0) {
    parts = [];
    let currentOffset = offset;
    for (const child of excludeFilter.conditions) {
      const fragment = negateFilterToSql(child, currentOffset);
      parts.push(fragment);
      currentOffset += fragment.params.length;
    }
  } else {
    parts = [negateFilterToSql(excludeFilter, offset)];
  }

  logAbac("SQL_EXCLUDE_RESULT", "Exclude filter SQL translation completed", { partCount: parts.length, parts });
  return parts;
}

function negateFilterToSql(node: FilterNode | FilterGroup, offset: number): SqlFragment {
  logAbac("SQL_NEGATE_START", "Negating filter node for deny policy", { node, offset });
  let fragment: SqlFragment;

  if (node.type === "condition") {
    const { sql, params } = conditionToSql(node, offset);
    fragment = { sql: `"${node.field}" IS NULL OR NOT (${sql})`, params };
  } else if (node.conditions.length === 0) {
    fragment = { sql: "1=1", params: [] };
  } else if (node.conditions.length === 1) {
    fragment = negateFilterToSql(node.conditions[0]!, offset);
  } else {
    const parts: string[] = [];
    const allParams: unknown[] = [];
    for (const child of node.conditions) {
      const childFragment = negateFilterToSql(child, offset + allParams.length);
      parts.push(childFragment.sql);
      allParams.push(...childFragment.params);
    }

    const joinWord = node.logic === "OR" ? " AND " : " OR ";
    fragment = { sql: parts.join(joinWord), params: allParams };
  }

  logAbac("SQL_NEGATE_RESULT", "Filter node negation completed", { nodeType: node.type, fragment });
  return fragment;
}

// ── internals ────────────────────────────────────────────────────────────────

function conditionToSql(node: FilterNode, offset: number): SqlFragment {
  const idx = offset + 1;
  const col = `"${node.field}"`;
  logAbac("SQL_CONDITION_START", "Translating condition node to SQL", { node, offset, col });

  let fragment: SqlFragment;
  switch (node.operator) {
    case "equals":
      fragment = { sql: `${col} = $${idx}`, params: [node.value] };
      break;
    case "not_equals":
      fragment = { sql: `${col} != $${idx}`, params: [node.value] };
      break;
    case "greater_than":
      fragment = { sql: `${col} > $${idx}`, params: [node.value] };
      break;
    case "less_than":
      fragment = { sql: `${col} < $${idx}`, params: [node.value] };
      break;
    case "greater_than_or_equal":
      fragment = { sql: `${col} >= $${idx}`, params: [node.value] };
      break;
    case "less_than_or_equal":
      fragment = { sql: `${col} <= $${idx}`, params: [node.value] };
      break;
    case "contains":
      fragment = { sql: `${col} LIKE $${idx}`, params: [`%${node.value}%`] };
      break;
    case "not_contains":
      fragment = { sql: `${col} NOT LIKE $${idx}`, params: [`%${node.value}%`] };
      break;
    case "starts_with":
      fragment = { sql: `${col} LIKE $${idx}`, params: [`${node.value}%`] };
      break;
    case "ends_with":
      fragment = { sql: `${col} LIKE $${idx}`, params: [`${node.value}`] };
      break;
    case "in": {
      const vals = Array.isArray(node.value) ? node.value : [node.value];
      const placeholders = (vals as ConditionValue[]).map((_, i) => `$${offset + i + 1}`).join(", ");
      fragment = { sql: `${col} IN (${placeholders})`, params: vals };
      break;
    }
    case "not_in": {
      const vals = Array.isArray(node.value) ? node.value : [node.value];
      const placeholders = (vals as ConditionValue[]).map((_, i) => `$${offset + i + 1}`).join(", ");
      fragment = { sql: `${col} NOT IN (${placeholders})`, params: vals };
      break;
    }
    case "between": {
      const str = String(node.value);
      const dashIdx = str.indexOf("-", 3);
      if (dashIdx === -1) throw new Error(`Invalid between value: "${str}"`);
      const start = str.slice(0, dashIdx);
      const end   = str.slice(dashIdx + 1);
      fragment = { sql: `${col} BETWEEN $${idx} AND $${idx + 1}`, params: [start, end] };
      break;
    }
    default:
      throw new Error(`Operator "${node.operator}" is not SQL-translatable`);
  }

  logAbac("SQL_CONDITION_RESULT", "Condition SQL translation completed", { operator: node.operator, fragment });
  return fragment;
}

function groupToSql(group: FilterGroup, offset: number): SqlFragment {
  logAbac("SQL_GROUP_START", "Translating filter group to SQL", { group, offset });
  if (group.conditions.length === 0) {
    const fragment = { sql: "1=1", params: [] };
    logAbac("SQL_GROUP_RESULT", "Empty filter group translated to TRUE", { fragment });
    return fragment;
  }
  if (group.conditions.length === 1) {
    const fragment = toSql(group.conditions[0]!, offset);
    logAbac("SQL_GROUP_RESULT", "Single-child filter group delegated to child", { fragment });
    return fragment;
  }

  const parts: string[] = [];
  const allParams: unknown[] = [];

  for (const child of group.conditions) {
    const fragment = toSql(child, offset + allParams.length);
    const needsParens = child.type === "group";
    parts.push(needsParens ? `(${fragment.sql})` : fragment.sql);
    allParams.push(...fragment.params);
  }

  const joinWord = group.logic === "OR" ? " OR " : " AND ";
  const fragment = { sql: parts.join(joinWord), params: allParams };
  logAbac("SQL_GROUP_RESULT", "Filter group SQL translation completed", { groupLogic: group.logic, fragment });
  return fragment;
}
