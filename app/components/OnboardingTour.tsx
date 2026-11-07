"use client";

export interface OnboardingTourProps {
  onDismiss: () => void;
}

// Styled like ReportsExplainer.tsx (same fixed backdrop + centered box
// pattern) — a first-visit summary of the whole page, not just the map, so
// it's owned by app/page.tsx rather than WeatherMap.tsx.
export default function OnboardingTour({ onDismiss }: OnboardingTourProps) {
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
        aria-label="How this app works"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "6px",
          padding: "1.25rem",
          maxWidth: "360px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>How this app works</h3>
        <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
          <li>Search for a place, or use &quot;Use my location&quot;, to see its radar, warnings and forecast.</li>
          <li>Tap anywhere on the map to drop a community report about what you&apos;re seeing right now.</li>
          <li>Use Layers to toggle radar, distance rings, radar coverage, lightning, wind and temperature.</li>
        </ul>
        <button type="button" onClick={onDismiss} style={{ width: "100%", padding: "0.5rem" }}>
          Got it
        </button>
      </div>
    </div>
  );
}
