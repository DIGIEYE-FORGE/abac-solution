import test from "node:test";
import assert from "node:assert/strict";
import { ABAC } from "../abac";
import { NEVER_MATCH } from "../utils/ast-builder";
import type { Policy } from "../types";

const basePolicy: Omit<Policy, "id" | "name" | "resources" | "actions" | "effect" | "conditions" | "conditionLogic"> = {
  priority: 100,
  isActive: true,
};

function policy(overrides: Partial<Policy>): Policy {
  return {
    id: overrides.id ?? "policy-1",
    name: overrides.name ?? "policy",
    resources: overrides.resources ?? ["devices"],
    actions: overrides.actions ?? ["read"],
    effect: overrides.effect ?? "allow",
    conditions: overrides.conditions ?? [],
    conditionLogic: overrides.conditionLogic ?? "AND",
    priority: overrides.priority ?? 100,
    isActive: overrides.isActive ?? true,
  };
}

test("partial evaluation returns null include filter for default allow with no allow policy", () => {
  const abac = new ABAC({ defaultEffect: "allow" });
  const result = abac.partialEvaluate(
    [policy({ id: "deny-offline", effect: "deny", conditions: [{ id: "c1", category: "resource", attribute: { key: "status", value: "OFFLINE", operator: "equals" } }] })],
    { subject: { userId: "u1" }, action: "read", environment: {} },
    "devices",
  );

  assert.equal(result.includeFilter, null);
  assert.equal(result.defaultEffect, "allow");
  assert.equal(result.requiresVerification, false);
});

test("partial evaluation returns NEVER_MATCH for default deny with no allow policy", () => {
  const abac = new ABAC({ defaultEffect: "deny" });
  const result = abac.partialEvaluate(
    [],
    { subject: { userId: "u1" }, action: "read", environment: {} },
    "devices",
  );

  assert.deepEqual(result.includeFilter, NEVER_MATCH);
  assert.equal(result.defaultEffect, "deny");
});

test("partial evaluation keeps deny policies independent from allow policies", () => {
  const abac = new ABAC({ defaultEffect: "allow" });
  const result = abac.partialEvaluate(
    [
      policy({
        id: "allow-online",
        effect: "allow",
        conditions: [{ id: "c1", category: "resource", attribute: { key: "status", value: "ONLINE", operator: "equals" } }],
      }),
      policy({
        id: "deny-critical",
        effect: "deny",
        conditions: [{ id: "c2", category: "resource", attribute: { key: "severity", value: "CRITICAL", operator: "equals" } }],
      }),
    ],
    { subject: { userId: "u1" }, action: "read", environment: {} },
    "devices",
  );

  assert.ok(result.includeFilter);
  assert.ok(result.excludeFilter);
  assert.equal(result.excludeFilter.type, "group");
  assert.equal(result.policyIds.length, 2);
});
