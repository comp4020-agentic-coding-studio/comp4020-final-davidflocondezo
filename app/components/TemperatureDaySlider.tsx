"use client";

import { FORECAST_DAYS } from "../../lib/temperature.ts";

export interface TemperatureDaySliderProps {
  day: number;
  onChange: (day: number) => void;
}

// Weekday name for each slider position, computed fresh on every render
// (not stored) since "today" only means something relative to render time —
// matching how buildTemperatureImage/getTemperatureObservations treat day 0
// as "right now" rather than a fixed date.
function labelForDay(offset: number): string {
  if (offset === 0) return "Today";
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

// Shown only while the Temperature layer is toggled on (see WeatherMap.tsx),
// below the map — day 0 is today's live reading, days 1-6 are that day's
// forecast high (see lib/temperature.ts's getTemperatureObservations).
export default function TemperatureDaySlider({ day, onChange }: TemperatureDaySliderProps) {
  return (
    <div style={{ border: "1px solid #ccc", padding: "0.5rem", marginTop: "0.5rem" }}>
      <label style={{ display: "block", marginBottom: "0.25rem" }}>
        <strong>Temperature forecast: </strong>
        {labelForDay(day)}
      </label>
      <input
        type="range"
        min={0}
        max={FORECAST_DAYS - 1}
        step={1}
        value={day}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8em", color: "#555" }}>
        {Array.from({ length: FORECAST_DAYS }, (_, offset) => (
          <span key={offset}>{labelForDay(offset)}</span>
        ))}
      </div>
    </div>
  );
}
