import { v4 as uuid } from "uuid";
import db from "./db/index.js";

export async function recordAudit(userId, action, resourceType, resourceId = null, metadata = {}, workspaceId = null) {
  const resolvedWorkspaceId = workspaceId || metadata.workspaceId || (resourceType === "workspace" ? resourceId : null);
  await db.prepare(
    "INSERT INTO audit_logs (id, user_id, workspace_id, action, resource_type, resource_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(uuid(), userId, resolvedWorkspaceId, action, resourceType, resourceId, JSON.stringify(metadata));
}