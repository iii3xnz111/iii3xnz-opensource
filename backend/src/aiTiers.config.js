// iii3xnz Enterprise License (see LICENSE_EE.md). Copyright (c) [COPYRIGHT HOLDER NAME: fill in]. All rights reserved.
// SINGLE place that decides which AI nodes belong to which cloud plan.
// Only used when SELF_HOSTED is not "true" -- self-hosted installs have every node unlocked.
// This is a PROPOSAL for the hosted cloud plans; change it here and nowhere else.
// "enterprise" is a placeholder: plan.js has no enterprise plan yet, so it is not enforced.
export const AI_NODE_TIERS = {
  free: [],
  starter: ["llmChain", "splitText", "embedText"],
  pro: ["llmChain", "aiAgent", "splitText", "embedText", "vectorUpsert", "vectorSearch", "ragAnswer"],
  enterprise: ["llmChain", "aiAgent", "splitText", "embedText", "vectorUpsert", "vectorSearch", "ragAnswer"], // placeholder, not wired to any plan
};
