import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setToken } from "../api.js";
import { extractSessionToken } from "../session.js";
import LegalFooter from "../components/LegalFooter.jsx";

export default function AuthPage() {
  const [mode, setMode] = useState("login"); // login | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleButtonRef = useRef(null);
  const acceptedLegalRef = useRef(acceptedLegal);
  const googleInFlightRef = useRef(false);
  const navigate = useNavigate();
  const inviteToken = new URLSearchParams(window.location.search).get("invite");

  useEffect(() => {
    acceptedLegalRef.current = acceptedLegal;
  }, [acceptedLegal]);

  useEffect(() => {
    if (mode === "forgot" || !googleButtonRef.current) return undefined;
    const clientId = import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID;
    if (!clientId) return undefined;

    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          if (googleInFlightRef.current) return;
          if (typeof credential !== "string" || !credential) {
            setError("Google did not return a valid sign-in credential. Please try again.");
            return;
          }
          googleInFlightRef.current = true;
          setError("");
          setMessage("");
          setGoogleLoading(true);
          try {
            const result = await api.googleLogin(credential, mode === "signup" ? acceptedLegalRef.current : true, rememberMe);
            const token = extractSessionToken(result);
            setToken(token, rememberMe);
            navigate(inviteToken ? `/account?invite=${encodeURIComponent(inviteToken)}` : "/workflows");
          } catch (err) {
            const message = err instanceof Error ? err.message : "Google sign-in failed. Please try again.";
            setError(message);
          } finally {
            setGoogleLoading(false);
            googleInFlightRef.current = false;
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, { theme: "outline", size: "large", width: 324, text: "continue_with" });
    };
    if (window.google?.accounts?.id) render();
    else {
      const timer = window.setInterval(() => {
        if (window.google?.accounts?.id) {
          window.clearInterval(timer);
          render();
        }
      }, 100);
      return () => { cancelled = true; window.clearInterval(timer); };
    }
    return () => { cancelled = true; };
  }, [mode, inviteToken, navigate]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (mode === "forgot") {
      try {
        const res = await api.forgotPassword(email);
        setMessage(res.message);
      } catch (err) {
        setError(err.message);
      }
      return;
    }

    if (mode === "signup" && !acceptedLegal) {
      setError("Please accept the Terms of Service and Privacy Policy to create an account.");
      return;
    }

    try {
      const fn = mode === "login" ? api.login : api.signup;
      const { token } = await fn(email, password, rememberMe);
      setToken(token, rememberMe);
      navigate(inviteToken ? `/account?invite=${encodeURIComponent(inviteToken)}` : "/workflows");
    } catch (err) {
      setError(err.message);
    }
  }

  const titles = { login: "Welcome back", signup: "Create your account", forgot: "Reset your password" };
  const subtitles = {
    login: inviteToken ? "Log in to accept your workspace invitation." : "Log in to keep building your workflows.",
    signup: inviteToken ? "Create your account to join the workspace." : "Free to start, no credit card required.",
    forgot: "We'll email you a link to set a new password.",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Link to="/" style={{ fontWeight: 700, fontSize: 18, marginBottom: 24, color: "var(--text)" }}>iii3xnz</Link>

      <div style={{ maxWidth: 380, width: "100%", padding: 28, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", boxShadow: "var(--shadow-md)" }}>
        <h2 style={{ marginBottom: 4 }}>{titles[mode]}</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 20 }}>{subtitles[mode]}</p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: "100%" }} />
          </div>
          {mode !== "forgot" && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required minLength={8} style={{ width: "100%" }} />
            </div>
          )}
          {mode === "signup" && (
            <label className="legal-consent">
              <input type="checkbox" checked={acceptedLegal} onChange={(e) => setAcceptedLegal(e.target.checked)} />
              <span>I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</span>
            </label>
          )}
          {mode !== "forgot" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <span>Remember me</span>
            </label>
          )}
          {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
          {message && <div style={{ color: "var(--success)", fontSize: 13 }}>{message}</div>}
          <button type="submit" className="btn-primary" style={{ padding: "10px 0", marginTop: 6 }}>
            {mode === "login" ? "Log in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
        </form>

        {mode !== "forgot" && import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px", color: "var(--text-muted)", fontSize: 11 }}>
              <span style={{ height: 1, flex: 1, background: "var(--border)" }} />
              OR
              <span style={{ height: 1, flex: 1, background: "var(--border)" }} />
            </div>
            <div ref={googleButtonRef} style={{ minHeight: 40, display: "flex", justifyContent: "center", opacity: googleLoading ? 0.6 : 1 }} />
          </>
        )}

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          {mode === "login" && (
            <button style={linkStyle} onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>
              Forgot password?
            </button>
          )}
          <button style={linkStyle} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}>
            {mode === "signup" ? "Already have an account? Log in" : mode === "forgot" ? "Back to log in" : "Need an account? Sign up"}
          </button>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}

const linkStyle = { background: "none", border: "none", color: "var(--primary)", cursor: "pointer", textAlign: "center", padding: 0, fontSize: 13 };
