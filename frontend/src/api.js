import { ensureJsonResponse, extractSessionToken as parseSessionToken } from "./session.js";
import { getRememberMePreference, getStoredToken, setStoredToken, clearStoredToken } from "./authStorage.js";

const WORKSPACE_KEY = "flowforge_workspace";
const configuredApiUrl = (import.meta.env.VITE_API_URL || "").trim();
const API_BASE_URL = (configuredApiUrl || (import.meta.env.PROD && import.meta.env.VITE_SELF_HOSTED !== "true" ? "https://iii3xnz.onrender.com" : ""))
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

export function getToken() {
  return getStoredToken();
}
export function setToken(token, rememberMe = getRememberMePreference()) {
  setStoredToken(token, rememberMe);
  localStorage.removeItem(WORKSPACE_KEY);
}
export function clearToken() {
  clearStoredToken();
  localStorage.removeItem(WORKSPACE_KEY);
}
export function setWorkspace(workspaceId) {
  if (!workspaceId) {
    localStorage.removeItem(WORKSPACE_KEY);
    return;
  }
  localStorage.setItem(WORKSPACE_KEY, workspaceId);
}
export function clearWorkspace() {
  localStorage.removeItem(WORKSPACE_KEY);
}

export async function request(path, options = {}) {
  const token = getToken();
  const workspaceId = localStorage.getItem(WORKSPACE_KEY);
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await ensureJsonResponse(res, "API");
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
    }
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function extractSessionToken(payload) {
  return parseSessionToken(payload, "Authentication");
}

export const api = {
  signup: (email, password, rememberMe = false) => request("/auth/signup", { method: "POST", body: { email, password, rememberMe } }),
  login: (email, password, rememberMe = false) => request("/auth/login", { method: "POST", body: { email, password, rememberMe } }),
  googleLogin: (credential, acceptedLegal = false, rememberMe = false) => request("/auth/google", { method: "POST", body: { credential, acceptedLegal, rememberMe } }),
  linkGoogle: (credential) => request("/auth/google/link", { method: "POST", body: { credential } }),
  me: () => request("/auth/me"),
  updateProfile: (avatarUrl) => request("/auth/profile", { method: "PATCH", body: { avatarUrl } }),
  verifyOtp: (otp) => request("/auth/verify-otp", { method: "POST", body: { otp } }),
  resendOtp: () => request("/auth/resend-otp", { method: "POST" }),
  forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (token, newPassword) => request("/auth/reset-password", { method: "POST", body: { token, newPassword } }),
  listWorkflows: () => request("/workflows"),
  createWorkflow: (name, definition) => request("/workflows", { method: "POST", body: { name, definition } }),
  getWorkflow: (id) => request(`/workflows/${id}`),
  getWorkflowVersions: (id) => request(`/workflows/${id}/versions`),
  restoreWorkflowVersion: (id, version) => request(`/workflows/${id}/versions/${version}/restore`, { method: "POST" }),
  updateWorkflow: (id, body) => request(`/workflows/${id}`, { method: "PUT", body }),
  deleteWorkflow: (id) => request(`/workflows/${id}`, { method: "DELETE" }),
  runWorkflow: (id, payload) => request(`/workflows/${id}/run`, { method: "POST", body: { payload } }),
  getExecutions: (id) => request(id ? `/workflows/${id}/executions` : "/executions"),
  getExecutionDetail: (id, execId) => request(id ? `/workflows/${id}/executions/${execId}` : `/executions/${execId}`),
  getBillingStatus: () => request("/billing/status"),
  getEntitlements: () => request("/billing/entitlements"),
  getUsage: () => request("/billing/usage"),
  getBillingHistory: () => request("/billing/history"),
  getAccountActivity: () => request("/billing/activity"),
  getOperations: () => request("/billing/operations"),
  listWorkspaces: () => request("/workspaces"),
  createWorkspace: (name) => request("/workspaces", { method: "POST", body: { name } }),
  listWorkspaceMembers: (id) => request(`/workspaces/${id}/members`),
  updateWorkspaceMember: (id, userId, role) => request(`/workspaces/${id}/members/${userId}`, { method: "PATCH", body: { role } }),
  removeWorkspaceMember: (id, userId) => request(`/workspaces/${id}/members/${userId}`, { method: "DELETE" }),
  listProjects: (id) => request(`/workspaces/${id}/projects`),
  createProject: (id, name) => request(`/workspaces/${id}/projects`, { method: "POST", body: { name } }),
  deleteProject: (id, projectId) => request(`/workspaces/${id}/projects/${projectId}`, { method: "DELETE" }),
  createWorkspaceInvite: (id, email, role) => request(`/workspaces/${id}/invites`, { method: "POST", body: { email, role } }),
  acceptWorkspaceInvite: (token) => request(`/workspaces/invites/${token}/accept`, { method: "POST" }),
  startCheckout: (plan) => request("/billing/create-checkout-session", { method: "POST", body: { plan } }),
  openBillingPortal: () => request("/billing/create-portal-session", { method: "POST" }),
  getCredentialTypes: () => request("/credentials/types"),
  listCredentials: () => request("/credentials"),
  createCredential: (name, type, data) => request("/credentials", { method: "POST", body: { name, type, data } }),
  deleteCredential: (id) => request(`/credentials/${id}`, { method: "DELETE" }),
  listWorkflowPermissions: (id) => request(`/workflows/${id}/permissions`),
  grantWorkflowPermission: (id, userId, role) => request(`/workflows/${id}/permissions`, { method: "POST", body: { userId, role } }),
  revokeWorkflowPermission: (id, userId) => request(`/workflows/${id}/permissions/${userId}`, { method: "DELETE" }),
  getOAuthProviders: () => request("/oauth/providers"),
  listOAuthConnections: () => request("/oauth/connections"),
  startOAuth: (provider) => request("/oauth/start", { method: "POST", body: { provider } }),
  disconnectOAuth: (id) => request(`/oauth/connections/${id}`, { method: "DELETE" }),
};
