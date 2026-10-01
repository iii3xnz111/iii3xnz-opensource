import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimitTracker, resolveLimits, LimitExceededError, DEFAULT_LIMITS } from "../engine/limits.js";
import { executeWorkflow } from "../engine/executeWorkflow.js";

const trigger = { id: "t", type: "manualTrigger", data: { config: {} } };

test("resolveLimits: safe defaults, env override, invalid values ignored", () => {
  assert.deepEqual(resolveLimits({}, {}), { ...DEFAULT_LIMITS });
  assert.equal(resolveLimits({}, { EXECUTION_MAX_STEPS: "7" }).maxSteps, 7);
  assert.equal(resolveLimits({}, { EXECUTION_MAX_STEPS: "-3" }).maxSteps, DEFAULT_LIMITS.maxSteps);
  assert.equal(resolveLimits({}, { EXECUTION_MAX_STEPS: "abc" }).maxSteps, DEFAULT_LIMITS.maxSteps);
  assert.equal(resolveLimits({ maxSteps: 3 }, { EXECUTION_MAX_STEPS: "7" }).maxSteps, 3);
});

test("tracker: steps, LLM calls, tokens, loop iterations, output size and wall clock are all enforced", () => {
  const t = createLimitTracker({ maxSteps: 2, maxLlmCalls: 1, maxTokens: 10, maxLoopIterations: 2, maxOutputBytes: 20 });
  t.step(); t.step();
  assert.throws(() => t.step(), (e) => e instanceof LimitExceededError && e.limit === "maxSteps");
  t.llmCall();
  assert.throws(() => t.llmCall(), (e) => e.limit === "maxLlmCalls");
  t.addTokens(10);
  assert.throws(() => t.addTokens(1), (e) => e.limit === "maxTokens");
  t.loopIteration(); t.loopIteration();
  assert.throws(() => t.loopIteration(), (e) => e.limit === "maxLoopIterations");
  assert.throws(() => t.checkOutput("x".repeat(100)), (e) => e.limit === "maxOutputBytes");
  let clock = 0;
  const timed = createLimitTracker({ maxWallClockMs: 100 }, { now: () => clock });
  clock = 101;
  assert.throws(() => timed.step(), (e) => e.limit === "maxWallClockMs");
});

test("Loop node: huge array is refused up front (infinite/unbounded loop guard)", async () => {
  const def = {
    nodes: [
      trigger,
      { id: "seed", type: "code", data: { config: { code: "return Array.from({length: 5000}, (_, i) => i);" } } },
      { id: "loop", type: "loop", data: { config: { arrayPath: "input", code: "return item;" } } },
    ],
    edges: [{ source: "t", target: "seed" }, { source: "seed", target: "loop" }],
  };
  await assert.rejects(() => executeWorkflow(def, {}, null), (e) => e.name === "LimitExceededError" && e.limit === "maxLoopIterations");
});

test("Loop node: respects a custom, lower cap passed via execution context", async () => {
  const def = {
    nodes: [
      trigger,
      { id: "seed", type: "code", data: { config: { code: "return [1,2,3,4,5];" } } },
      { id: "loop", type: "loop", data: { config: { arrayPath: "input", code: "return item * 2;" } } },
    ],
    edges: [{ source: "t", target: "seed" }, { source: "seed", target: "loop" }],
  };
  await assert.rejects(() => executeWorkflow(def, {}, null, 0, { limits: { maxLoopIterations: 3 } }), /iteration limit/);
  const ok = await executeWorkflow(def, {}, null, 0, { limits: { maxLoopIterations: 5 } });
  assert.deepEqual(ok.log.find((l) => l.nodeId === "loop").output, [2, 4, 6, 8, 10]);
});

test("step limit stops a long chain and the limit shows up in the log", async () => {
  const nodes = [trigger];
  const edges = [];
  for (let i = 0; i < 10; i++) {
    nodes.push({ id: `n${i}`, type: "setVariable", data: { config: { name: `v${i}`, value: "x" } } });
    edges.push({ source: i === 0 ? "t" : `n${i - 1}`, target: `n${i}` });
  }
  await assert.rejects(() => executeWorkflow({ nodes, edges }, {}, null, 0, { limits: { maxSteps: 5 } }), /5-step limit/);
});

test("wall-clock limit aborts between nodes", async () => {
  const def = {
    nodes: [trigger, { id: "d", type: "delay", data: { config: { ms: 60 } } }, { id: "s", type: "setVariable", data: { config: { name: "a", value: "b" } } }],
    edges: [{ source: "t", target: "d" }, { source: "d", target: "s" }],
  };
  await assert.rejects(() => executeWorkflow(def, {}, null, 0, { limits: { maxWallClockMs: 20 } }), /wall-clock/);
});

test("oversized node output is rejected", async () => {
  const def = {
    nodes: [trigger, { id: "c", type: "code", data: { config: { code: "return 'x'.repeat(5000);" } } }],
    edges: [{ source: "t", target: "c" }],
  };
  await assert.rejects(() => executeWorkflow(def, {}, null, 0, { limits: { maxOutputBytes: 1000 } }), /byte limit/);
});
