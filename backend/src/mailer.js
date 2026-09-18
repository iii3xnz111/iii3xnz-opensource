import nodemailer from "nodemailer";

// Platform transactional email (OTP codes, password reset, workspace invites).
// Documented and wired through APP_SMTP_* in .env.example, docker-compose, and
// the README. If SMTP isn't configured, optionally send via Brevo; otherwise
// print to the console so local/dev still works.

export function getMailerMode() {
  if (process.env.APP_SMTP_HOST) return "smtp";
  if (process.env.BREVO_API_KEY) return "brevo";
  return "dev";
}

export function logMailerModeOnStartup() {
  const mode = getMailerMode();
  if (mode === "smtp") {
    console.log(`[MAILER] Running in SMTP mode (${process.env.APP_SMTP_HOST})`);
  } else if (mode === "brevo") {
    console.log("[MAILER] Running in Brevo API mode");
  } else {
    console.log(
      "\n==================================================\n" +
      "[MAILER] No email provider configured — DEV MODE.\n" +
      "OTP codes and other emails will print to this log\n" +
      "instead of being sent. Set APP_SMTP_HOST or\n" +
      "BREVO_API_KEY in your .env to send real email.\n" +
      "=================================================="
    );
  }
}

function fromAddress() {
  return process.env.APP_SMTP_FROM || process.env.APP_SMTP_USER || "noreply@localhost";
}

async function sendViaSmtp({ to, subject, text }) {
  const port = Number(process.env.APP_SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: process.env.APP_SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.APP_SMTP_USER
      ? { user: process.env.APP_SMTP_USER, pass: process.env.APP_SMTP_PASS }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
  return transporter.sendMail({ from: fromAddress(), to, subject, text });
}

async function sendViaBrevo({ to, subject, text }) {
  const senderEmail = fromAddress();
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "iii3xnz", email: senderEmail },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
  }
  return response.json();
}

export async function sendTransactionalEmail({ to, subject, text }) {
  const mode = getMailerMode();
  if (mode === "smtp") return sendViaSmtp({ to, subject, text });
  if (mode === "brevo") return sendViaBrevo({ to, subject, text });

  console.log(
    "\n==================================================\n" +
    "[DEV MODE] No email provider configured.\n" +
    `To: ${to}\n` +
    `Subject: ${subject}\n` +
    `${text}\n` +
    "Configure APP_SMTP_HOST or BREVO_API_KEY to send real emails.\n" +
    "=================================================="
  );
  return { devMode: true };
}