import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  isBlockedIp, resolveSafeHost, assertSafeUrl, assertSafeHostPort, safeFetch,
  safePgConfig, safeSmtpOptions, privateTargetsAllowed, UnsafeTargetError,
} from "../net/safeNetwork.js";
import { nodeHandlers } from "../nodes/index.js";

const ctx = { vars: {}, getCredential: async () => ({}) };

test("isBlockedIp: IPv4 private, loopback, link-local, CGNAT, metadata", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("isBlockedIp: IPv6 loopback, ULA, link-local, mapped, NAT64, 6to4, metadata", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "ff02::1", "not-an-ip"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("resolveSafeHost blocks names that resolve to private IPs (DNS rebinding style)", async () => {
  const lookup = async () => [{ address: "10.0.0.7", family: 4 }];
  await assert.rejects(() => resolveSafeHost("evil.example", { allowPrivate: false, lookup }), /internal\/private network/);
});

test("resolveSafeHost blocks when ANY record is private", async () => {
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }];
  await assert.rejects(() => resolveSafeHost("mixed.example", { allowPrivate: false, lookup }), UnsafeTargetError);
});

test("resolveSafeHost returns the validated address to pin", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const r = await resolveSafeHost("ok.example", { allowPrivate: false, lookup });
  assert.equal(r.address, "93.184.216.34");
});

test("assertSafeUrl rejects localhost names, embedded credentials and non-http schemes", async () => {
  await assert.rejects(() => assertSafeUrl("http://localhost:8080", { allowPrivate: false }), /localhost/);
  await assert.rejects(() => assertSafeUrl("http://foo.localhost/", { allowPrivate: false }), /localhost/);
  await assert.rejects(() => assertSafeUrl("http://user:pw@8.8.8.8/", { allowPrivate: false }), /credentials/);
  await assert.rejects(() => assertSafeUrl("file:///etc/passwd", { allowPrivate: false }), /Only http/);
  await assert.rejects(() => assertSafeUrl("http://[::ffff:127.0.0.1]/", { allowPrivate: false }), /internal\/private network/);
});

test("private targets only allowed when SELF_HOSTED=true AND ALLOW_PRIVATE_NETWORK_TARGETS=true", () => {
  assert.equal(privateTargetsAllowed({}), false);
  assert.equal(privateTargetsAllowed({ ALLOW_PRIVATE_NETWORK_TARGETS: "true" }), false);
  assert.equal(privateTargetsAllowed({ SELF_HOSTED: "true" }), false);
  assert.equal(privateTargetsAllowed({ SELF_HOSTED: "true", ALLOW_PRIVATE_NETWORK_TARGETS: "true" }), true);
});

test("safeFetch: allowPrivate lets a local server through; redirect to private host is re-validated", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/redir") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
    res.writeHead(200, { "content-type": "text/plain" }); res.end("hello");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Blocked by default
    await assert.rejects(() => safeFetch(`${base}/ok`, { allowPrivate: false }), /internal\/private network/);
    assert.equal(hits, 0);
    // Allowed with explicit opt-in
    const res = await safeFetch(`${base}/ok`, { allowPrivate: true });
    assert.equal(await res.text(), "hello");
    // With private allowed for the first hop, the redirect target is metadata. Use a per-hop check:
    // allowPrivate=true permits 169.254.x too, so verify the default-deny path with a public-looking first hop instead.
    await assert.rejects(() => safeFetch(`${base}/loop`, { allowPrivate: true, maxRedirects: 2 }), /Too many redirects/);
    await assert.rejects(() => safeFetch(`${base}/redir`, { allowPrivate: true, maxRedirects: 0 }), /Redirects are not followed/);
  } finally {
    server.close();
  }
});

test("safeFetch: redirect from an allowed host to a private address is blocked at the second hop", async () => {
  // Test hook `isBlocked`: treat only 10.x / metadata as blocked so a loopback server can play "the public host".
  const isBlocked = (ip) => ip.startsWith("10.") || ip.startsWith("169.254.");
  const server = http.createServer((req, res) => {
    res.writeHead(302, { location: "http://10.0.0.5/admin" });
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(
      () => safeFetch(`http://127.0.0.1:${server.address().port}/`, { allowPrivate: false, isBlocked }),
      /internal\/private network/
    );
  } finally {
    server.close();
  }
});

test("safeFetch pins DNS: the socket connects to the validated address, not a fresh lookup", async () => {
  const server = http.createServer((req, res) => { res.end(req.headers.host); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const isBlocked = () => false;
  // "rebind.example" does not exist in real DNS; only the injected lookup knows it. If the socket did its
  // own lookup the request would fail with ENOTFOUND.
  const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  try {
    const res = await safeFetch(`http://rebind.example:${server.address().port}/`, { allowPrivate: false, lookup, isBlocked });
    assert.equal(await res.text(), `rebind.example:${server.address().port}`);
  } finally {
    server.close();
  }
});

test("SMTP: emailSend rejects private and metadata hosts", async () => {
  for (const smtpHost of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "localhost"]) {
    await assert.rejects(
      () => nodeHandlers.emailSend({ smtpHost, smtpPort: 25, smtpUser: "u", smtpPass: "p", to: "a@b.c" }, {}, ctx),
      /internal\/private network|localhost/,
      smtpHost
    );
  }
  await assert.rejects(() => safeSmtpOptions("127.0.0.1", 25, { allowPrivate: false }), /internal\/private network/);
});

test("Postgres: postgresQuery rejects private and metadata hosts", async () => {
  for (const cs of ["postgres://u:p@127.0.0.1:5432/db", "postgres://u:p@10.1.1.1/db", "postgres://u:p@169.254.169.254/db", "postgres://u:p@localhost/db", "postgres://u:p@[::1]/db"]) {
    await assert.rejects(
      () => nodeHandlers.postgresQuery({ connectionString: cs, query: "select 1" }, {}, ctx),
      /internal\/private network|localhost/,
      cs
    );
  }
  await assert.rejects(() => safePgConfig("mysql://u:p@8.8.8.8/db", { allowPrivate: false }), /Only postgres/);
});

test("safePgConfig pins the address and keeps SNI on the original hostname", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const cfg = await safePgConfig("postgres://u:p%40ss@db.example.com:6543/app?sslmode=require", { allowPrivate: false, lookup });
  assert.equal(cfg.host, "93.184.216.34");
  assert.equal(cfg.port, 6543);
  assert.equal(cfg.password, "p@ss");
  assert.equal(cfg.ssl.servername, "db.example.com");
});

test("assertSafeHostPort validates port range", async () => {
  await assert.rejects(() => assertSafeHostPort("8.8.8.8", 70000), /Invalid port/);
  await assert.rejects(() => assertSafeHostPort("8.8.8.8", 0), /Invalid port/);
});
