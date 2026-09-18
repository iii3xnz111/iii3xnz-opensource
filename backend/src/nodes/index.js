import fetch from "node-fetch";
import ivm from "isolated-vm";
import dns from "dns/promises";
import net from "net";
import { makeIntegrationHandlers } from "./integrations.js";

// Every node handler receives (nodeConfig, input, context) and returns an output value.
// `input` is the output of the upstream node (or the trigger payload for trigger nodes).
// `context` carries shared workflow variables across the run.

export function resolveTemplate(str, input, vars) {
  if (typeof str !== "string") return str;
  return str.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expr) => {
    const path = expr.trim().split(".");
    let root = path[0] === "input" ? input : path[0] === "vars" ? vars : undefined;
    let val = root;
    for (const key of path.slice(1)) {
      if (val == null) break;
      val = val[key];
    }
    return val === undefined ? "" : val;
  });
}

// Blocks requests to localhost, private/link-local IP ranges, and the common
// cloud metadata address — the standard SSRF targets an attacker would aim a
// "call any URL" node at to reach your internal network from your own server.
function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
    if (a === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === "::1") return true; // loopback
    if (norm.startsWith("fe80:")) return true; // link-local
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // unique local
    return false;
  }
  return true; // couldn't parse — fail closed
}

async function assertUrlIsSafe(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Requests to localhost are not allowed");
  }
  // Resolve DNS ourselves and check the actual IP — checking the hostname
  // string alone doesn't stop "evil.com" that resolves to 127.0.0.1.
  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true })).map((r) => r.address);
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new Error("Requests to internal/private network addresses are not allowed");
    }
  }
  return parsed.toString();
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Reusable sandbox runner — accepts a map of variable name -> value to
// expose inside the isolate. Used by both the `code` node (exposes `input`
// and `vars`) and the `loop` node (additionally exposes `item` per iteration).
export async function runSandboxedCode(code, exposedVars) {
  const isolate = new ivm.Isolate({ memoryLimit: 32 }); // MB — hard cap
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("global", jail.derefInto());

    const declarations = [];
    for (const [name, value] of Object.entries(exposedVars)) {
      const internalName = `__${name}`;
      await jail.set(internalName, new ivm.ExternalCopy(value ?? null).copyInto());
      declarations.push(`const ${name} = ${internalName};`);
    }

    const wrapped = `
      (function() {
        "use strict";
        ${declarations.join("\n")}
        ${code || "return input;"}
      })()
    `;
    const script = await isolate.compileScript(wrapped);
    return await script.run(context, { timeout: 2000, copy: true }); // 2s hard timeout
  } finally {
    isolate.dispose(); // always tear down, even on error
  }
}

export const nodeHandlers = {
  manualTrigger: async (config, input) => input || {},

  webhookTrigger: async (config, input) => input || {},

  scheduleTrigger: async (config, input) => input || { triggeredAt: new Date().toISOString() },

  httpRequest: async (config, input, ctx) => {
    const rawUrl = resolveTemplate(config.url, input, ctx.vars);
    const url = await assertUrlIsSafe(rawUrl);
    const method = (config.method || "GET").toUpperCase();
    const headers = {};
    (config.headers || []).forEach((h) => {
      headers[h.key] = resolveTemplate(h.value, input, ctx.vars);
    });
    let body;
    if (config.body && method !== "GET") {
      const rendered = resolveTemplate(config.body, input, ctx.vars);
      body = rendered;
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    const res = await fetchWithTimeout(url, { method, headers, body, redirect: "manual" }, 10000);
    // redirect: "manual" is deliberate — auto-following redirects could hop
    // from an allowed public URL to a blocked internal one, bypassing the check above.
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      throw new Error("HTTP node does not follow redirects (blocked for security) — point the URL at the final destination directly");
    }
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, ok: res.ok, data };
  },


  ifCondition: async (config, input, ctx) => {
    const left = resolveTemplate(config.left, input, ctx.vars);
    const right = resolveTemplate(config.right, input, ctx.vars);
    let result;
    switch (config.operator || "equals") {
      case "equals": result = String(left) === String(right); break;
      case "notEquals": result = String(left) !== String(right); break;
      case "contains": result = String(left).includes(String(right)); break;
      case "greaterThan": result = Number(left) > Number(right); break;
      case "lessThan": result = Number(left) < Number(right); break;
      default: result = false;
    }
    return { ...input, __branch: result ? "true" : "false" };
  },

  setVariable: async (config, input, ctx) => {
    const value = resolveTemplate(config.value, input, ctx.vars);
    ctx.vars[config.name] = value;
    return input;
  },

  delay: async (config, input) => {
    const ms = Math.min(Number(config.ms) || 1000, 30000); // capped for safety on shared infra
    await new Promise((r) => setTimeout(r, ms));
    return input;
  },

  code: async (config, input, ctx) => {
    return runSandboxedCode(config.code, { input: input ?? {}, vars: ctx.vars ?? {} });
  },

  // Postgres: a fresh client per call, closed immediately after — simpler
  // and safer than pooling across unrelated workflow runs, at some
  // connection-overhead cost that's fine for typical automation volumes.
  // Uses parameterized queries ($1, $2...) exclusively — the query template
  // itself isn't {{}}-resolved, only the params array is, which is what
  // actually prevents SQL injection here.
  postgresQuery: async (config, input, ctx) => {
    if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
    const connectionString = config.connectionString; // secret
    const query = config.query;
    if (!connectionString || !query) throw new Error("Connection string and query are required");

    let params = [];
    if (config.paramsJson) {
      try {
        params = JSON.parse(resolveTemplate(config.paramsJson, input, ctx.vars));
      } catch {
        throw new Error('Params must be a JSON array, e.g. ["{{input.id}}", "{{input.name}}"]');
      }
      if (!Array.isArray(params)) throw new Error("Params must be a JSON array");
    }

    const { Client } = await import("pg");
    const client = new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 15000 });
    try {
      await client.connect();
      const result = await client.query(query, params);
      return { rows: result.rows, rowCount: result.rowCount };
    } finally {
      await client.end().catch(() => {}); // always release the connection, even on error
    }
  },

  ...makeIntegrationHandlers(resolveTemplate),
};
