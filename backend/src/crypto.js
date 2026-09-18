import crypto from "crypto";

// AES-256-GCM: authenticated encryption — protects confidentiality AND
// integrity (a tampered ciphertext fails to decrypt rather than silently
// producing garbage). This is what actually separates "encrypted at rest"
// from the sandbox/SSRF protections added earlier, which protect execution
// but do nothing for what's sitting in the database file itself.

function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" and set it as an env var before storing any credentials."
    );
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return key;
}

export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together, colon-separated as hex — all
  // three are required to decrypt, and none of them are secret on their own.
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(payload) {
  const key = getKey();
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  if (!ivHex || !authTagHex || !dataHex) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}
