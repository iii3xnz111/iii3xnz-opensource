import test from "node:test";
import assert from "node:assert/strict";

import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
  getRememberMePreference,
  setRememberMePreference,
} from "./authStorage.js";

function makeStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}

test("remember me stores the token in localStorage and no-save mode keeps it in sessionStorage", () => {
  const local = makeStorage();
  const session = makeStorage();

  setStoredToken("persistent-token", true, { localStorage: local, sessionStorage: session });
  assert.equal(getStoredToken({ localStorage: local, sessionStorage: session }), "persistent-token");
  assert.equal(local.getItem("flowforge_token"), "persistent-token");
  assert.equal(session.getItem("flowforge_token"), null);

  setStoredToken("session-token", false, { localStorage: local, sessionStorage: session });
  assert.equal(getStoredToken({ localStorage: local, sessionStorage: session }), "session-token");
  assert.equal(local.getItem("flowforge_token"), null);
  assert.equal(session.getItem("flowforge_token"), "session-token");

  clearStoredToken({ localStorage: local, sessionStorage: session });
  assert.equal(getStoredToken({ localStorage: local, sessionStorage: session }), null);
});

test("remember me preference is persisted separately from auth token storage", () => {
  const local = makeStorage();
  const session = makeStorage();

  setRememberMePreference(true, { localStorage: local });
  assert.equal(getRememberMePreference({ localStorage: local }), true);
  assert.equal(local.getItem("flowforge_remember_me"), "1");

  setRememberMePreference(false, { localStorage: local });
  assert.equal(getRememberMePreference({ localStorage: local }), false);
  assert.equal(local.getItem("flowforge_remember_me"), "0");

  setStoredToken("session-token", false, { localStorage: local, sessionStorage: session });
  assert.equal(getRememberMePreference({ localStorage: local }), false);
  assert.equal(session.getItem("flowforge_token"), "session-token");
});
