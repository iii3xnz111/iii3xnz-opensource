import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY = "a".repeat(64); // valid 32-byte hex key for this test file
const { encrypt, decrypt } = await import("../crypto.js");

test("encrypt/decrypt round-trips correctly", () => {
  const secret = JSON.stringify({ apiKey: "sk_live_super_secret_12345" });
  const encrypted = encrypt(secret);
  assert.equal(decrypt(encrypted), secret);
});

test("ciphertext contains no trace of the plaintext secret", () => {
  const encrypted = encrypt("super_secret_value");
  assert.ok(!encrypted.includes("super_secret_value"));
});

test("a tampered ciphertext fails to decrypt instead of returning garbage", () => {
  const encrypted = encrypt("some secret");
  const tampered = encrypted.slice(0, -2) + "00";
  assert.throws(() => decrypt(tampered));
});

test("encrypt() refuses to run without ENCRYPTION_KEY set", async () => {
  const original = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  // Re-import isn't needed — getKey() reads process.env at call time, not import time.
  assert.throws(() => encrypt("x"), /ENCRYPTION_KEY is not set/);
  process.env.ENCRYPTION_KEY = original;
});

test("encrypt() rejects a malformed (wrong-length) key", () => {
  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "tooshort";
  assert.throws(() => encrypt("x"), /64-character hex string/);
  process.env.ENCRYPTION_KEY = original;
});
