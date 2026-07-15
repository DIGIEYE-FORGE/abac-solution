import type { ConditionValue, EvaluationContext, EnvironmentResolver } from "../types";
import { CONTEXT_VAR_RE } from "../config/constants";
import { logAbac } from "./logger";

/**
 * Detects policy placeholders such as {subject.userId} or {env.currentHHMM}.
 * The UI and evaluator both need this to distinguish literal strings from dynamic context references.
 */
export function isContextVariable(value: unknown): boolean {
  const result = typeof value === "string" && CONTEXT_VAR_RE.test(value.trim());
  logAbac("RESOLVER_IS_CONTEXT_VARIABLE", "Checked context variable pattern", { value, result });
  return result;
}

/**
 * Resolves one string policy value against the current evaluation context.
 * This exists so literal values, environment aliases, and subject/resource references all share one safe lookup path.
 */
function resolveSingle(
  raw: string,
  context: EvaluationContext,
  resolverMap: Map<string, EnvironmentResolver>,
): ConditionValue {
  const trimmed = raw.trim();
  logAbac("RESOLVER_SINGLE_START", "Resolving single condition value", { raw, trimmed });
  // Plain strings are valid policy values and should not be treated as missing context.
  if (!CONTEXT_VAR_RE.test(trimmed)) {
    logAbac("RESOLVER_SINGLE_LITERAL", "Condition value is not a context variable", { raw });
    return raw;
  }

  const path = trimmed.slice(1, -1);
  const isEnvAlias = path.startsWith("env.");
  const resolverKey = isEnvAlias ? path.slice(4) : path;
  const resolver = resolverMap.get(resolverKey);
  // Resolver functions win because they can compute request-time values such as the current clock time.
  if (resolver?.resolve) {
    const resolved = resolver.resolve();
    logAbac("RESOLVER_SINGLE_RESOLVER", "Condition value resolved by environment resolver", {
      path,
      resolverKey,
      resolved,
    });
    return resolved;
  }

  // {env.x} is an alias for environment values passed by the service, useful when no resolver function exists.
  if (isEnvAlias) {
    const envBucket = context.environment;
    if (envBucket && typeof envBucket === "object") {
      const resolved = (envBucket as Record<string, unknown>)[resolverKey];
      if (resolved !== undefined) {
        logAbac("RESOLVER_SINGLE_ENV_BUCKET", "Condition value resolved from environment context", {
          resolverKey,
          resolved,
        });
        if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") return resolved;
        if (Array.isArray(resolved)) return resolved as string[];
      }
    }
    logAbac("RESOLVER_SINGLE_UNRESOLVED", "Condition value could not be resolved from environment context", {
      resolverKey,
      raw,
    });
    return raw;
  }

  const dotIdx = path.indexOf(".");
  // Non-alias variables must include a bucket prefix, otherwise we cannot resolve them safely.
  if (dotIdx === -1) {
    logAbac("RESOLVER_SINGLE_INVALID_PATH", "Condition value has invalid context path", { path, raw });
    return raw;
  }

  const prefix = path.substring(0, dotIdx);
  const rest = path.substring(dotIdx + 1);
  // Only known context buckets are allowed so policy values cannot read arbitrary objects.
  if ((prefix !== "subject" && prefix !== "environment" && prefix !== "resource") || !rest) {
    logAbac("RESOLVER_SINGLE_INVALID_PREFIX", "Condition value has invalid context prefix", { prefix, rest, raw });
    return raw;
  }

  const bucket = prefix === "resource"
    ? (context as any).resource
    : context[prefix as "subject" | "environment"];
  if (!bucket || typeof bucket !== "object") {
    logAbac("RESOLVER_SINGLE_MISSING_BUCKET", "Condition value context bucket is missing", { prefix, rest });
    return raw;
  }

  const resolved = (bucket as Record<string, unknown>)[rest];
  if (resolved === undefined) {
    logAbac("RESOLVER_SINGLE_MISSING_VALUE", "Condition value context value is missing", { prefix, rest });
    return raw;
  }

  logAbac("RESOLVER_SINGLE_CONTEXT", "Condition value resolved from context", { prefix, rest, resolved });
  if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
    return resolved;
  }
  if (Array.isArray(resolved)) return resolved as string[];

  return raw;
}

/**
 * Resolves any condition value before operator comparison.
 * Arrays are resolved item-by-item so IN/NOT IN can include dynamic context variables as well as literals.
 */
export function resolveValue(
  raw: ConditionValue,
  context: EvaluationContext,
  resolverMap: Map<string, EnvironmentResolver>,
): ConditionValue {
  logAbac("RESOLVER_VALUE_START", "Resolving condition value", { raw });
  let resolved: ConditionValue;
  // IN/NOT IN values can be arrays, so resolve each element while preserving the array contract.
  if (Array.isArray(raw)) {
    resolved = raw.map((item) => {
      const resolvedItem = resolveSingle(item, context, resolverMap);
      return typeof resolvedItem === "string" ? resolvedItem : String(resolvedItem);
    });
  } else if (typeof raw !== "string") {
    resolved = raw;
  } else {
    resolved = resolveSingle(raw, context, resolverMap);
  }
  logAbac("RESOLVER_VALUE_RESULT", "Condition value resolution completed", { raw, resolved });
  return resolved;
}