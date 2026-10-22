"use client";

export interface LayerToggles {
  radar: boolean;
  rings: boolean;
  coverage: boolean;
  lightning: boolean;
  wind: boolean;
  temperature: boolean;
}

export interface LayersPanelProps {
  toggles: LayerToggles;
  onChange: (next: LayerToggles) => void;
}

const LAYERS: { key: keyof LayerToggles; label: string }[] = [
  { key: "radar", label: "Radar" },
  { key: "rings", label: "Distance rings" },
  { key: "coverage", label: "Radar coverage" },
  { key: "lightning", label: "Lightning" },
  { key: "wind", label: "Wind" },
  { key: "temperature", label: "Temperature" },
];

// A plain block above the map, not an overlay on the map canvas — this app
// has already hit real click/z-index fragility stacking its own DOM on top
// of Leaflet's panes (see WeatherMap.tsx's buildReportPopupContent comments
// on event propagation), so a toggle panel avoids that entirely by sitting
// outside the map in normal page flow.
export default function LayersPanel({ toggles, onChange }: LayersPanelProps) {
  return (
    <div style={{ border: "1px solid #ccc", padding: "0.5rem", marginBottom: "0.5rem" }}>
      <strong style={{ display: "block", marginBottom: "0.25rem" }}>Layers</strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
        {LAYERS.map(({ key, label }) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <input
              type="checkbox"
              checked={toggles[key]}
              onChange={(e) => onChange({ ...toggles, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
