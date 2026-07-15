import type { AttributeOperator, ConditionValue } from "../types";
import { logAbac } from "./logger";
import { parseTimeToMinutes } from "./functions";

/**
 * Compares policy operands with ABAC-friendly coercion.
 * We need this because DB values, request values, and UI-entered policy values may arrive as different primitive types.
 */
export function looseEquals(a: unknown, b: unknown): boolean {
  logAbac("OPERATOR_LOOSE_EQUALS_START", "Running loose equality comparison", { a, b });
  // Fast path preserves exact boolean/string/object-reference equality before trying coercion.
  if (a === b) {
    logAbac("OPERATOR_LOOSE_EQUALS_RESULT", "Loose equality comparison returned true by reference", { a, b });
    return true;
  }
  // Numeric strings should match stored numbers, for example clearanceLevel "3" against 3.
  if (typeof a === "number" || typeof b === "number") {
    const numA = Number(a);
    const numB = Number(b);
    const result = !isNaN(numA) && !isNaN(numB) && numA === numB;
    logAbac("OPERATOR_LOOSE_EQUALS_RESULT", "Loose equality comparison returned numeric result", { a, b, numA, numB, result });
    if (result) return true;
  }
  const result = String(a) === String(b);
  logAbac("OPERATOR_LOOSE_EQUALS_RESULT", "Loose equality comparison returned string result", { a, b, result });
  return result;
}

/**
 * Applies the simple ordered operator after values have already been normalized.
 * Keeping this small helper separate lets numbers, dates, times, and strings share one comparison table.
 */
export function orderedOp(a: number | string, b: number | string, op: string): boolean {
  logAbac("OPERATOR_ORDERED_START", "Running ordered operator comparison", { a, b, op });
  let result = false;
  switch (op) {
    case "equals": result = a === b; break;
    case "not_equals": result = a !== b; break;
    case "greater_than": result = a > b; break;
    case "less_than": result = a < b; break;
    case "greater_than_or_equal": result = a >= b; break;
    case "less_than_or_equal": result = a <= b; break;
    default: result = false; break;
  }
  logAbac("OPERATOR_ORDERED_RESULT", "Ordered operator comparison completed", { a, b, op, result });
  return result;
}

/**
 * Normalizes ordered comparisons across numbers, HH:MM times, dates, and finally strings.
 * Policies use one set of operators, but resource attributes can be stored in different formats.
 */
export function compareOrdered(
  left: unknown,
  right: unknown,
  op: "greater_than" | "less_than" | "greater_than_or_equal" | "less_than_or_equal",
): boolean {
  logAbac("OPERATOR_COMPARE_ORDERED_START", "Running ordered comparison", { left, right, op });
  const numL = Number(left);
  const numR = Number(right);
  // Prefer numeric ordering when both sides can be parsed as numbers.
  if (!isNaN(numL) && !isNaN(numR)) {
    const result = orderedOp(numL, numR, op);
    logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as number", { left, right, op, numL, numR, result });
    return result;
  }

  const timeL = typeof left === "string" ? parseTimeToMinutes(left) : null;
  const timeR = typeof right === "string" ? parseTimeToMinutes(right) : null;
  // Time policies compare minutes from midnight so 16:00 and 04:00 PM behave the same.
  if (timeL !== null && timeR !== null) {
    const result = orderedOp(timeL, timeR, op);
    logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as time", { left, right, op, timeL, timeR, result });
    return result;
  }

  const dateL = new Date(String(left)).getTime();
  const dateR = new Date(String(right)).getTime();
  // Date strings are compared by epoch milliseconds when numeric/time parsing did not apply.
  if (!isNaN(dateL) && !isNaN(dateR)) {
    const result = orderedOp(dateL, dateR, op);
    logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as date", { left, right, op, dateL, dateR, result });
    return result;
  }

  const result = orderedOp(String(left), String(right), op);
  logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as string", { left, right, op, result });
  return result;
}

/**
 * Main operator dispatcher used by direct evaluation and filter planning.
 * Every ABAC condition passes through here so operators behave identically for allow and deny policies.
 */
export function compare(
  left: unknown,
  right: ConditionValue,
  operator: AttributeOperator,
): boolean {
  logAbac("OPERATOR_COMPARE_START", "Running ABAC operator comparison", { left, right, operator });
  let result = false;
  switch (operator) {
    case "equals":
      result = looseEquals(left, right);
      break;
    case "not_equals":
      result = !looseEquals(left, right);
      break;

    case "contains":
    case "not_contains": {
      // Arrays model multi-valued attributes; strings model substring checks.
      // Supporting both keeps resource and subject attributes flexible without custom operators.
      const has = Array.isArray(left)
        ? left.some((item) => looseEquals(item, right))
        : typeof left === "string" && typeof right === "string" && left.includes(right);
      result = operator === "contains" ? has : !has;
      logAbac("OPERATOR_CONTAINS_RESULT", "Contains/not-contains comparison completed", { operator, left, right, has, result });
      break;
    }

    case "in":
    case "not_in": {
      // IN accepts either a stored array from the UI or a single fallback value.
      // This is why tenantId IN [a,b] can work even though tenantId itself is a string attribute.
      const values = Array.isArray(right) ? right : [right];
      const found = values.some((item) => looseEquals(left, item));
      result = operator === "in" ? found : !found;
      logAbac("OPERATOR_IN_RESULT", "In/not-in comparison completed", { operator, left, right, values, found, result });
      break;
    }

    case "greater_than":
    case "less_than":
    case "greater_than_or_equal":
    case "less_than_or_equal":
      result = compareOrdered(left, right, operator);
      break;

    case "starts_with":
      result = typeof left === "string" && typeof right === "string" && left.startsWith(right);
      logAbac("OPERATOR_STRING_RESULT", "Starts-with comparison completed", { left, right, result });
      break;
    case "ends_with":
      result = typeof left === "string" && typeof right === "string" && left.endsWith(right);
      logAbac("OPERATOR_STRING_RESULT", "Ends-with comparison completed", { left, right, result });
      break;

    case "regex":
      // Regex is optional and must fail closed on malformed expressions so a bad pattern cannot crash evaluation.
      if (typeof left !== "string" || typeof right !== "string") {
        result = false;
      } else {
        try { result = new RegExp(right).test(left); } catch { result = false; }
      }
      logAbac("OPERATOR_REGEX_RESULT", "Regex comparison completed", { left, right, result });
      break;

    case "between": {
      // Between is currently a time-window operator. It also supports overnight ranges such as 22:00-06:00.
      if (typeof left !== "string" || typeof right !== "string") {
        result = false;
      } else {
        const dashIdx = right.indexOf("-", 3);
        if (dashIdx === -1) {
          result = false;
        } else {
          const start = right.slice(0, dashIdx);
          const end = right.slice(dashIdx + 1);
          const cur = parseTimeToMinutes(left);
          const startMinutes = parseTimeToMinutes(start);
          const endMinutes = parseTimeToMinutes(end);
          result = cur !== null && startMinutes !== null && endMinutes !== null
            ? startMinutes <= endMinutes
              ? cur >= startMinutes && cur <= endMinutes
              : cur >= startMinutes || cur <= endMinutes
            : false;
          logAbac("OPERATOR_BETWEEN_VALUES", "Between comparison parsed range", { left, right, start, end, cur, startMinutes, endMinutes });
        }
      }
      logAbac("OPERATOR_BETWEEN_RESULT", "Between comparison completed", { left, right, result });
      break;
    }

    default:
      result = false;
      break;
  }

  logAbac("OPERATOR_COMPARE_RESULT", "ABAC operator comparison completed", { left, right, operator, result });
  return result;
}