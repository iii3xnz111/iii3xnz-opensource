import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_ENTITLEMENTS, PLAN_LIMITS, PLAN_NODE_TYPES, hasPlanFeature, validatePlanNodes } from "../plan.js";

test("canonical plan limits match the product model", () => {
  assert.deepEqual(PLAN_LIMITS, {
    free: { maxWorkflows: 3, maxExecutions: 250, executionWindow: "day", maxNodesPerWorkflow: 15 },
    starter: { maxWorkflows: 25, maxExecutions: 20000, executionWindow: "month", maxNodesPerWorkflow: 60 },
    pro: { maxWorkflows: 9999, maxExecutions: 150000, executionWindow: "month", maxNodesPerWorkflow: 200 },
  });
});

test("plan validation enforces node count and node access server-side", () => {
  const empty = { nodes: [], edges: [] };
  assert.equal(validatePlanNodes("free", empty), null);
  assert.match(validatePlanNodes("free", { nodes: [{ type: "gmailSendEmail" }], edges: [] }), /does not include/);
  assert.equal(validatePlanNodes("free", { nodes: Array.from({ length: 14 }, () => ({ type: "manualTrigger" })), edges: [] }), null);
  assert.equal(validatePlanNodes("free", { nodes: Array.from({ length: 15 }, () => ({ type: "manualTrigger" })), edges: [] }), null);
  assert.match(validatePlanNodes("free", { nodes: Array.from({ length: 16 }, () => ({ type: "manualTrigger" })) }), /up to 15 nodes/);
  assert.equal(validatePlanNodes("starter", { nodes: Array.from({ length: 60 }, () => ({ type: "manualTrigger" })), edges: [] }), null);
  assert.match(validatePlanNodes("starter", { nodes: Array.from({ length: 61 }, () => ({ type: "manualTrigger" })) }), /up to 60 nodes/);
  assert.equal(validatePlanNodes("pro", { nodes: Array.from({ length: 200 }, () => ({ type: "manualTrigger" })), edges: [] }), null);
  assert.match(validatePlanNodes("pro", { nodes: Array.from({ length: 201 }, () => ({ type: "manualTrigger" })) }), /up to 200 nodes/);
  assert.equal(validatePlanNodes("starter", { nodes: [{ type: "googleDriveCreateFile" }], edges: [] }), null);
  assert.equal(validatePlanNodes("pro", { nodes: [{ type: "executeWorkflow" }], edges: [] }), null);
});

test("pro includes every registered node while lower plans remain intentionally narrower", async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const registrySource = fs.readFileSync(path.join(repositoryRoot, "frontend/src/nodeRegistry.js"), "utf8");
  const registered = [...registrySource.matchAll(/^  (\w+): \{$/gm)].map((match) => match[1]);
  assert.deepEqual(registered.filter((type) => !PLAN_NODE_TYPES.pro.has(type)), []);
  assert.ok(PLAN_NODE_TYPES.free.size < PLAN_NODE_TYPES.starter.size);
  assert.ok(PLAN_NODE_TYPES.starter.size < PLAN_NODE_TYPES.pro.size);
});

test("paid plans inherit all lower-plan node access", () => {
  for (const type of PLAN_NODE_TYPES.free) {
    assert.equal(PLAN_NODE_TYPES.starter.has(type), true, `${type} missing from Starter`);
    assert.equal(PLAN_NODE_TYPES.pro.has(type), true, `${type} missing from Pro`);
  }
  for (const type of PLAN_NODE_TYPES.starter) {
    assert.equal(PLAN_NODE_TYPES.pro.has(type), true, `${type} missing from Pro`);
  }
});

test("plan entitlements match the collaboration and security contract", () => {
  assert.equal(hasPlanFeature("free", "sharedWorkspaces"), false);
  assert.equal(hasPlanFeature("starter", "invitations"), true);
  assert.equal(hasPlanFeature("starter", "workflowPermissions"), false);
  assert.equal(hasPlanFeature("pro", "workflowPermissions"), true);
  assert.equal(hasPlanFeature("pro", "auditLog"), true);
  assert.equal(PLAN_ENTITLEMENTS.free.managedBackups, false);
  assert.equal(PLAN_ENTITLEMENTS.pro.managedBackups, true);
});