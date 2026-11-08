import { weatherIconSvg } from "../../lib/weatherIcons.ts";

export interface CurrentConditionsProps {
  tempC: number | null;
  iconDescriptor: string | null;
  nearestWarningHeadline: string | null;
  uv: { category: string; max_index: number } | null;
}

// BOM's own `category` comes back lowercase with no spaces (confirmed live:
// "veryhigh", not "very high") — this both labels and colors it using the
// standard WHO/BOM UV-index scale, the same one printed on the Bureau's own
// UV charts. A closed lookup (not a formula off max_index) since BOM's
// category is the authoritative tier, not something to re-derive.
const UV_CATEGORY_INFO: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "#2f9e44" },
  moderate: { label: "Moderate", color: "#e6a817" },
  high: { label: "High", color: "#e8590c" },
  veryhigh: { label: "Very High", color: "#c0392b" },
  extreme: { label: "Extreme", color: "#8e44ad" },
};

// A single glance-able summary, pinned above everything else on the page
// (search box, map) so the one-line answer the README's "good" promises —
// "is it raining near me, or about to" — never requires scrolling past the
// rest of the UI first.
export default function CurrentConditions({ tempC, iconDescriptor, nearestWarningHeadline, uv }: CurrentConditionsProps) {
  if (tempC === null && !nearestWarningHeadline) return null;

  const uvInfo = uv ? { ...(UV_CATEGORY_INFO[uv.category] ?? { label: uv.category, color: "#555" }), maxIndex: uv.max_index } : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        border: "1px solid #ccc",
        borderRadius: "6px",
        padding: "0.75rem 1rem",
        marginTop: "1rem",
        marginBottom: "1rem",
      }}
    >
      {/* weatherIconSvg returns a plain inline SVG string from this app's own
          lib/weatherIcons.ts (the same one WeatherMap.tsx's Leaflet popups
          use), not user-supplied content, so rendering it this way carries
          no injection risk — React has no built-in way to render a raw SVG
          string other than dangerouslySetInnerHTML. */}
      <span
        aria-hidden="true"
        style={{ flexShrink: 0, display: "flex" }}
        dangerouslySetInnerHTML={{ __html: weatherIconSvg(iconDescriptor) }}
      />
      <div>
        {tempC !== null && <strong style={{ fontSize: "1.25rem" }}>{tempC}°C</strong>}
        {uvInfo && (
          <span
            style={{
              marginLeft: "0.75rem",
              padding: "0.1rem 0.5rem",
              borderRadius: "999px",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#fff",
              backgroundColor: uvInfo.color,
            }}
          >
            UV {uvInfo.maxIndex} · {uvInfo.label}
          </span>
        )}
        {nearestWarningHeadline && (
          <div style={{ color: "#8a2020" }}>
            <strong>Nearest warning:</strong> {nearestWarningHeadline}
          </div>
        )}
      </div>
    </div>
  );
}
