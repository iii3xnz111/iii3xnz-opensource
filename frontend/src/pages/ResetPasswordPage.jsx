import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "../api.js";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/"), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!token) {
    return (
      <div style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
        <p>This reset link is missing its token. Request a new one from the <Link to="/">log in page</Link>.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", padding: 24, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)" }}>
      <h2>Set a new password</h2>
      {done ? (
        <p style={{ color: "var(--success)" }}>Password updated — redirecting to log in...</p>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            placeholder="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
          <button type="submit">Update password</button>
        </form>
      )}
    </div>
  );
}
