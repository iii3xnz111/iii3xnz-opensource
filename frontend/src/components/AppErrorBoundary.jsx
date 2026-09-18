import React from "react";

export default class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: "var(--text)" }}>
        <section style={{ maxWidth: 440, padding: 24, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
          <h1 style={{ marginTop: 0 }}>Something went wrong</h1>
          <p style={{ color: "var(--text-muted)" }}>The application could not finish loading this page. Refresh and try again.</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>Refresh</button>
        </section>
      </main>
    );
  }
}
