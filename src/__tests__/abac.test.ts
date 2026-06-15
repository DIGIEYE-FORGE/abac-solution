import test from "node:test";
import assert from "node:assert/strict";
import { ABAC } from "../abac";
import { NEVER_MATCH } from "../utils/ast-builder";
import { excludeToSqlParts, toSql } from "../utils/sql-translator";
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

test("null resource values do not match deny conditions", () => {
  const abac = new ABAC({ defaultEffect: "allow" });
  const decision = abac.can({
    policies: [
      policy({
        id: "deny-not-group",
        effect: "deny",
        conditions: [{ id: "c1", category: "resource", attribute: { key: "groupId", value: "group-1", operator: "not_equals" } }],
      }),
    ],
    action: "read",
    resource: "devices",
    subject: { userId: "u1" },
    resourceContext: { groupId: null },
  });

  assert.equal(decision.allowed, true);
});

test("deny SQL keeps null values visible unless explicitly denied", () => {
  const fragment = excludeToSqlParts({
    type: "condition",
    field: "groupId",
    operator: "not_equals",
    value: "group-1",
    sqlCapable: true,
    queryCost: "low",
    indexSafe: true,
  })[0];

  assert.equal(fragment.sql, "\"groupId\" IS NULL OR NOT (\"groupId\" != $1)");
  assert.deepEqual(fragment.params, ["group-1"]);
});

test("multiple deny policies are negated independently", () => {
  const parts = excludeToSqlParts({
    type: "group",
    logic: "AND",
    conditions: [
      {
        type: "condition",
        field: "status",
        operator: "equals",
        value: "OFFLINE",
        sqlCapable: true,
        queryCost: "low",
        indexSafe: true,
      },
      {
        type: "condition",
        field: "groupId",
        operator: "equals",
        value: "group-1",
        sqlCapable: true,
        queryCost: "low",
        indexSafe: true,
      },
    ],
  });

  assert.equal(parts.length, 2);
  assert.equal(parts[0].sql, "\"status\" IS NULL OR NOT (\"status\" = $1)");
  assert.equal(parts[1].sql, "\"groupId\" IS NULL OR NOT (\"groupId\" = $2)");
});

test("toSql still supports include filters", () => {
  const fragment = toSql({
    type: "condition",
    field: "deviceId",
    operator: "equals",
    value: "device-1",
    sqlCapable: true,
    queryCost: "low",
    indexSafe: true,
  });

  assert.equal(fragment.sql, "\"deviceId\" = $1");
  assert.deepEqual(fragment.params, ["device-1"]);
});

test("partial evaluation normalizes deviceID alias to deviceId", () => {
  const abac = new ABAC({ defaultEffect: "allow" });
  const result = abac.partialEvaluate(
    [
      policy({
        id: "allow-device",
        effect: "allow",
        conditions: [{ id: "c1", category: "resource", attribute: { key: "deviceID", value: "device-1", operator: "equals" } }],
      }),
    ],
    { subject: { userId: "u1" }, action: "read", environment: {} },
    "devices",
  );

  assert.ok(result.includeFilter);
  assert.equal(result.includeFilter?.type, "group");
  assert.equal((result.includeFilter as any).conditions[0].type, "condition");
  assert.equal((result.includeFilter as any).conditions[0].field, "deviceId");
});
