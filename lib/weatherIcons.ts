// Maps BOM's forecast `icon_descriptor` (a fixed but undocumented enum —
// confirmed live against the real API: "clear", "cloudy", "shower",
// "mostly_sunny" all appeared in a single week's forecast, see PROCESS.md)
// to a small inline SVG string. Plain strings, not JSX, matching how
// WeatherMap.tsx already builds every other marker/popup icon (lightningIcon,
// windArrowIcon, buildReportPopupContent) — those are Leaflet divIcons and
// popup innerHTML, both raw DOM, not React-rendered.
const STROKE = "#555";

const SUN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#e6a817" stroke-width="2">
  <circle cx="12" cy="12" r="5" />
  <path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke-linecap="round" />
</svg>`;

const SUN_BEHIND_CLOUD = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none">
  <circle cx="9" cy="8" r="4" stroke="#e6a817" stroke-width="2" />
  <path d="M7 17a4 4 0 0 1-.5-7.97 5 5 0 0 1 9.4-1.2A4.5 4.5 0 0 1 16 17" stroke="${STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
</svg>`;

const CLOUD = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${STROKE}" stroke-width="2">
  <path d="M6 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 15 8a4.5 4.5 0 0 1 1 8.95" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

const RAIN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${STROKE}" stroke-width="2">
  <path d="M6 14a4 4 0 0 1-.5-7.97A5 5 0 0 1 15 4a4.5 4.5 0 0 1 1 8.95" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#2f6fed" stroke-linecap="round" />
</svg>`;

const STORM = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${STROKE}" stroke-width="2">
  <path d="M6 13a4 4 0 0 1-.5-7.97A5 5 0 0 1 15 3a4.5 4.5 0 0 1 1 8.95" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M12 13l-3 5h3l-2 4" stroke="#e6a817" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

const FOG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${STROKE}" stroke-width="2">
  <path d="M4 9h12M4 13h16M4 17h12" stroke-linecap="round" />
</svg>`;

const SNOW = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${STROKE}" stroke-width="2">
  <path d="M6 13a4 4 0 0 1-.5-7.97A5 5 0 0 1 15 3a4.5 4.5 0 0 1 1 8.95" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M8 17v5M12 17v5M16 17v5M6.5 19l3-1.5M9.5 19l-3-1.5M10.5 19l3-1.5M13.5 19l-3-1.5M14.5 19l3-1.5M17.5 19l-3-1.5" stroke="#5aa6e0" />
</svg>`;

// Keyed on the exact `icon_descriptor` strings BOM returns — a closed set in
// practice (community weather tools have catalogued it), but a new descriptor
// showing up live only needs a new entry here, not a schema change.
const ICONS: Record<string, string> = {
  clear: SUN,
  sunny: SUN,
  mostly_sunny: SUN_BEHIND_CLOUD,
  mostly_clear: SUN_BEHIND_CLOUD,
  partly_cloudy: SUN_BEHIND_CLOUD,
  cloudy: CLOUD,
  mostly_cloudy: CLOUD,
  hazy: CLOUD,
  dusty: CLOUD,
  windy: CLOUD,
  fog: FOG,
  frost: FOG,
  shower: RAIN,
  light_shower: RAIN,
  heavy_shower: RAIN,
  rain: RAIN,
  light_rain: RAIN,
  heavy_rain: RAIN,
  storm: STORM,
  tropicalcyclone: STORM,
  snow: SNOW,
};

// Falls back to a plain cloud for any descriptor not in the map above (or a
// missing one — BOM's own `icon_descriptor` is nullable, confirmed live)
// rather than rendering nothing, since "no icon" reads as a loading/broken
// state in a popup that otherwise always has one.
export function weatherIconSvg(descriptor: string | null | undefined): string {
  return (descriptor && ICONS[descriptor]) || CLOUD;
}
