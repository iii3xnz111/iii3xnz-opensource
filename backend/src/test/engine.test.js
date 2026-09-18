import { test } from "node:test";
import assert from "node:assert/strict";
import { executeWorkflow, validateWorkflowGraph } from "../engine/executeWorkflow.js";

test("basic trigger -> setVariable execution", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "setVariable", data: { config: { name: "x", value: "hello-{{input.name}}" } } },
    ],
    edges: [{ source: "n1", target: "n2" }],
  };
  const result = await executeWorkflow(def, { name: "world" });
  assert.equal(result.vars.x, "hello-world");
  assert.equal(result.log.length, 2);
  assert.equal(result.log.every((l) => l.error === null), true);
});

test("ifCondition follows the correct branch", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "ifCondition", data: { config: { left: "{{input.x}}", operator: "equals", right: "1" } } },
      { id: "n3", type: "setVariable", data: { config: { name: "hitTrue", value: "yes" } } },
      { id: "n4", type: "setVariable", data: { config: { name: "hitFalse", value: "yes" } } },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3", sourceHandle: "true" },
      { source: "n2", target: "n4", sourceHandle: "false" },
    ],
  };
  const result = await executeWorkflow(def, { x: "1" });
  assert.equal(result.vars.hitTrue, "yes");
  assert.equal(result.vars.hitFalse, undefined);
});

test("loop node maps a JS expression over each array item", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "loop", data: { config: { arrayPath: "input.numbers", code: "return item * 2;" } } },
    ],
    edges: [{ source: "n1", target: "n2" }],
  };
  const result = await executeWorkflow(def, { numbers: [1, 2, 3] });
  const loopStep = result.log.find((l) => l.type === "loop");
  assert.deepEqual(loopStep.output, [2, 4, 6]);
});

test("merge node combines named variables from separate branches", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "setVariable", data: { config: { name: "a", value: "A" } } },
      { id: "n3", type: "setVariable", data: { config: { name: "b", value: "B" } } },
      { id: "n4", type: "merge", data: { config: { variableNames: "a, b" } } },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
      { source: "n3", target: "n4" },
    ],
  };
  const result = await executeWorkflow(def, {});
  const mergeStep = result.log.find((l) => l.type === "merge");
  assert.deepEqual(mergeStep.output, { a: "A", b: "B" });
});

test("in-process fan-in combines concurrent branch outputs", async () => {
  const def = {
    nodes: [
      { id: "trigger", type: "manualTrigger", data: { config: {} } },
      { id: "left", type: "setVariable", data: { config: { name: "left", value: "L" } } },
      { id: "right", type: "setVariable", data: { config: { name: "right", value: "R" } } },
      { id: "merge", type: "merge", data: { config: { variableNames: "left, right" } } },
    ],
    edges: [
      { source: "trigger", target: "left" },
      { source: "trigger", target: "right" },
      { source: "left", target: "merge" },
      { source: "right", target: "merge" },
    ],
  };
  const result = await executeWorkflow(def, {});
  const mergeStep = result.log.find((step) => step.type === "merge");
  assert.deepEqual(mergeStep.output, { left: "L", right: "R" });
  assert.equal(result.vars.right, "R");
});

test("filter stops a branch cleanly (success, not error) when condition fails", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "filter", data: { config: { left: "{{input.go}}", operator: "equals", right: "yes" } } },
      { id: "n3", type: "setVariable", data: { config: { name: "reached", value: "yes" } } },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
    ],
  };
  const result = await executeWorkflow(def, { go: "no" });
  assert.equal(result.vars.reached, undefined);
  const filterStep = result.log.find((l) => l.type === "filter");
  assert.equal(filterStep.stopped, true);
  assert.equal(filterStep.error, null); // stopping is not an error
});

test("filter passes the branch through when condition succeeds", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "filter", data: { config: { left: "{{input.go}}", operator: "equals", right: "yes" } } },
      { id: "n3", type: "setVariable", data: { config: { name: "reached", value: "yes" } } },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
    ],
  };
  const result = await executeWorkflow(def, { go: "yes" });
  assert.equal(result.vars.reached, "yes");
});

test("sandboxed code node cannot access the filesystem", async () => {
  const def = {
    nodes: [
      { id: "n1", type: "manualTrigger", data: { config: {} } },
      { id: "n2", type: "code", data: { config: { code: "return require('fs').readFileSync('/etc/passwd', 'utf8');" } } },
    ],
    edges: [{ source: "n1", target: "n2" }],
  };
  await assert.rejects(() => executeWorkflow(def, {}), /require is not defined/);
});

test("a workflow with no trigger node throws clearly", async () => {
  const def = { nodes: [{ id: "n1", type: "setVariable", data: { config: { name: "x", value: "y" } } }], edges: [] };
  await assert.rejects(() => executeWorkflow(def, {}), /no trigger node/);
});

test("workflow graph validation rejects cycles and dangling edges", () => {
  assert.throws(() => validateWorkflowGraph({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }],
  }), /contains a cycle/);
  assert.throws(() => validateWorkflowGraph({
    nodes: [{ id: "a" }],
    edges: [{ source: "a", target: "missing" }],
  }), /unknown node/);
});
