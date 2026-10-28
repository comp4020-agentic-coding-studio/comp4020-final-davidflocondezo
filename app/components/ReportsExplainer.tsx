"use client";

export interface ReportsExplainerProps {
  onDismiss: () => void;
}

// A small centered dialog, not a full design-system modal — this app has no
// other overlay like it, so a fixed-position backdrop + box is simplest thing
// that actually blocks interaction with the map underneath while it's open.
export default function ReportsExplainer({ onDismiss }: ReportsExplainerProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: "1rem",
      }}
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-label="About community reports"
        // Stops a click on the box itself from bubbling to the backdrop's
        // onDismiss above — only clicking outside the box, or the button,
        // should close it.
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "6px",
          padding: "1.25rem",
          maxWidth: "360px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Community reports</h3>
        <p>
          Tap anywhere on the map to drop a pin about something you&apos;re seeing right now — flooding, hail,
          anything the official radar and warnings might not show yet.
        </p>
        <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
          <li>
            Reports are <strong>not official</strong> — they&apos;re shown in amber, never mistaken for a real BOM
            warning.
          </li>
          <li>Anyone can confirm a report; confirmations help others judge how reliable it looks.</li>
          <li>Only you can edit or delete a report you created.</li>
          <li>Reports fade out and disappear after 2 hours.</li>
        </ul>
        <button type="button" onClick={onDismiss} style={{ width: "100%", padding: "0.5rem" }}>
          Got it
        </button>
      </div>
    </div>
  );
}
