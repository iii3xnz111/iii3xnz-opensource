// Shared outbound-network safety layer. Every node that opens a connection to a
// user-influenced host (HTTP, SMTP, Postgres, LLM base URLs, vector DBs) must go
// through this module. It provides:
//   - IP classification (IPv4, IPv6, IPv4-mapped IPv6, NAT64, metadata ranges)
//   - DNS resolution with the validated IP pinned for the actual connection
//     (defeats DNS rebinding: the socket cannot re-resolve to a different IP)
//   - redirect following with re-validation of every hop
// Private targets can be enabled ONLY when SELF_HOSTED=true and
// ALLOW_PRIVATE_NETWORK_TARGETS=true (e.g. local Ollama, local databases).
import dns from "dns/promises";
import http from "http";
import https from "https";
import net from "net";
import fetch from "node-fetch";

export class UnsafeTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

export function privateTargetsAllowed(env = process.env) {
  return env.SELF_HOSTED === "true" && env.ALLOW_PRIVATE_NETWORK_TARGETS === "true";
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
}

const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function isBlockedV4(ip) {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(({ base, mask }) => ((n & mask) >>> 0) === ((base & mask) >>> 0));
}

// Expand an IPv6 literal into eight 16-bit groups. Returns null if unparseable.
function expandV6(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const v4tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    if (!net.isIPv4(v4tail[1])) return null;
    const n = ipv4ToInt(v4tail[1]);
    s = s.slice(0, -v4tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g, 16));
  return out.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? null : out;
}

function isBlockedV6(ip) {
  const g = expandV6(ip);
  if (!g) return true; // fail closed
  const embedV4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(embedV4(g[6], g[7]));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48 — judge by embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && g.slice(2, 6).every((x) => x === 0) ? isBlockedV4(embedV4(g[6], g[7])) : true;
  // 6to4 2002::/16 embeds an IPv4 address
  if (g[0] === 0x2002) return isBlockedV4(embedV4(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (includes fd00:ec2::254 metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return isBlockedV4(ip);
  if (net.isIPv6(ip)) return isBlockedV6(ip);
  return true;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);

/**
 * Validate a hostname and resolve it once. Returns { address, family } — the
 * caller MUST connect to that address (not re-resolve the name).
 */
export async function resolveSafeHost(hostname, { allowPrivate = privateTargetsAllowed(), lookup = dns.lookup, isBlocked = isBlockedIp } = {}) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new UnsafeTargetError("Host is required");
  if (!allowPrivate && (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal"))) {
    throw new UnsafeTargetError("Requests to localhost are not allowed");
  }
  const literal = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : null;
  const records = literal || (await lookup(host, { all: true }));
  if (!records.length) throw new UnsafeTargetError("Host did not resolve");
  if (!allowPrivate) {
    for (const r of records) {
      if (isBlocked(r.address)) {
        throw new UnsafeTargetError("Requests to internal/private network addresses are not allowed");
      }
    }
  }
  return { address: records[0].address, family: records[0].family, all: records };
}

/** Parse and validate a URL; returns { url, hostname, pinned }. */
export async function assertSafeUrl(rawUrl, opts = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new UnsafeTargetError("Only http/https URLs are allowed");
  if (parsed.username || parsed.password) throw new UnsafeTargetError("URLs with embedded credentials are not allowed");
  const pinned = await resolveSafeHost(parsed.hostname, opts);
  return { url: parsed, hostname: parsed.hostname, pinned };
}

/** Validate a host:port for non-HTTP protocols (SMTP, Postgres, vector DBs). */
export async function assertSafeHostPort(host, port, opts = {}) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new UnsafeTargetError("Invalid port");
  const pinned = await resolveSafeHost(host, opts);
  return { host: String(host), port: p, address: pinned.address, family: pinned.family };
}

// An agent whose DNS lookup is hard-wired to the already-validated address.
function pinnedAgent(url, pinned) {
  const lookup = (_hostname, options, cb) => {
    const done = typeof options === "function" ? options : cb;
    if (options && options.all) return done(null, [{ address: pinned.address, family: pinned.family }]);
    return done(null, pinned.address, pinned.family);
  };
  return url.protocol === "https:" ? new https.Agent({ lookup }) : new http.Agent({ lookup });
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * fetch() with SSRF protection: validates + pins DNS for the initial URL and
 * every redirect hop. Options: maxRedirects (default 3), timeoutMs (default 10000),
 * maxResponseBytes (enforced by the caller when reading the body via readBodyCapped).
 */
export async function safeFetch(rawUrl, options = {}) {
  const { maxRedirects = 3, timeoutMs = 10000, allowPrivate, lookup, isBlocked, ...init } = options;
  let current = rawUrl;
  let method = (init.method || "GET").toUpperCase();
  let body = init.body;
  let headers = { ...(init.headers || {}) };
  for (let hop = 0; ; hop++) {
    const { url, pinned } = await assertSafeUrl(current, { allowPrivate: allowPrivate ?? privateTargetsAllowed(), lookup, isBlocked });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url.toString(), { ...init, method, body, headers, redirect: "manual", agent: pinnedAgent(url, pinned), signal: controller.signal });
    } catch (err) {
      if (err.name === "AbortError") throw new Error(`Request timed out after ${timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!REDIRECT.has(res.status)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    if (hop >= maxRedirects) {
      throw new Error(maxRedirects === 0
        ? "Redirects are not followed for this request"
        : `Too many redirects (max ${maxRedirects})`);
    }
    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie|proxy-authorization)$/i.test(k)));
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
    current = next.toString();
  }
}

/** Read a fetch Response body, aborting once it exceeds maxBytes. */
export async function readBodyCapped(res, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) {
      res.body.destroy?.();
      throw new Error(`Response exceeded the ${maxBytes}-byte limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Build pg Client config with the validated IP pinned and TLS SNI/verification
 * still performed against the original hostname.
 */
export async function safePgConfig(connectionString, opts = {}) {
  let u;
  try {
    u = new URL(connectionString);
  } catch {
    throw new UnsafeTargetError("Invalid connection string");
  }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) throw new UnsafeTargetError("Only postgres:// connection strings are allowed");
  const host = u.hostname || "localhost";
  const port = Number(u.port) || 5432;
  const target = await assertSafeHostPort(host, port, opts);
  const sslmode = u.searchParams.get("sslmode");
  const useSsl = sslmode && sslmode !== "disable";
  return {
    host: target.address,
    port,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || undefined,
    ssl: useSsl ? { servername: net.isIP(host) ? undefined : host, rejectUnauthorized: sslmode !== "require" } : false,
  };
}

/** Build nodemailer transport options with the SMTP IP pinned. */
export async function safeSmtpOptions(host, port, opts = {}) {
  const target = await assertSafeHostPort(host, port, opts);
  return {
    host: target.address,
    port: target.port,
    secure: target.port === 465,
    tls: { servername: net.isIP(host) ? undefined : host },
  };
}
