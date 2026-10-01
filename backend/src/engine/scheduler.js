import cron from "node-cron";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { withQueuedExecutionQuota } from "../routes/workflows.js";

let activeTasks = [];

export function stopSchedules() {
  activeTasks.forEach((task) => task.stop());
  activeTasks = [];
}

export async function enqueueScheduledWorkflow(workflow) {
  const user = await db.prepare("SELECT plan FROM users WHERE id = ?").get(workflow.user_id);
  return withQueuedExecutionQuota(workflow.user_id, user?.plan, async () => {
    const jobId = uuid();
    const payload = { triggeredAt: new Date().toISOString() };
    const slot = Math.floor(Date.now() / 60000);
    const dedupeKey = `schedule:${workflow.id}:${slot}`;
    const existing = await db.prepare("SELECT id FROM jobs WHERE dedupe_key = ?").get(dedupeKey);
    if (existing) return existing.id;
    await db.prepare(
      "INSERT INTO jobs (id, workflow_id, user_id, workspace_id, trigger_payload, status, execution_id, quota_reserved, dedupe_key) VALUES (?, ?, ?, ?, ?, 'pending', ?, 1, ?)"
    ).run(jobId, workflow.id, workflow.user_id, workflow.workspace_id, JSON.stringify(payload), jobId, dedupeKey);
    return jobId;
  }, workflow.workspace_id);
}

// Scheduled runs also go through the job queue rather than executing inline
// in the API server process — same reasoning as webhook triggers: there's no
// interactive caller waiting, so it belongs in the background worker.
export async function syncSchedules() {
  stopSchedules();

  const rows = await db.prepare("SELECT * FROM workflows WHERE active = 1").all();
  for (const wf of rows) {
    const definition = JSON.parse(wf.definition);
    const scheduleNode = definition.nodes.find((n) => n.type === "scheduleTrigger");
    if (!scheduleNode) continue;
    const expr = scheduleNode.data?.config?.cron;
    if (!expr || !cron.validate(expr)) continue;

    const task = cron.schedule(expr, () => enqueueScheduledWorkflow(wf));
    activeTasks.push(task);
  }
}
