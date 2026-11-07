import { weatherIconSvg } from "../../lib/weatherIcons.ts";

export interface CurrentConditionsProps {
  tempC: number | null;
  iconDescriptor: string | null;
  nearestWarningHeadline: string | null;
}

// A single glance-able summary, pinned above everything else on the page
// (search box, map) so the one-line answer the README's "good" promises —
// "is it raining near me, or about to" — never requires scrolling past the
// rest of the UI first.
export default function CurrentConditions({ tempC, iconDescriptor, nearestWarningHeadline }: CurrentConditionsProps) {
  if (tempC === null && !nearestWarningHeadline) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        border: "1px solid #ccc",
        borderRadius: "6px",
        padding: "0.75rem 1rem",
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
        {nearestWarningHeadline && (
          <div style={{ color: "#8a2020" }}>
            <strong>Nearest warning:</strong> {nearestWarningHeadline}
          </div>
        )}
      </div>
    </div>
  );
}
