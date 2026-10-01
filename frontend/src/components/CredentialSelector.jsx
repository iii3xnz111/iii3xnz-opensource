import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function CredentialSelector({ credentialType, value, onChange }) {
  const [options, setOptions] = useState([]);
  const [oauthOptions, setOauthOptions] = useState([]);

  useEffect(() => {
    const oauthProvider = { githubToken: "github", hubspotToken: "hubspot", googleServiceAccount: "google" }[credentialType];
    Promise.all([api.listCredentials(), api.listOAuthConnections()]).then(([all, oauth]) => {
      setOptions(all.filter((c) => c.type === credentialType));
      setOauthOptions(oauthProvider ? oauth.filter((c) => c.provider === oauthProvider) : []);
    }).catch(() => {});
  }, [credentialType]);

  return (
    <div style={{ marginTop: 12, padding: 8, background: "var(--surface-2)", borderRadius: 6 }}>
      <label style={{ marginTop: 0 }}>Saved credential</label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">— Fill in manually below —</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        {oauthOptions.map((c) => (
          <option key={c.id} value={c.id}>OAuth: {c.account_label || c.provider}</option>
        ))}
      </select>
      <div style={{ fontSize: 10, marginTop: 4 }}>
        <Link to="/credentials" target="_blank">+ Save a new credential</Link>
      </div>
    </div>
  );
}
