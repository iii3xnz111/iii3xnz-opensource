const SELF_HOSTED = process.env.SELF_HOSTED === "true";

export const PLAN_LIMITS = SELF_HOSTED ? {
  free: { maxWorkflows: Number.MAX_SAFE_INTEGER, maxExecutions: Number.MAX_SAFE_INTEGER, executionWindow: "month", maxNodesPerWorkflow: Number.MAX_SAFE_INTEGER },
  starter: { maxWorkflows: Number.MAX_SAFE_INTEGER, maxExecutions: Number.MAX_SAFE_INTEGER, executionWindow: "month", maxNodesPerWorkflow: Number.MAX_SAFE_INTEGER },
  pro: { maxWorkflows: Number.MAX_SAFE_INTEGER, maxExecutions: Number.MAX_SAFE_INTEGER, executionWindow: "month", maxNodesPerWorkflow: Number.MAX_SAFE_INTEGER },
} : {
  free: { maxWorkflows: 3, maxExecutions: 250, executionWindow: "day", maxNodesPerWorkflow: 15 },
  starter: { maxWorkflows: 25, maxExecutions: 20000, executionWindow: "month", maxNodesPerWorkflow: 60 },
  pro: { maxWorkflows: 9999, maxExecutions: 150000, executionWindow: "month", maxNodesPerWorkflow: 200 },
};

export const PLAN_ENTITLEMENTS = SELF_HOSTED ? {
  free: { collaboration: true, sharedWorkspaces: true, invitations: true, advancedRoles: true, workflowPermissions: true, auditLog: true, advancedSecurity: true, managedHosting: false, managedBackups: false, prioritySupport: false },
  starter: { collaboration: true, sharedWorkspaces: true, invitations: true, advancedRoles: true, workflowPermissions: true, auditLog: true, advancedSecurity: true, managedHosting: false, managedBackups: false, prioritySupport: false },
  pro: { collaboration: true, sharedWorkspaces: true, invitations: true, advancedRoles: true, workflowPermissions: true, auditLog: true, advancedSecurity: true, managedHosting: false, managedBackups: false, prioritySupport: false },
} : {
  free: {
    collaboration: false,
    sharedWorkspaces: false,
    invitations: false,
    advancedRoles: false,
    workflowPermissions: false,
    auditLog: false,
    advancedSecurity: false,
    managedHosting: false,
    managedBackups: false,
    prioritySupport: false,
  },
  starter: {
    collaboration: true,
    sharedWorkspaces: true,
    invitations: true,
    advancedRoles: false,
    workflowPermissions: false,
    auditLog: false,
    advancedSecurity: false,
    managedHosting: true,
    managedBackups: false,
    prioritySupport: false,
  },
  pro: {
    collaboration: true,
    sharedWorkspaces: true,
    invitations: true,
    advancedRoles: true,
    workflowPermissions: true,
    auditLog: true,
    advancedSecurity: true,
    managedHosting: true,
    managedBackups: true,
    prioritySupport: true,
  },
};

export function getPlan(plan) {
  return PLAN_LIMITS[plan] ? plan : "free";
}

export function hasPlanFeature(plan, feature) {
  return Boolean(PLAN_ENTITLEMENTS[getPlan(plan)]?.[feature]);
}

export const PLAN_NODE_TYPES = SELF_HOSTED ? {
  free: new Set(),
  starter: new Set(),
  pro: new Set(),
} : {
  free: new Set([
    "manualTrigger", "webhookTrigger", "scheduleTrigger", "httpRequest",
    "slackMessage", "discordMessage", "emailSend", "ifCondition",
    "setVariable", "filter",
  ]),
  starter: new Set([
    "manualTrigger", "webhookTrigger", "scheduleTrigger", "httpRequest",
    "slackMessage", "discordMessage", "emailSend", "gmailSendEmail",
    "microsoftTeamsMessage", "airtableCreateRecord", "googleSheetsAppendRow",
    "googleDriveCreateFile", "telegramMessage", "twilioSms", "notionCreatePage",
    "trelloCreateCard", "githubCreateIssue", "gitlabCreateIssue", "hubspotCreateContact",
    "mailchimpAddSubscriber", "googleCalendarCreateEvent", "twilioWhatsapp",
    "asanaCreateTask", "clickUpCreateTask", "ifCondition", "setVariable",
    "filter", "delay",
  ]),
  pro: new Set([
    "manualTrigger", "webhookTrigger", "scheduleTrigger", "httpRequest",
    "slackMessage", "discordMessage", "emailSend", "gmailSendEmail",
    "microsoftTeamsMessage", "airtableCreateRecord", "googleSheetsAppendRow",
    "googleDriveCreateFile", "telegramMessage", "twilioSms", "notionCreatePage",
    "trelloCreateCard", "githubCreateIssue", "gitlabCreateIssue", "hubspotCreateContact",
    "mailchimpAddSubscriber", "googleCalendarCreateEvent", "twilioWhatsapp",
    "asanaCreateTask", "clickUpCreateTask", "jiraCreateIssue", "linearCreateIssue",
    "openaiGenerateText", "postgresQuery", "shopifyCreateCustomer",
    "stripeCreateCustomer", "ifCondition", "setVariable", "delay", "filter",
    "code", "loop", "merge", "executeWorkflow",
  ]),
};

export function validatePlanNodes(plan, definition) {
  if (SELF_HOSTED) return null;
  const normalizedPlan = getPlan(plan);
  const limits = PLAN_LIMITS[normalizedPlan];
  const allowed = PLAN_NODE_TYPES[normalizedPlan] || PLAN_NODE_TYPES.free;
  if (definition.nodes.length > limits.maxNodesPerWorkflow) {
    return `This plan supports up to ${limits.maxNodesPerWorkflow} nodes per workflow. Upgrade for larger workflows.`;
  }
  const unavailable = [...new Set(definition.nodes.map((node) => node.type).filter((type) => !allowed.has(type)))];
  if (unavailable.length > 0) {
    return `${normalizedPlan === "free" ? "Free" : normalizedPlan[0].toUpperCase() + normalizedPlan.slice(1)} plan does not include: ${unavailable.join(", ")}. Upgrade to use these nodes.`;
  }
  return null;
}