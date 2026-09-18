import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Webhook,
  ArrowRight,
  Zap,
  ShieldCheck,
  Puzzle,
  GitBranch,
  MessageSquare,
  Mail,
  GitPullRequest,
  Table2,
  HelpCircle,
} from "lucide-react";
import LegalFooter from "../components/LegalFooter.jsx";
import { PLAN_CATALOG, PLAN_ORDER } from "../planContract.js";
import { api, clearToken, getToken } from "../api.js";

const STEPS = [
  {
    icon: Webhook,
    title: "1. Something happens",
    body: "A webhook fires, a schedule ticks, or you click Run — any of these can start a workflow.",
  },
  {
    icon: GitBranch,
    title: "2. iii3xnz reacts",
    body: "Call an API, branch on a condition, loop over data, or hand off to any of 38 built-in nodes.",
  },
  {
    icon: Zap,
    title: "3. It just works",
    body: "See exactly what happened at every step, automatically — no manual checking required.",
  },
];

const FEATURES = [
  {
    icon: Puzzle,
    title: "38 built-in nodes",
    body: "Slack, Discord, Email, GitHub, Notion, Trello, Twilio, HubSpot, and more — no code required.",
  },
  {
    icon: ShieldCheck,
    title: "Encrypted credentials",
    body: "Save an API key once, reuse it everywhere. Encrypted at rest, never stored in plain text.",
  },
  {
    icon: GitBranch,
    title: "Real logic, not just chains",
    body: "Branching, loops, merging parallel steps, and sub-workflows — not just A-to-B automations.",
  },
];

export default function LandingPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getToken());
  const [checkingAuth, setCheckingAuth] = useState(() => !!getToken());

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsAuthenticated(false);
      setCheckingAuth(false);
      return undefined;
    }

    let active = true;
    setCheckingAuth(true);
    api.me().then(() => {
      if (!active) return;
      setIsAuthenticated(true);
      setCheckingAuth(false);
    }).catch((error) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error || "");
      const shouldLogout = /401|Missing token|Invalid or expired token|expired|unauthorized|Not found/i.test(message);
      if (shouldLogout) {
        clearToken();
      }
      setIsAuthenticated(false);
      setCheckingAuth(false);
    });

    return () => {
      active = false;
    };
  }, []);

  function openSupport() {
    const email = "iii3xnz111@gmail.com";
    const subject = encodeURIComponent("Support Request");
    const body = encodeURIComponent("Hello,\n\nI need help with...\n\nThank you!");
    const supportUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${subject}&body=${body}`;
    window.open(supportUrl, "_blank", "noopener,noreferrer");
  }

  const authenticatedButtons = (
    <>
      <Link to="/workflows">
        <button className="btn-primary">Open app</button>
      </Link>
      <Link to="/account">
        <button style={{ background: "none", border: "1px solid var(--border)", marginLeft: 8 }}>Account</button>
      </Link>
    </>
  );

  const loggedOutButtons = (
    <>
      <Link to="/auth">
        <button style={{ background: "none", border: "1px solid var(--border)" }}>Log in</button>
      </Link>{" "}
      <Link to="/auth">
        <button className="btn-primary">Get started free</button>
      </Link>
    </>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "20px 32px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <img
          src="/logo.png"
          alt="iii3xnz"
          style={{
            width: 42,
            height: 42,
            objectFit: "contain",
          }}
        />

        <div>
          <button
            onClick={openSupport}
            title="Open support"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              color: "var(--text-muted)",
              fontSize: 14,
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <HelpCircle size={16} /> Support
          </button>
          {checkingAuth ? <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 13 }}>Checking session…</span> : (isAuthenticated ? authenticatedButtons : loggedOutButtons)}
        </div>
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "60px 24px 40px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h1 style={{ fontSize: 42, lineHeight: 1.2, margin: 0 }}>
          Automate your work,
          <br />
          without writing code
        </h1>

        <p
          style={{
            fontSize: 16,
            color: "var(--text-muted)",
            marginTop: 16,
          }}
        >
          Connect your apps with a visual workflow builder — triggers, actions,
          branching logic, and 38 built-in nodes, ready in minutes.
        </p>

        {isAuthenticated ? (
          <Link to="/workflows">
            <button
              className="btn-primary"
              style={{
                fontSize: 15,
                padding: "12px 28px",
                marginTop: 20,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Open app <ArrowRight size={16} />
            </button>
          </Link>
        ) : (
          <Link to="/auth">
            <button
              className="btn-primary"
              style={{
                fontSize: 15,
                padding: "12px 28px",
                marginTop: 20,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Get started free <ArrowRight size={16} />
            </button>
          </Link>
        )}

        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            marginTop: 8,
          }}
        >
          No credit card required
        </div>
      </div>

      <div
        style={{
          maxWidth: 900,
          margin: "40px auto",
          padding: "0 24px",
        }}
      >
        <h2 style={{ textAlign: "center", fontSize: 24 }}>
          How it works
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 20,
            marginTop: 24,
          }}
        >
          {STEPS.map((s) => (
            <div
              key={s.title}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <s.icon size={22} color="var(--primary)" />

              <div
                style={{
                  fontWeight: 600,
                  marginTop: 10,
                }}
              >
                {s.title}
              </div>

              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginTop: 6,
                }}
              >
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          maxWidth: 900,
          margin: "40px auto",
          padding: "0 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Connects with
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 24,
            marginTop: 16,
            flexWrap: "wrap",
          }}
        >
          {[MessageSquare, Mail, GitPullRequest, Table2].map(
            (Icon, i) => (
              <div
                key={i}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={20} color="var(--text-muted)" />
              </div>
            )
          )}
        </div>
      </div>

      <div
        style={{
          maxWidth: 900,
          margin: "50px auto",
          padding: "0 24px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 24,
          }}
        >
          {FEATURES.map((f) => (
            <div key={f.title}>
              <f.icon size={22} color="var(--primary)" />

              <div
                style={{
                  fontWeight: 600,
                  marginTop: 10,
                }}
              >
                {f.title}
              </div>

              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginTop: 6,
                }}
              >
                {f.body}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          maxWidth: 900,
          margin: "50px auto",
          padding: "0 24px",
        }}
      >
        <h2
          style={{
            textAlign: "center",
            fontSize: 24,
          }}
        >
          {import.meta.env.VITE_SELF_HOSTED === "true" ? "Self-hosted edition" : "Simple pricing"}
        </h2>

        {import.meta.env.VITE_SELF_HOSTED === "true" ? (
          <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, marginTop: 18 }}>
            Free to run on your own infrastructure. All workflow features and integrations are enabled; cloud billing is disabled.
          </p>
        ) : <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 16,
            marginTop: 24,
          }}
        >
          {PLAN_ORDER.map((key) => {
            const plan = PLAN_CATALOG[key];
            return (
            <div
              key={key}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
                textAlign: "center",
                background: "var(--surface)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                {plan.description}
              </div>

              <div
                style={{
                  fontWeight: 700,
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {plan.label}
              </div>

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  marginTop: 6,
                }}
              >
                {plan.price}
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                  }}
                >
                  /mo
                </span>
              </div>

              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}
              >
                {plan.limits.join(" · ")}
              </div>
            </div>
            );
          })}
        </div>}

        {import.meta.env.VITE_SELF_HOSTED !== "true" && <div
          style={{
            textAlign: "center",
            marginTop: 16,
          }}
        >
          <Link to="/auth" style={{ fontSize: 13 }}>
            See full plan details after signing up →
          </Link>
        </div>}
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "50px 24px 40px",
        }}
      >
        <Link to="/auth">
          <button
            className="btn-primary"
            style={{
              fontSize: 15,
              padding: "12px 28px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Start building for free <ArrowRight size={16} />
          </button>
        </Link>
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "30px 24px 50px",
          borderTop: "1px solid var(--border)",
          maxWidth: 900,
          margin: "0 auto",
        }}
      >
        <h3 style={{ fontSize: 16, marginBottom: 16 }}>Need help?</h3>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 16 }}>
          Have questions or need support? We're here to help!
        </p>
        <button
          onClick={openSupport}
          style={{
            background: "var(--primary)",
            color: "white",
            border: "none",
            padding: "10px 24px",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            fontWeight: 500,
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--primary-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--primary)")}
        >
          <Mail size={16} /> Contact Support
        </button>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
          Email: <strong>iii3xnz111@gmail.com</strong>
        </p>
        <div style={{ marginTop: 24, fontSize: 13, color: "var(--text-muted)" }}>
          <Link to="/terms" style={{ marginRight: 16, textDecoration: "none", color: "var(--primary)" }}>
            Terms of Service
          </Link>
          <Link to="/privacy" style={{ textDecoration: "none", color: "var(--primary)" }}>
            Privacy Policy
          </Link>
        </div>
      </div>

      <LegalFooter />
    </div>
  );
}
