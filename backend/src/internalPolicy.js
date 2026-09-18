export function internalQueueAuthError(configuredSecret, suppliedSecret) {
  if (!configuredSecret) return "missing";
  if (suppliedSecret !== configuredSecret) return "unauthorized";
  return null;
}