// Per-execution resource limits. One tracker is created per top-level execution and
// shared with sub-workflows, so recursion and loops cannot escape the budget.
// Defaults are deliberately conservative; override with env vars (all integers).
export const DEFAULT_LIMITS = Object.freeze({
  maxSteps: 500,
  maxWallClockMs: 5 * 60 * 1000,
  maxLoopIterations: 1000,
  maxLlmCalls: 50,
  maxTokens: 200_000,
  maxOutputBytes: 5 * 1024 * 1024,
});

const ENV_MAP = {
  maxSteps: "EXECUTION_MAX_STEPS",
  maxWallClockMs: "EXECUTION_MAX_WALL_CLOCK_MS",
  maxLoopIterations: "EXECUTION_MAX_LOOP_ITERATIONS",
  maxLlmCalls: "EXECUTION_MAX_LLM_CALLS",
  maxTokens: "EXECUTION_MAX_TOKENS",
  maxOutputBytes: "EXECUTION_MAX_OUTPUT_BYTES",
};

export class LimitExceededError extends Error {
  constructor(limit, message) {
    super(message);
    this.name = "LimitExceededError";
    this.limit = limit;
  }
}

export function resolveLimits(overrides = {}, env = process.env) {
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    const fromEnv = Number(env[envName]);
    if (Number.isFinite(fromEnv) && fromEnv > 0) limits[key] = Math.floor(fromEnv);
    const fromOverride = Number(overrides[key]);
    if (Number.isFinite(fromOverride) && fromOverride > 0) limits[key] = Math.floor(fromOverride);
  }
  return limits;
}

export function createLimitTracker(overrides = {}, { now = () => Date.now(), env = process.env } = {}) {
  const limits = resolveLimits(overrides, env);
  const startedAt = now();
  const usage = { steps: 0, loopIterations: 0, llmCalls: 0, tokens: 0 };
  const checkTime = () => {
    if (now() - startedAt > limits.maxWallClockMs) {
      throw new LimitExceededError("maxWallClockMs", `Execution exceeded the ${limits.maxWallClockMs}ms wall-clock limit`);
    }
  };
  return {
    limits,
    usage,
    checkTime,
    step() {
      checkTime();
      if (++usage.steps > limits.maxSteps) throw new LimitExceededError("maxSteps", `Execution exceeded the ${limits.maxSteps}-step limit`);
    },
    loopIteration() {
      checkTime();
      if (++usage.loopIterations > limits.maxLoopIterations) {
        throw new LimitExceededError("maxLoopIterations", `Loop exceeded the ${limits.maxLoopIterations}-iteration limit`);
      }
    },
    loopPlan(count) {
      if (count > limits.maxLoopIterations - usage.loopIterations) {
        throw new LimitExceededError("maxLoopIterations", `Loop of ${count} items exceeds the ${limits.maxLoopIterations}-iteration limit`);
      }
    },
    llmCall() {
      checkTime();
      if (++usage.llmCalls > limits.maxLlmCalls) throw new LimitExceededError("maxLlmCalls", `Execution exceeded the ${limits.maxLlmCalls} LLM-call limit`);
    },
    addTokens(n) {
      usage.tokens += Math.max(0, Number(n) || 0);
      if (usage.tokens > limits.maxTokens) throw new LimitExceededError("maxTokens", `Execution exceeded the ${limits.maxTokens}-token limit`);
    },
    checkOutput(value) {
      let size = 0;
      try { size = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8"); } catch { size = 0; }
      if (size > limits.maxOutputBytes) throw new LimitExceededError("maxOutputBytes", `A node output exceeded the ${limits.maxOutputBytes}-byte limit`);
    },
  };
}
