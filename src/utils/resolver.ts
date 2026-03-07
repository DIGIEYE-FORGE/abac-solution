import type { ConditionValue, EvaluationContext, EnvironmentResolver } from "../types";
import { CONTEXT_VAR_RE } from "../config/constants";

export function isContextVariable(value: unknown): boolean {
  return typeof value === "string" && CONTEXT_VAR_RE.test(value.trim());
}

function resolveSingle(
  raw: string,
  context: EvaluationContext,
  resolverMap: Map<string, EnvironmentResolver>,
): ConditionValue {
  const trimmed = raw.trim();
  if (!CONTEXT_VAR_RE.test(trimmed)) return raw;

  const path = trimmed.slice(1, -1);
  const isEnvAlias = path.startsWith("env.");
  const resolverKey = isEnvAlias ? path.slice(4) : path;
  const resolver = resolverMap.get(resolverKey);
  if (resolver?.resolve) return resolver.resolve();

  if (isEnvAlias) {
    const envBucket = context.environment;
    if (envBucket && typeof envBucket === "object") {
      const resolved = (envBucket as Record<string, unknown>)[resolverKey];
      if (resolved !== undefined) {
        if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") return resolved;
        if (Array.isArray(resolved)) return resolved as string[];
      }
    }
    return raw;
  }

  const dotIdx = path.indexOf(".");
  if (dotIdx === -1) return raw;

  const prefix = path.substring(0, dotIdx);
  const rest = path.substring(dotIdx + 1);
  if ((prefix !== "subject" && prefix !== "environment") || !rest) return raw;

  const bucket = context[prefix];
  if (!bucket || typeof bucket !== "object") return raw;

  const resolved = (bucket as Record<string, unknown>)[rest];
  if (resolved === undefined) return raw;

  if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
    return resolved;
  }
  if (Array.isArray(resolved)) return resolved as string[];

  return raw;
}

export function resolveValue(
  raw: ConditionValue,
  context: EvaluationContext,
  resolverMap: Map<string, EnvironmentResolver>,
): ConditionValue {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      const resolved = resolveSingle(item, context, resolverMap);
      return typeof resolved === "string" ? resolved : String(resolved);
    });
  }
  if (typeof raw !== "string") return raw;
  return resolveSingle(raw, context, resolverMap);
}
