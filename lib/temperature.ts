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
// to land close to the ~650-point target. Exported so the client can
// reshape the flat response below into its real row-major grid (rows =
// latitude steps, cols = longitude steps) for bilinear interpolation,
// and can map an image overlay onto the exact same bounds, without
// duplicating these numbers.
export const GRID_LAT_RANGE = { min: -44, max: -10, step: 1.5 };
export const GRID_LON_RANGE = { min: 113, max: 154, step: 1.5 };
export const GRID_COLS = Math.floor((GRID_LON_RANGE.max - GRID_LON_RANGE.min) / GRID_LON_RANGE.step) + 1;
export const GRID_ROWS = Math.floor((GRID_LAT_RANGE.max - GRID_LAT_RANGE.min) / GRID_LAT_RANGE.step) + 1;

// The configured min/max span isn't an exact multiple of `step` (34 / 1.5
// and 41 / 1.5 both have remainders), so gridPoints()'s loop never actually
// reaches GRID_LAT_RANGE.min / GRID_LON_RANGE.max — it stops one short step
// early. These are the grid's real edges (the last value the loop visits),
// used instead of the nominal min/max wherever the grid's extent needs to
// line up exactly with its real sample positions (e.g. placing/clipping an
// image built from this grid) — using the nominal range there would stretch
// the image over up to a full step of space with no actual data.
export const GRID_LAT_MIN = GRID_LAT_RANGE.max - (GRID_ROWS - 1) * GRID_LAT_RANGE.step;
export const GRID_LON_MAX = GRID_LON_RANGE.min + (GRID_COLS - 1) * GRID_LON_RANGE.step;

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

// tempC is nullable (rather than filtering missing readings out, as
// lib/wind.ts does for individual stations) because the client reshapes
// this flat array back into its row-major grid for bilinear
// interpolation — dropping an entry would shift every later point into
// the wrong grid cell. A missing reading is rare in practice (model data,
// not a real station that can go offline) but is kept explicit rather
// than silently coerced to 0, which would misrepresent "no data" as "zero
// degrees".
export interface TemperatureObservation {
  lat: number;
  lon: number;
  tempC: number | null;
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
    return points.map((p, i) => {
      const tempC = body[i]?.current?.temperature_2m;
      return { lat: p.lat, lon: p.lon, tempC: typeof tempC === "number" ? tempC : null };
    });
  });
}
