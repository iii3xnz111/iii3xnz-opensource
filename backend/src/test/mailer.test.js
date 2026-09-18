import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getMailerMode, sendTransactionalEmail } from "../mailer.js";

const SMTP_ENV = ["APP_SMTP_HOST", "APP_SMTP_PORT", "APP_SMTP_USER", "APP_SMTP_PASS", "APP_SMTP_FROM", "BREVO_API_KEY"];
const saved = {};

beforeEach(() => {
  for (const key of SMTP_ENV) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  delete process.env.APP_SMTP_HOST;
  delete process.env.APP_SMTP_PORT;
  delete process.env.APP_SMTP_USER;
  delete process.env.APP_SMTP_PASS;
  delete process.env.APP_SMTP_FROM;
  delete process.env.BREVO_API_KEY;
});

test("dev mode prints when neither SMTP nor Brevo is configured", async () => {
  assert.equal(getMailerMode(), "dev");
  const result = await sendTransactionalEmail({
    to: "user@example.com",
    subject: "Test",
    text: "Hello",
  });
  assert.equal(result.devMode, true);
});

test("APP_SMTP_HOST selects SMTP instead of silently staying in dev mode", () => {
  process.env.APP_SMTP_HOST = "smtp.example.com";
  assert.equal(getMailerMode(), "smtp");
});

test("sendTransactionalEmail actually uses SMTP when APP_SMTP_HOST is set", async () => {
  process.env.APP_SMTP_HOST = "127.0.0.1";
  process.env.APP_SMTP_PORT = "1";
  process.env.APP_SMTP_USER = "user";
  process.env.APP_SMTP_PASS = "pass";
  process.env.APP_SMTP_FROM = "noreply@example.com";

  assert.equal(getMailerMode(), "smtp");
  await assert.rejects(
    () => sendTransactionalEmail({ to: "user@example.com", subject: "OTP", text: "code" }),
    (err) => {
      assert.ok(!/devMode/.test(String(err)));
      assert.ok(err);
      return true;
    }
  );
});
