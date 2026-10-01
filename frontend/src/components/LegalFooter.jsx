import React from "react";
import { Link } from "react-router-dom";

export default function LegalFooter() {
  return (
    <footer className="legal-footer">
      <span>© {new Date().getFullYear()} iii3xnz</span>
      <nav aria-label="Legal">
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
      </nav>
    </footer>
  );
}
