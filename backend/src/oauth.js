import crypto from "crypto";
import fetch from "node-fetch";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || "http://localhost:4000/api/oauth/callback";

const PROVIDERS = {
  google: {
    label: "Google",
    authMode: "OAuth 2.0",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
    usePkce: true,
    tokenAuth: "body",
  },
  slack: {
    label: "Slack",
    authMode: "OAuth 2.0",
    clientIdEnv: "SLACK_OAUTH_CLIENT_ID",
    clientSecretEnv: "SLACK_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    userInfoUrl: "https://slack.com/api/auth.test",
    scopes: ["chat:write", "team:read"],
    usePkce: true,
    tokenAuth: "body",
  },
  github: {
    label: "GitHub",
    authMode: "OAuth 2.0",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email", "repo"],
    usePkce: true,
    tokenAuth: "body",
  },
  microsoft: {
    label: "Microsoft",
    authMode: "OAuth 2.0",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    scopes: ["openid", "profile", "email", "User.Read"],
    usePkce: true,
    tokenAuth: "body",
  },
  hubspot: {
    label: "HubSpot",
    authMode: "OAuth 2.0",
    clientIdEnv: "HUBSPOT_OAUTH_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    userInfoUrl: null,
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write"],
    usePkce: false,
    tokenAuth: "body",
  },
};

export function getOAuthProvider(provider) {
  return PROVIDERS[provider] || null;
}

export function listOAuthProviders() {
  return Object.entries(PROVIDERS).map(([id, definition]) => ({
    id,
    label: definition.label,
    authMode: definition.authMode,
    configured: Boolean(process.env[definition.clientIdEnv] && process.env[definition.clientSecretEnv]),
  }));
}

export function getConfiguredProvider(provider) {
  const definition = getOAuthProvider(provider);
  if (!definition) throw new Error("Unsupported OAuth provider");
  const clientId = process.env[definition.clientIdEnv];
  const clientSecret = process.env[definition.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error(`${definition.label} OAuth configuration required`);
  if (!/^https:\/\//.test(CALLBACK_URL) && process.env.NODE_ENV === "production") {
    throw new Error("OAuth callback must use HTTPS in production");
  }
  return { ...definition, clientId, clientSecret, redirectUri: CALLBACK_URL };
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashOAuthState(state) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

export function buildAuthorizationUrl(provider, state, challenge) {
  const definition = getConfiguredProvider(provider);
  const url = new URL(definition.authorizationUrl);
  url.searchParams.set("client_id", definition.clientId);
  url.searchParams.set("redirect_uri", definition.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", definition.scopes.join(" "));
  if (definition.usePkce) {
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (provider === "google") url.searchParams.set("access_type", "offline");
  if (provider === "hubspot") url.searchParams.set("optional_scope", "");
  return url.toString();
}

export async function exchangeOAuthCode(provider, code, verifier) {
  const definition = getConfiguredProvider(provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: definition.clientId,
    client_secret: definition.clientSecret,
    code,
    redirect_uri: definition.redirectUri,
  });
  if (definition.usePkce) body.set("code_verifier", verifier);
  const response = await fetch(definition.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeout: 15000,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || !data.access_token) throw new Error(`${definition.label} OAuth token exchange failed`);
  return data;
}

export async function fetchOAuthIdentity(provider, accessToken) {
  const definition = getConfiguredProvider(provider);
  const identityUrl = provider === "hubspot"
    ? `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`
    : definition.userInfoUrl;
  if (!identityUrl) return { id: crypto.createHash("sha256").update(accessToken).digest("hex").slice(0, 32), label: definition.label };
  const response = await fetch(identityUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "iii3xnz" },
    timeout: 10000,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`${definition.label} OAuth identity lookup failed`);
  return {
    id: String(data.sub || data.id || data.user_id || data.team_id || data.hub_id || "unknown"),
    label: data.email || data.login || data.name || data.user || data.team || data.hub_domain || definition.label,
  };
}

export function oauthCallbackUrl() {
  return CALLBACK_URL;
}

export function frontendOAuthResultUrl(status, provider) {
  const url = new URL("/credentials", APP_URL);
  url.searchParams.set("oauth", status);
  url.searchParams.set("provider", provider);
  return url.toString();
}
