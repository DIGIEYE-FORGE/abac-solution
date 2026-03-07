import type { AttributeOperator, ConditionValue } from "../types";

export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" || typeof b === "number") {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA === numB;
  }
  return String(a) === String(b);
}

export function orderedOp(a: number | string, b: number | string, op: string): boolean {
  switch (op) {
    case "equals": return a === b;
    case "not_equals": return a !== b;
    case "greater_than": return a > b;
    case "less_than": return a < b;
    case "greater_than_or_equal": return a >= b;
    case "less_than_or_equal": return a <= b;
    default: return false;
  }
}

export function compareOrdered(
  left: unknown,
  right: unknown,
  op: "greater_than" | "less_than" | "greater_than_or_equal" | "less_than_or_equal",
): boolean {
  const numL = Number(left);
  const numR = Number(right);
  if (!isNaN(numL) && !isNaN(numR)) return orderedOp(numL, numR, op);

  const dateL = new Date(String(left)).getTime();
  const dateR = new Date(String(right)).getTime();
  if (!isNaN(dateL) && !isNaN(dateR)) return orderedOp(dateL, dateR, op);

  return orderedOp(String(left), String(right), op);
}

export function compare(
  left: unknown,
  right: ConditionValue,
  operator: AttributeOperator,
): boolean {
  switch (operator) {
    case "equals":
      return looseEquals(left, right);
    case "not_equals":
      return !looseEquals(left, right);

    case "contains":
    case "not_contains": {
      const has = Array.isArray(left)
        ? left.some((item) => looseEquals(item, right))
        : typeof left === "string" && typeof right === "string" && left.includes(right);
      return operator === "contains" ? has : !has;
    }

    case "in":
    case "not_in": {
      const found = Array.isArray(right) && right.some((item) => looseEquals(left, item));
      return operator === "in" ? found : !found;
    }

    case "greater_than":
    case "less_than":
    case "greater_than_or_equal":
    case "less_than_or_equal":
      return compareOrdered(left, right, operator);

    case "starts_with":
      return typeof left === "string" && typeof right === "string" && left.startsWith(right);
    case "ends_with":
      return typeof left === "string" && typeof right === "string" && left.endsWith(right);

    case "regex":
      if (typeof left !== "string" || typeof right !== "string") return false;
      try { return new RegExp(right).test(left); } catch { return false; }

    default:
      return false;
  }
}

