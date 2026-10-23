// Temperature data for the "Temperature" heat-map layer. Originally
// piggybacked on lib/wind.ts's BOM station grid (same endpoint, same
// 168-point sweep), but that grid is capped by BOM's burst rate limit at a
// density that renders as sparse, isolated blobs — compared directly
// against BOM's own temperature map and found visibly worse. Switched to
// Open-Meteo (api.open-meteo.com), a free, keyless weather API that
// accepts up to 1000 comma-separated lat/lon pairs in a single HTTP
// request and returns model-interpolated current temperature for every
// one — confirmed live during development: a 644-point grid across
// Australia returned in ~3.4s with 100% success, no per-point station
// resolution and none of BOM's rate-limit risk. Being model data rather
// than station readings, it also returns a value at every point (ocean,
// remote inland) rather than only wherever a real station happens to be
// nearby, which suits a smooth heat map better than BOM's station-shaped
// coverage.
//
// Free-tier limits: 600 calls/min, 5,000/hour, 10,000/day (each point in a
// batch counts as one call). This grid (644 points) refreshed on this
// module's cache TTL works out to roughly 10,300 calls/day — a deliberate
// choice by the project owner, who preferred this grid density (close to
// BOM's own map resolution) over a smaller, safely-under-the-cap grid.
import { cached } from "./bom.ts";

const API_BASE = "https://api.open-meteo.com/v1/forecast";

// Same Australia + Tasmania bounding box lib/wind.ts uses. 1.5-degree
// spacing was the density tested live (644 points, 100% success, ~3.4s)
// to land close to the ~650-point target.
const GRID_LAT_RANGE = { min: -44, max: -10, step: 1.5 };
const GRID_LON_RANGE = { min: 113, max: 154, step: 1.5 };

// 90 minutes: temperature doesn't swing fast enough to need more frequent
// refreshing, and it keeps the daily call budget close to Open-Meteo's
// free-tier cap (see module comment) rather than refreshing needlessly
// often.
const CACHE_TTL_MS = 90 * 60_000;

function gridPoints(): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  for (let lat = GRID_LAT_RANGE.max; lat >= GRID_LAT_RANGE.min; lat -= GRID_LAT_RANGE.step) {
    for (let lon = GRID_LON_RANGE.min; lon <= GRID_LON_RANGE.max; lon += GRID_LON_RANGE.step) {
      points.push({ lat, lon });
    }
  }
  return points;
}

export interface TemperatureObservation {
  lat: number;
  lon: number;
  tempC: number;
}

interface OpenMeteoResult {
  latitude: number;
  longitude: number;
  current?: { temperature_2m?: number };
}

export async function getTemperatureObservations(): Promise<TemperatureObservation[]> {
  return cached("temperature-observations", CACHE_TTL_MS, async () => {
    const points = gridPoints();
    const latitude = points.map((p) => p.lat).join(",");
    const longitude = points.map((p) => p.lon).join(",");
    const res = await fetch(`${API_BASE}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m`);
    if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`);
    const body = (await res.json()) as OpenMeteoResult[];
    // A point can come back with no current reading (not observed live,
    // but mirrors how lib/wind.ts already treats a missing reading —
    // skipped rather than faked as 0).
    return body
      .filter((r) => typeof r.current?.temperature_2m === "number")
      .map((r) => ({ lat: r.latitude, lon: r.longitude, tempC: r.current!.temperature_2m! }));
  });
}
