// Wind speed/direction for the "Wind" map layer. No new data source: BOM's
// own observations endpoint (lib/bom.ts getWeather already fetches it for
// the selected place) carries wind on every response — confirmed live:
// { speed_kilometre, speed_knot, direction } where direction is a 16-point
// compass string ("ENE" etc).
//
// BOM's observations API is per-location, not a grid, so "multiple arrows
// across the map" (what the user asked for, matching BOM's own Rain radar
// page's wind density) queries a fixed grid of points spread across
// Australia rather than the small RADAR_STATIONS list (which was only ever
// meant for "nearest radar" labeling, not wind coverage). BOM's API
// resolves any geohash to its nearest real weather station internally, so
// a grid point doesn't need to land exactly on a station — it just needs
// to be close to one. Confirmed live during development: a ~3-degree grid
// (168 points) resolved to 61 distinct real stations with live wind data,
// with zero request failures even at concurrency 15 — a reasonable
// approximation of BOM's own wind-layer density, not a new scraped
// dataset.
import ngeohash from "ngeohash";
import { cached } from "./bom.ts";

const API_BASE = "https://api.weather.bom.gov.au/v1";

// Covers mainland Australia + Tasmania; 3-degree spacing was the density
// tested live (61 distinct stations from 168 points, 0 failures at
// concurrency 15) — tight enough to approximate BOM's own wind-layer
// density without the request count becoming unreasonable.
const GRID_LAT_RANGE = { min: -44, max: -10, step: 3 };
const GRID_LON_RANGE = { min: 113, max: 154, step: 3 };

function gridPoints(): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  for (let lat = GRID_LAT_RANGE.max; lat >= GRID_LAT_RANGE.min; lat -= GRID_LAT_RANGE.step) {
    for (let lon = GRID_LON_RANGE.min; lon <= GRID_LON_RANGE.max; lon += GRID_LON_RANGE.step) {
      points.push({ lat, lon });
    }
  }
  return points;
}

// BOM's location search (lib/bom.ts) already drew a live 403 under heavy
// concurrent load; 15 was tested live against this same grid size with
// zero failures, the same restraint already applied to warnings'
// RESOLVE_CONCURRENCY and FETCH_CONCURRENCY.
const FETCH_CONCURRENCY = 15;

export interface WindObservation {
  lat: number;
  lon: number;
  stationName: string;
  speedKmh: number;
  direction: string;
}

interface RawStationWind extends WindObservation {
  stationId: string;
  // BOM's own reported distance (metres) from the queried grid point to the
  // real station it resolved to — used to pick the best of several grid
  // points that happen to resolve to the same station (see dedup below),
  // since the grid point's own lat/lon (not the station's, which BOM's
  // response never includes) is what gets plotted on the map.
  distance: number;
}

async function fetchStationWind(lat: number, lon: number): Promise<RawStationWind | null> {
  const geohash = ngeohash.encode(lat, lon, 6);
  const res = await fetch(`${API_BASE}/locations/${geohash}/observations`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: {
      wind?: { speed_kilometre?: number; direction?: string };
      station?: { bom_id?: string; name?: string; distance?: number };
    };
  };
  const wind = body.data?.wind;
  const station = body.data?.station;
  // A station can have no current wind reading (confirmed live) — skipped
  // rather than shown as 0 km/h, which would misrepresent "no data" as
  // "calm". A missing bom_id is treated the same way: without it there's
  // nothing reliable to dedupe on.
  if (!wind || typeof wind.speed_kilometre !== "number" || !wind.direction || !station?.bom_id) return null;
  return {
    stationId: station.bom_id,
    distance: station.distance ?? Infinity,
    lat,
    lon,
    stationName: station.name ?? "Unknown station",
    speedKmh: wind.speed_kilometre,
    direction: wind.direction,
  };
}

export async function getWindObservations(): Promise<WindObservation[]> {
  return cached("wind-observations", 10 * 60_000, async () => {
    const points = gridPoints();
    const byStationId = new Map<string, RawStationWind>();
    for (let i = 0; i < points.length; i += FETCH_CONCURRENCY) {
      const batch = points.slice(i, i + FETCH_CONCURRENCY);
      const batchResults = await Promise.all(batch.map((p) => fetchStationWind(p.lat, p.lon)));
      for (const result of batchResults) {
        if (!result) continue;
        // Two grid points can resolve to the same real station (denser near
        // clustered weather stations); keep whichever grid point BOM
        // reports as closer, since that grid point's coordinates are the
        // best available approximation of the station's actual location —
        // showing the same station twice would look like a map error, not
        // real data density.
        const existing = byStationId.get(result.stationId);
        if (!existing || result.distance < existing.distance) {
          byStationId.set(result.stationId, result);
        }
      }
    }
    return [...byStationId.values()].map(({ stationId: _stationId, distance: _distance, ...obs }) => obs);
  });
}
