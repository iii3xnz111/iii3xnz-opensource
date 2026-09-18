import React, { useState } from "react";
import { api } from "../api.js";

export default function EmailVerificationBanner({ onVerified }) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  async function verify(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    setVerifying(true);
    try {
      await api.verifyOtp(otp);
      setStatus("Email verified!");
      onVerified?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    setError("");
    setStatus("");
    setResending(true);
    try {
      await api.resendOtp();
      setStatus("A new code has been sent — check your inbox.");
      setOtp("");
    } catch (err) {
      setError(err.message); // e.g. "Please wait 23s before requesting another code"
    } finally {
      setResending(false);
    }
  }

  return (
    <div style={{ margin: "12px 0", padding: 12, background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: 8, fontSize: 13, color: "var(--warning-text)" }}>
      <div style={{ marginBottom: 6 }}>We emailed you a 6-digit verification code.</div>
      <form onSubmit={verify} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          maxLength={6}
          style={{ width: 90, letterSpacing: 2, fontFamily: "monospace" }}
        />
        <button type="submit" disabled={verifying || otp.length !== 6}>Verify</button>
        <button type="button" onClick={resend} disabled={resending}>Resend code</button>
      </form>
      {error && <div style={{ marginTop: 4, color: "var(--danger)" }}>{error}</div>}
      {status && <div style={{ marginTop: 4, color: "var(--success)" }}>{status}</div>}
    </div>
  );
}
