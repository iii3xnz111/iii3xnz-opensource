import { nodeHandlers, runSandboxedCode, resolveTemplate } from "../nodes/index.js";

const MAX_SUBWORKFLOW_DEPTH = 5; // prevents A-calls-B-calls-A infinite recursion
const FILTER_STOPPED = Symbol("filter-stopped"); // sentinel: branch ends cleanly, not an error
const MERGE_WAITING = Symbol("merge-waiting");

export function validateWorkflowGraph(definition) {
  if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    throw new Error("Workflow definition must contain nodes and edges arrays");
  }
  const ids = new Set();
  for (const node of definition.nodes) {
    if (!node?.id || typeof node.id !== "string") throw new Error("Every workflow node needs a string id");
    if (ids.has(node.id)) throw new Error(`Duplicate workflow node id: ${node.id}`);
    ids.add(node.id);
  }
  const outgoing = new Map(definition.nodes.map((node) => [node.id, []]));
  for (const edge of definition.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error("Workflow edge references an unknown node");
    outgoing.get(edge.source).push(edge.target);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("Workflow graph contains a cycle; use the Loop node for iteration");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of outgoing.get(id)) visit(target);
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of definition.nodes) visit(node.id);
}

/**
 * definition = { nodes: [{id, type, data: {config}}], edges: [{source, target, sourceHandle}] }
 * Execution starts at the trigger node and walks forward through edges.
 * ifCondition nodes produce __branch: "true"|"false" and only edges whose
 * sourceHandle matches that branch are followed.
 *
 * `userId` scopes credential lookups so a workflow can only ever resolve
 * credentials owned by its own user. `_depth` is internal bookkeeping for
 * sub-workflow recursion — callers should never pass it.
 */
export async function executeWorkflow(definition, triggerPayload = {}, userId = null, _depth = 0, executionContext = null) {
  validateWorkflowGraph(definition);
  const { nodes, edges } = definition;
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const outgoing = {};
  const incoming = {};
  for (const e of edges) {
    (outgoing[e.source] ||= []).push(e);
    (incoming[e.target] ||= []).push(e.source);
  }

  const triggerNode = nodes.find((n) =>
    ["manualTrigger", "webhookTrigger", "scheduleTrigger"].includes(n.type)
  );
  if (!triggerNode) throw new Error("Workflow has no trigger node");

  const ctx = {
    vars: {},
    getCredential: async (credentialId) => {
      if (!userId) throw new Error("Credentials are unavailable in this context");
      const { resolveCredential } = await import("../routes/credentials.js");
      return resolveCredential(userId, credentialId, executionContext?.workspaceId || null);
    },
  };
  const log = [];
  const visited = new Set();

  async function runNode(nodeId, input, sourceId = null) {
    const node = nodeMap[nodeId];
    const persistedMerge = node.type === "merge" && executionContext?.runId;
    if (visited.has(nodeId) && !persistedMerge) return; // avoid duplicate non-merge execution
    if (!persistedMerge) visited.add(nodeId);
    const startedAt = Date.now();
    let output, error;

    try {
      if (node.type === "executeWorkflow") {
        output = await runSubWorkflow(node.data?.config || {}, input);
      } else if (node.type === "merge") {
        output = persistedMerge
          ? await runPersistedMerge(nodeId, node.data?.config || {}, input, sourceId, incoming[nodeId] || [])
          : runMerge(node.data?.config || {}, ctx);
      } else if (node.type === "loop") {
        output = await runLoop(node.data?.config || {}, input, ctx);
      } else if (node.type === "filter") {
        output = runFilter(node.data?.config || {}, input, ctx);
      } else {
        const handler = nodeHandlers[node.type];
        if (!handler) throw new Error(`Unknown node type: ${node.type}`);
        output = await handler(node.data?.config || {}, input, ctx);
      }
    } catch (err) {
      error = err.message;
    }

    if (output === MERGE_WAITING) return;

    // Filter stopping a branch is a normal, successful outcome — not a
    // failure. Log it as such and simply don't continue to downstream nodes.
    if (output === FILTER_STOPPED) {
      log.push({ nodeId, type: node.type, durationMs: Date.now() - startedAt, error: null, output: null, stopped: true });
      return;
    }

    log.push({
      nodeId,
      type: node.type,
      durationMs: Date.now() - startedAt,
      error: error || null,
      output: error ? null : output,
    });

    if (error) throw new Error(`Node "${node.type}" (${nodeId}) failed: ${error}`);

    const nextEdges = outgoing[nodeId] || [];
    const branchResults = await Promise.allSettled(nextEdges.map(async (edge) => {
      if (node.type === "ifCondition") {
        if (edge.sourceHandle && edge.sourceHandle !== output.__branch) return;
      }
      await runNode(edge.target, output, nodeId);
    }));
    const branchFailure = branchResults.find((result) => result.status === "rejected");
    if (branchFailure) throw branchFailure.reason;
    if (persistedMerge) await completePersistedMerge(nodeId);
  }

  // Sub-workflow node: recursively runs another workflow the user owns,
  // passing this node's input as that workflow's trigger payload, and
  // returning its final variable state as this node's output.
  async function runSubWorkflow(config, input) {
    if (_depth >= MAX_SUBWORKFLOW_DEPTH) {
      throw new Error(`Sub-workflow depth limit (${MAX_SUBWORKFLOW_DEPTH}) exceeded — check for a workflow calling itself indirectly`);
    }
    if (!userId) throw new Error("Sub-workflows are unavailable in this context");
    const targetId = config.workflowId;
    if (!targetId) throw new Error("No target workflow selected");

    const { default: db } = await import("../db/index.js");
    const row = await db.prepare("SELECT * FROM workflows WHERE id = ? AND workspace_id = ?").get(targetId, executionContext?.workspaceId);
    if (!row) throw new Error("Target workflow not found");

    const subDefinition = JSON.parse(row.definition);
    const result = await executeWorkflow(subDefinition, input, userId, _depth + 1, executionContext ? { ...executionContext, runId: `${executionContext.runId}:${targetId}`, workflowId: targetId } : null);
    return { vars: result.vars, log: result.log };
  }

  // Merge node: the engine only passes a single input from a single upstream
  // node, so a true multi-edge merge isn't structurally supported yet. The
  // practical workaround: earlier branches store their results into named
  // variables (via Set Variable nodes), and Merge combines those variables
  // into one object — this covers the common "wait for two branches, then
  // combine their results" case without requiring a bigger engine rewrite.
  function runMerge(config, ctx) {
    const keys = (config.variableNames || "").split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0) throw new Error("List at least one variable name to merge, e.g. \"branchA, branchB\"");
    const result = {};
    for (const key of keys) result[key] = ctx.vars[key];
    return result;
  }

  async function runPersistedMerge(nodeId, config, input, sourceId, incomingSources) {
    const { default: db } = await import("../db/index.js");
    const sourceIds = incomingSources.length ? incomingSources : (sourceId ? [sourceId] : []);
    const requiredSources = [...new Set(sourceIds.length ? sourceIds : ["__direct"])]
      .filter((source) => !(config.ignoreSources || []).includes(source));
    if (requiredSources.length === 0) throw new Error("Merge requires at least one incoming branch");
    const row = await db.transaction(async (tx) => {
      await tx.query("DELETE FROM merge_states WHERE expires_at < NOW() AND status <> 'running'");
      await tx.query(
        `INSERT INTO merge_states (execution_id, workflow_id, merge_node_id, required_sources, expires_at)
         VALUES (?, ?, ?, ?, NOW() + INTERVAL '15 minutes')
         ON CONFLICT (execution_id, merge_node_id) DO NOTHING`,
        [executionContext.runId, executionContext.workflowId, nodeId, JSON.stringify(requiredSources)]
      );
      const result = await tx.query("SELECT * FROM merge_states WHERE execution_id = ? AND merge_node_id = ? FOR UPDATE", [executionContext.runId, nodeId]);
      const state = result.rows[0];
      if (state.status === "completed") return null;
      if (state.status === "running") {
        const claimedAt = state.claimed_at ? Date.parse(state.claimed_at) : 0;
        if (claimedAt > Date.now() - 10 * 60 * 1000) return MERGE_WAITING;
        await tx.query("UPDATE merge_states SET status = 'ready', claimed_at = NULL WHERE execution_id = ? AND merge_node_id = ?", [executionContext.runId, nodeId]);
      }
      const completed = new Set(JSON.parse(state.completed_sources || "[]"));
      const outputs = JSON.parse(state.outputs || "{}");
      const source = sourceId || "__direct";
      if (requiredSources.includes(source)) {
        completed.add(source);
        outputs[source] = input;
      }
      const allReady = requiredSources.every((required) => completed.has(required));
      await tx.query(
        "UPDATE merge_states SET completed_sources = ?, outputs = ?, status = ? WHERE execution_id = ? AND merge_node_id = ?",
        [JSON.stringify([...completed]), JSON.stringify(outputs), allReady ? "ready" : "waiting", executionContext.runId, nodeId]
      );
      if (!allReady) return MERGE_WAITING;
      const claim = await tx.query(
        `UPDATE merge_states SET status = 'running', claimed_at = NOW()
         WHERE execution_id = ? AND merge_node_id = ? AND status = 'ready'
         RETURNING outputs`,
        [executionContext.runId, nodeId]
      );
      return claim.rows[0] ? JSON.parse(claim.rows[0].outputs) : MERGE_WAITING;
    });
    return row === null || row === MERGE_WAITING ? MERGE_WAITING : { ...row };
  }

  async function completePersistedMerge(nodeId) {
    const { default: db } = await import("../db/index.js");
    await db.prepare("UPDATE merge_states SET status = 'completed', completed_at = NOW() WHERE execution_id = ? AND merge_node_id = ? AND status = 'running'").run(executionContext.runId, nodeId);
  }

  // Loop node: maps a JS expression (sandboxed, same isolate as the Code
  // node) over each item of an array. This covers the majority of real
  // "for each item, transform it" needs without requiring the visual
  // builder to support looping back over a sub-chain of nodes.
  async function runLoop(config, input, ctx) {
    const path = (config.arrayPath || "input").split(".");
    let arr = path[0] === "input" ? input : ctx.vars;
    for (const key of path.slice(1)) arr = arr?.[key];
    if (!Array.isArray(arr)) throw new Error(`"${config.arrayPath}" is not an array`);

    const results = [];
    for (const item of arr) {
      const itemOutput = await runSandboxedCode(config.code || "return item;", {
        item,
        input,
        vars: ctx.vars ?? {},
      });
      results.push(itemOutput);
    }
    return results;
  }

  // Filter: stops this branch here if the condition is false, without
  // marking the run as failed — the practical difference from If/Else,
  // which always continues down one branch or the other. Same comparison
  // logic as the If/Else node, just applied to "continue or stop" instead
  // of "which way to go."
  function runFilter(config, input, ctx) {
    const left = resolveTemplate(config.left, input, ctx.vars);
    const right = resolveTemplate(config.right, input, ctx.vars);
    let passes;
    switch (config.operator || "equals") {
      case "equals": passes = String(left) === String(right); break;
      case "notEquals": passes = String(left) !== String(right); break;
      case "contains": passes = String(left).includes(String(right)); break;
      case "greaterThan": passes = Number(left) > Number(right); break;
      case "lessThan": passes = Number(left) < Number(right); break;
      default: passes = false;
    }
    return passes ? input : FILTER_STOPPED;
  }

  await runNode(triggerNode.id, triggerPayload);
  return { log, vars: ctx.vars };
}
