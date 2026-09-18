import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, Plus, ArrowLeft, KeyRound } from "lucide-react";
import { api } from "../api.js";

export default function CredentialsPage() {
  const [types, setTypes] = useState({});
  const [credentials, setCredentials] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [name, setName] = useState("");
  const [fields, setFields] = useState({});
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [oauthProviders, setOauthProviders] = useState([]);
  const [oauthConnections, setOauthConnections] = useState([]);

  useEffect(() => {
    Promise.all([api.getCredentialTypes(), api.listCredentials(), api.getOAuthProviders(), api.listOAuthConnections()]).then(([t, c, providers, connections]) => {
      setTypes(t);
      setCredentials(c);
      setOauthProviders(providers);
      setOauthConnections(connections);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") === "success") window.history.replaceState({}, "", "/credentials");
  }, []);

  async function connectOAuth(provider) {
    const { authorizationUrl } = await api.startOAuth(provider);
    window.location.assign(authorizationUrl);
  }

  async function disconnectOAuth(id) {
    await api.disconnectOAuth(id);
    setOauthConnections((items) => items.filter((item) => item.id !== id));
  }

  function selectType(type) {
    setSelectedType(type);
    setFields({});
    setError("");
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    try {
      const created = await api.createCredential(name, selectedType, fields);
      setCredentials((c) => [{ ...created, created_at: new Date().toISOString() }, ...c]);
      setShowForm(false);
      setName("");
      setSelectedType("");
      setFields({});
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    await api.deleteCredential(id);
    setCredentials((c) => c.filter((cred) => cred.id !== id));
  }

  if (!loaded) return <div style={{ padding: 40 }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", padding: 24 }}>
      <Link to="/workflows" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, marginBottom: 20 }}>
        <ArrowLeft size={14} /> Back to workflows
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Credentials</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> New credential
        </button>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        Save an API key or token once here, then select it by name in any node instead of
        re-typing it every time. Everything is encrypted before it's stored.
      </p>

      <h3 style={{ marginTop: 24 }}>OAuth connections</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Provider account connections use server-side OAuth. Client secrets and tokens never enter the browser.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {oauthProviders.map((provider) => {
          const connection = oauthConnections.find((item) => item.provider === provider.id);
          return <div key={provider.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
            <div><div style={{ fontWeight: 500 }}>{provider.label}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{connection ? `${connection.status} — ${connection.account_label || "Connected account"}` : provider.configured ? "Not connected" : "OAuth configuration required"}</div></div>
            {connection ? <button onClick={() => disconnectOAuth(connection.id)} style={{ fontSize: 12 }}>Disconnect</button> : <button disabled={!provider.configured} onClick={() => connectOAuth(provider.id)} className="btn-primary" style={{ fontSize: 12 }}>{provider.configured ? `Connect ${provider.label}` : "Unavailable"}</button>}
          </div>;
        })}
      </div>

      {credentials.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 24px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", marginTop: 12 }}>
          <KeyRound size={26} color="var(--text-muted)" style={{ marginBottom: 8 }} />
          <p style={{ color: "var(--text-muted)", margin: 0 }}>No credentials saved yet.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {credentials.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <KeyRound size={16} color="var(--text-muted)" />
                <div>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{types[c.type]?.label || c.type}</div>
                </div>
              </div>
              <button onClick={() => remove(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, width: 420, maxHeight: "80vh", overflowY: "auto", boxShadow: "var(--shadow-md)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>New credential</h3>
              <button onClick={() => setShowForm(false)}>×</button>
            </div>

            {!selectedType ? (
              <>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12 }}>What kind of credential?</p>
                {Object.entries(types).map(([type, def]) => (
                  <div
                    key={type}
                    onClick={() => selectType(type)}
                    style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 6, cursor: "pointer", transition: "border-color 0.15s ease" }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  >
                    <div>{def.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{def.authMode || "Encrypted credential"}</div>
                  </div>
                ))}
              </>
            ) : (
              <form onSubmit={save}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
                  Authentication: {types[selectedType].authMode || "Encrypted credential"}
                </div>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginTop: 14 }}>Name (for you to recognize it)</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My GitHub" required style={{ width: "100%" }} />

                {types[selectedType].fields.map((field) => (
                  <div key={field}>
                    <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginTop: 12 }}>{field}</label>
                    <input
                      type="password"
                      value={fields[field] || ""}
                      onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
                      required
                      style={{ width: "100%" }}
                    />
                  </div>
                ))}

                {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button type="button" onClick={() => setSelectedType("")}>Back</button>
                  <button type="submit" className="btn-primary">Save credential</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
