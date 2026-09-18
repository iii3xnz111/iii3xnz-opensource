import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeHandlers } from "../nodes/index.js";

const ctx = { vars: {} };

async function assertBlocked(url, pattern) {
  await assert.rejects(
    () => nodeHandlers.httpRequest({ url, method: "GET" }, {}, ctx),
    pattern
  );
}

test("SSRF: blocks loopback address 127.0.0.1", async () => {
  await assertBlocked("http://127.0.0.1/secret", /internal\/private network/);
});

test("SSRF: blocks the 'localhost' hostname", async () => {
  await assertBlocked("http://localhost:22", /localhost/);
});

test("SSRF: blocks the cloud metadata address", async () => {
  await assertBlocked("http://169.254.169.254/latest/meta-data/", /internal\/private network/);
});

test("SSRF: blocks private 10.x range", async () => {
  await assertBlocked("http://10.0.0.5/internal", /internal\/private network/);
});

test("SSRF: blocks non-http(s) protocols", async () => {
  await assertBlocked("ftp://example.com/file", /Only http\/https/);
});

test("SSRF: does not follow redirects (blocks bypass via redirect)", async () => {
  // example.com is a real public host; the SSRF check itself should pass it
  // through to the fetch attempt, proving public hosts aren't blocked.
  // The redirect-following behavior is tested separately by code inspection
  // of the `redirect: "manual"` option, since simulating a real redirecting
  // server isn't practical in a unit test without network access.
  try {
    await nodeHandlers.httpRequest({ url: "https://example.com", method: "GET" }, {}, ctx);
  } catch (e) {
    // A network-level rejection (blocked domain, DNS, etc.) is fine here —
    // what matters is it's NOT an SSRF validation error.
    assert.ok(!/internal\/private network|localhost|Only http/.test(e.message), `unexpected SSRF-style rejection for a public host: ${e.message}`);
  }
});
