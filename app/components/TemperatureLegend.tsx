"use client";

import { TEMP_COLOR_STOPS } from "../../lib/temperature.ts";

const MIN_TEMP_C = TEMP_COLOR_STOPS[0].tempC;
const MAX_TEMP_C = TEMP_COLOR_STOPS[TEMP_COLOR_STOPS.length - 1].tempC;

// Same stops the map's own heat image interpolates between (see
// lib/temperature.ts) — expressed as a CSS gradient here instead of sampled
// pixel-by-pixel, since a bar only needs to *look* like the same scale, not
// reproduce its exact bilinear math.
const GRADIENT = `linear-gradient(to right, ${TEMP_COLOR_STOPS.map(
  ({ tempC, rgb: [r, g, b] }) =>
    `rgb(${r}, ${g}, ${b}) ${((tempC - MIN_TEMP_C) / (MAX_TEMP_C - MIN_TEMP_C)) * 100}%`,
).join(", ")})`;

// The first/last stops mark open-ended bands (anything colder than 0,
// anything 45+) rather than their literal -5°C/45°C values, so they're
// labeled as open-ended instead of as plain numbers — matching
// buildTemperatureImage's own comment that each stop is a band's *lower*
// boundary.
function labelForStop(tempC: number, index: number): string {
  if (index === 0) return "<0";
  if (index === TEMP_COLOR_STOPS.length - 1) return `${tempC}+`;
  return `${tempC}`;
}

// Shown only while the Temperature layer is toggled on (see WeatherMap.tsx),
// directly below the Layers panel and above the map — same bordered-box
// styling as LayersPanel so the two read as one toolbar area.
export default function TemperatureLegend() {
  return (
    <div style={{ border: "1px solid #ccc", padding: "0.5rem", marginBottom: "0.5rem" }}>
      <strong style={{ display: "block", marginBottom: "0.25rem" }}>Air temperature</strong>
      <div style={{ height: "12px", borderRadius: "2px", background: GRADIENT }} />
      <div style={{ position: "relative", height: "1.2em", fontSize: "0.8em", color: "#555" }}>
        {TEMP_COLOR_STOPS.map(({ tempC }, index) => (
          <span
            key={tempC}
            style={{
              position: "absolute",
              left: `${((tempC - MIN_TEMP_C) / (MAX_TEMP_C - MIN_TEMP_C)) * 100}%`,
              transform:
                index === 0 ? "translateX(0%)" : index === TEMP_COLOR_STOPS.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {labelForStop(tempC, index)}
          </span>
        ))}
      </div>
    </div>
  );
}
