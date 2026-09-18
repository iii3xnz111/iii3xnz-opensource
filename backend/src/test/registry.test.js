import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const frontendRegistry = fs.readFileSync(path.join(repositoryRoot, "frontend/src/nodeRegistry.js"), "utf8");
const configPanel = fs.readFileSync(path.join(repositoryRoot, "frontend/src/components/NodeConfigPanel.jsx"), "utf8");
const handlers = fs.readFileSync(path.join(repositoryRoot, "backend/src/nodes/integrations.js"), "utf8");
const engine = fs.readFileSync(path.join(repositoryRoot, "backend/src/nodes/index.js"), "utf8");

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("every registered node has a configuration surface and executable handler", () => {
  const registered = matches(frontendRegistry, /^  (\w+): \{$/gm);
  const configured = new Set(matches(configPanel, /node\.type === "(\w+)"/g));
  const integrationHandlers = new Set(matches(handlers, /^    (\w+): async/gm));
  const coreHandlers = new Set([
    "manualTrigger", "webhookTrigger", "scheduleTrigger", "httpRequest",
    "ifCondition", "setVariable", "delay", "code", "loop", "merge",
    "executeWorkflow", "filter", "postgresQuery",
  ]);
  const executable = new Set([...integrationHandlers, ...coreHandlers]);

  assert.ok(registered.length > 0, "node registry must not be empty");
  assert.deepEqual(registered.filter((type) => !configured.has(type)), [], "registered nodes missing configuration UI");
  assert.deepEqual(registered.filter((type) => !executable.has(type)), [], "registered nodes missing executable handlers");
});