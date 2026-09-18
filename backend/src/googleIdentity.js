import { OAuth2Client } from "google-auth-library";

const GOOGLE_CLIENT_ID_ENV = "GOOGLE_AUTH_CLIENT_ID";

export function googleAuthClientId() {
  return process.env[GOOGLE_CLIENT_ID_ENV] || "";
}

export async function verifyGoogleIdToken(idToken, verify = null) {
  const audience = googleAuthClientId();
  if (!audience) throw new Error("Google Sign-In is not configured");
  if (typeof idToken !== "string" || !idToken) throw new Error("Google credential is required");

  const client = new OAuth2Client(audience);
  const ticket = verify
    ? await verify(idToken, audience)
    : await client.verifyIdToken({ idToken, audience });
  const payload = ticket?.getPayload ? ticket.getPayload() : ticket;
  if (!payload) throw new Error("Invalid Google identity token");

  const issuer = payload.iss;
  if (issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") {
    throw new Error("Invalid Google token issuer");
  }
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Google token has no subject");
  if (!payload.email || typeof payload.email !== "string") throw new Error("Google token has no email");
  if (payload.email_verified !== true) throw new Error("Google email is not verified");
  if (payload.exp && Number(payload.exp) <= Math.floor(Date.now() / 1000)) throw new Error("Google identity token expired");

  return {
    subject: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : "",
  };
}

export { GOOGLE_CLIENT_ID_ENV };
