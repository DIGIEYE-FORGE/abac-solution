import type { AttributeOperator, ConditionValue } from "../types";
import { logAbac } from "./logger";
import { timeToMinutes } from "./functions";

export function looseEquals(a: unknown, b: unknown): boolean {
  logAbac("OPERATOR_LOOSE_EQUALS_START", "Running loose equality comparison", { a, b });
  if (a === b) {
    logAbac("OPERATOR_LOOSE_EQUALS_RESULT", "Loose equality comparison returned true by reference", { a, b });
    return true;
  }
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

export function compareOrdered(
  left: unknown,
  right: unknown,
  op: "greater_than" | "less_than" | "greater_than_or_equal" | "less_than_or_equal",
): boolean {
  logAbac("OPERATOR_COMPARE_ORDERED_START", "Running ordered comparison", { left, right, op });
  const numL = Number(left);
  const numR = Number(right);
  if (!isNaN(numL) && !isNaN(numR)) {
    const result = orderedOp(numL, numR, op);
    logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as number", { left, right, op, numL, numR, result });
    return result;
  }

  const dateL = new Date(String(left)).getTime();
  const dateR = new Date(String(right)).getTime();
  if (!isNaN(dateL) && !isNaN(dateR)) {
    const result = orderedOp(dateL, dateR, op);
    logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as date", { left, right, op, dateL, dateR, result });
    return result;
  }

  const result = orderedOp(String(left), String(right), op);
  logAbac("OPERATOR_COMPARE_ORDERED_RESULT", "Ordered comparison completed as string", { left, right, op, result });
  return result;
}

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
      const has = Array.isArray(left)
        ? left.some((item) => looseEquals(item, right))
        : typeof left === "string" && typeof right === "string" && left.includes(right);
      result = operator === "contains" ? has : !has;
      logAbac("OPERATOR_CONTAINS_RESULT", "Contains/not-contains comparison completed", { operator, left, right, has, result });
      break;
    }

    case "in":
    case "not_in": {
      const found = Array.isArray(right) && right.some((item) => looseEquals(left, item));
      result = operator === "in" ? found : !found;
      logAbac("OPERATOR_IN_RESULT", "In/not-in comparison completed", { operator, left, right, found, result });
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
      if (typeof left !== "string" || typeof right !== "string") {
        result = false;
      } else {
        try { result = new RegExp(right).test(left); } catch { result = false; }
      }
      logAbac("OPERATOR_REGEX_RESULT", "Regex comparison completed", { left, right, result });
      break;

    case "between": {
      if (typeof left !== "string" || typeof right !== "string") {
        result = false;
      } else {
        const dashIdx = right.indexOf("-", 3);
        if (dashIdx === -1) {
          result = false;
        } else {
          const start = right.slice(0, dashIdx);
          const end = right.slice(dashIdx + 1);
          const cur = timeToMinutes(left);
          result = cur >= timeToMinutes(start) && cur <= timeToMinutes(end);
          logAbac("OPERATOR_BETWEEN_VALUES", "Between comparison parsed range", { left, right, start, end, cur });
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

