export function extractSessionToken(payload, label = "Session") {
  if (!payload || typeof payload !== "object") {
    throw new Error(`${label} returned an invalid session. Please try again.`);
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    throw new Error(payload.error);
  }

  const token = payload.token ?? payload.accessToken ?? payload.jwt;
  if (typeof token === "string" && token.trim()) {
    return token;
  }

  throw new Error(`${label} returned an invalid session. Please try again.`);
}

export async function ensureJsonResponse(res, label = "API") {
  const contentType = res?.headers?.get?.("content-type") || "";
  if (contentType && !/application\/json/i.test(contentType)) {
    throw new Error(`${label} returned an unexpected response. Please try again.`);
  }

  try {
    const data = await res.json();
    if (!data || typeof data !== "object") {
      throw new Error(`${label} returned an unexpected response. Please try again.`);
    }
    return data;
  } catch {
    throw new Error(`${label} returned an unexpected response. Please try again.`);
  }
}
