const TOKEN_KEY = "flowforge_token";
const REMEMBER_ME_KEY = "flowforge_remember_me";

function getStorage(storageName) {
  if (typeof globalThis === "undefined") return null;
  const storage = globalThis[storageName];
  if (!storage || typeof storage.getItem !== "function") return null;
  return storage;
}

export function getRememberMePreference(overrides = {}) {
  const localStorage = overrides.localStorage || getStorage("localStorage");
  if (!localStorage) return false;
  const value = localStorage.getItem(REMEMBER_ME_KEY);
  if (value === null) return false;
  return value === "1" || value === "true";
}

export function setRememberMePreference(rememberMe, overrides = {}) {
  const localStorage = overrides.localStorage || getStorage("localStorage");
  if (!localStorage) return;
  localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "1" : "0");
}

export function getStoredToken(overrides = {}) {
  const localStorage = overrides.localStorage || getStorage("localStorage");
  const sessionStorage = overrides.sessionStorage || getStorage("sessionStorage");
  const rememberMe = getRememberMePreference({ localStorage });

  if (rememberMe) {
    const persistentToken = localStorage ? localStorage.getItem(TOKEN_KEY) : null;
    if (persistentToken) return persistentToken;
  }

  if (sessionStorage) {
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    if (sessionToken) return sessionToken;
  }

  if (localStorage && rememberMe) {
    return localStorage.getItem(TOKEN_KEY);
  }

  return null;
}

export function setStoredToken(token, rememberMe = false, overrides = {}) {
  const localStorage = overrides.localStorage || getStorage("localStorage");
  const sessionStorage = overrides.sessionStorage || getStorage("sessionStorage");
  setRememberMePreference(rememberMe, { localStorage });

  if (!token) {
    clearStoredToken({ localStorage, sessionStorage });
    return;
  }

  if (rememberMe) {
    if (localStorage) localStorage.setItem(TOKEN_KEY, token);
    if (sessionStorage) sessionStorage.removeItem(TOKEN_KEY);
    return;
  }

  if (sessionStorage) sessionStorage.setItem(TOKEN_KEY, token);
  if (localStorage) localStorage.removeItem(TOKEN_KEY);
}

export function clearStoredToken(overrides = {}) {
  const localStorage = overrides.localStorage || getStorage("localStorage");
  const sessionStorage = overrides.sessionStorage || getStorage("sessionStorage");
  if (localStorage) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REMEMBER_ME_KEY);
  }
  if (sessionStorage) sessionStorage.removeItem(TOKEN_KEY);
}
