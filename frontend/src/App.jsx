import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LandingPage from "./pages/LandingPage.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import WorkflowListPage from "./pages/WorkflowListPage.jsx";
import BuilderPage from "./pages/BuilderPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import CredentialsPage from "./pages/CredentialsPage.jsx";
import AccountPage from "./pages/AccountPage.jsx";
import LegalPage from "./pages/LegalPage.jsx";
import AppErrorBoundary from "./components/AppErrorBoundary.jsx";
import { api, clearToken, getToken } from "./api.js";

function Private({ children }) {
  return getToken() ? children : <Navigate to="/auth" replace />;
}

function SessionBootstraper() {
  useEffect(() => {
    if (!getToken()) return undefined;

    let active = true;
    api.me().catch((error) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error || "");
      const shouldLogout = /401|Missing token|Invalid or expired token|expired|unauthorized|Not found/i.test(message);
      if (shouldLogout) {
        clearToken();
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <SessionBootstraper />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/workflows" element={<Private><WorkflowListPage /></Private>} />
        <Route path="/workflows/:id" element={<Private><BuilderPage /></Private>} />
        <Route path="/credentials" element={<Private><CredentialsPage /></Private>} />
        <Route path="/account" element={<Private><AccountPage /></Private>} />
        <Route path="/terms" element={<LegalPage />} />
        <Route path="/privacy" element={<LegalPage />} />
      </Routes>
    </AppErrorBoundary>
  );
}
