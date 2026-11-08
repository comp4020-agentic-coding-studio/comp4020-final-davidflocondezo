"use client";

import { useState } from "react";

export interface ShareButtonProps {
  geohash: string;
}

const CONFIRMATION_MS = 2000;

export default function ShareButton({ geohash }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy(): Promise<void> {
    setError(null);
    // Read window.location only at click time (not render time) so this
    // never risks a server/client hydration mismatch — the URL only needs
    // to exist once a visitor actually interacts with the button.
    const url = `${window.location.origin}/?place=${geohash}`;
    try {
      if (!navigator.clipboard) throw new Error("clipboard API unavailable");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), CONFIRMATION_MS);
    } catch {
      // Clipboard access needs a secure context (HTTPS/localhost) and can be
      // blocked by browser permissions — rather than fail silently, fall
      // back to something the visitor can still act on.
      setError(url);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <button
        type="button"
        aria-label="Copy link to this location"
        title="Copy link to this location"
        onClick={() => void copy()}
        style={{
          display: "flex",
          alignItems: "center",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontSize: "1.1rem",
          color: copied ? "#2461e5" : "#ccc",
        }}
      >
        🔗
      </button>
      {copied && <span style={{ fontSize: "0.8rem", color: "#2461e5" }}>Copied!</span>}
      {error && (
        <span style={{ fontSize: "0.8rem", color: "crimson" }}>
          Couldn't copy automatically — here's the link: {error}
        </span>
      )}
    </span>
  );
}
