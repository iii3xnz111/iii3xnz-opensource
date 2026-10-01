# Files covered by the iii3xnz Enterprise License

Covered files are marked in place (header comment) and listed here. Nothing was moved, so imports, tests and the Docker build behave exactly as before. There is no license-key enforcement.

| File | Why |
|---|---|
| backend/src/routes/billing.js | Billing |
| backend/src/routes/dodoWebhook.js | Billing |
| backend/src/dodoPolicy.js | Billing |
| backend/src/plan.js | Tier gating |
| backend/src/aiTiers.config.js | Tier placement of AI nodes |
| backend/src/audit.js | Paid governance: audit log |

Not marked (see DECISIONS.md): backend/src/workspace.js mixes free collaboration code with role checks; advanced-role entitlements are defined in plan.js (marked). No managed-backup code exists in this repository yet, so there is nothing to mark. planContract.js does not exist in this repository.
