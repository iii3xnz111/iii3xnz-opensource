import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, UserRound, Camera, LifeBuoy } from "lucide-react";
import { api, clearToken } from "../api.js";
import { getSupportComposeUrl } from "../support.js";

const MAX_AVATAR_BYTES = 300_000;

export default function AccountMenu({ me, billing, onAvatarChange, onManageBilling }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const initial = (me?.email || "?")[0].toUpperCase();
  const isPaidPlan = billing?.plan === "starter" || billing?.plan === "pro";
  const supportUrl = getSupportComposeUrl(me?.email);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      if (dataUrl.length > MAX_AVATAR_BYTES) {
        setError("Image is too large — try a smaller one (under ~300KB).");
        return;
      }
      try {
        await api.updateProfile(dataUrl);
        onAvatarChange(dataUrl);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Open account menu"
        title="Account menu"
        style={{
          width: 32, height: 32, borderRadius: "50%", padding: 0, overflow: "hidden",
          background: me?.avatarUrl ? "transparent" : "var(--primary)", border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: "#fff",
        }}
      >
        {me?.avatarUrl ? (
          <img src={me.avatarUrl} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initial
        )}
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", top: 40, right: 0, width: 240, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-md)", padding: 12, zIndex: 50 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, color: "#fff", flexShrink: 0 }}>
                {me?.avatarUrl ? <img src={me.avatarUrl} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initial}
              </div>
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me?.email}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "capitalize" }}>{billing?.plan || "free"} plan</div>
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, marginTop: 10, justifyContent: "flex-start", background: "none", border: "none", padding: "8px 4px" }}
            >
              <Camera size={14} /> Change photo
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />

            <button
                onClick={() => { setOpen(false); navigate("/account"); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start", background: "none", border: "none", padding: "8px 4px" }}
              >
                <UserRound size={14} /> Account & billing
            </button>

            {isPaidPlan && (
              <a
                href={supportUrl || undefined}
                target={supportUrl ? "_blank" : undefined}
                rel={supportUrl ? "noreferrer" : undefined}
                title={supportUrl ? "Open a prefilled Gmail support message" : "Support email is not configured yet"}
                onClick={(event) => { if (!supportUrl) event.preventDefault(); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 4px", color: supportUrl ? "var(--text)" : "var(--text-muted)", fontSize: 13, textDecoration: "none", cursor: supportUrl ? "pointer" : "not-allowed" }}
              >
                <LifeBuoy size={14} /> {supportUrl ? "Contact support" : "Support email not configured"}
              </a>
            )}

            {error && <div style={{ color: "var(--danger)", fontSize: 11, padding: "4px 4px" }}>{error}</div>}

            <button
              onClick={() => { clearToken(); navigate("/"); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start", background: "none", border: "none", padding: "8px 4px", marginTop: 4, borderTop: "1px solid var(--border)", color: "var(--danger)" }}
            >
              <LogOut size={14} /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
