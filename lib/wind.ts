// Wind speed/direction for the "Wind" map layer. No new data source: BOM's
// own observations endpoint (lib/bom.ts getWeather already fetches it for
// the selected place) carries wind on every response — confirmed live:
// { speed_kilometre, speed_knot, direction } where direction is a 16-point
// compass string ("ENE" etc).
//
// BOM's observations API is per-location, not a grid, so "multiple arrows
// across the map" (what the user asked for, matching BOM's own Rain radar
// page) reuses the existing RADAR_STATIONS list as the set of points: BOM's
// API resolves any geohash to its nearest real weather station internally,
// so feeding each radar station's geohash in returns 8 distinct real
// stations spread across the country — confirmed live (Terrey Hills,
// Laverton, Alexandra Hills, Mandurah, Edinburgh, Tasman Island, Knuckey
// Lagoon, Cooma Airport), not a new station dataset.
import ngeohash from "ngeohash";
import { cached } from "./bom.ts";
import { RADAR_STATIONS } from "./radarStations.ts";

const API_BASE = "https://api.weather.bom.gov.au/v1";

export interface WindObservation {
  lat: number;
  lon: number;
  stationName: string;
  speedKmh: number;
  direction: string;
}

async function fetchStationWind(lat: number, lon: number): Promise<WindObservation | null> {
  const geohash = ngeohash.encode(lat, lon, 6);
  const res = await fetch(`${API_BASE}/locations/${geohash}/observations`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: {
      wind?: { speed_kilometre?: number; direction?: string };
      station?: { name?: string };
    };
  };
  const wind = body.data?.wind;
  // A station can have no current wind reading (confirmed live on one of
  // the 8 during development) — skipped rather than shown as 0 km/h, which
  // would misrepresent "no data" as "calm".
  if (!wind || typeof wind.speed_kilometre !== "number" || !wind.direction) return null;
  return {
    lat,
    lon,
    stationName: body.data?.station?.name ?? "Unknown station",
    speedKmh: wind.speed_kilometre,
    direction: wind.direction,
  };
}

export async function getWindObservations(): Promise<WindObservation[]> {
  return cached("wind-observations", 10 * 60_000, async () => {
    // Fixed, small fan-out (8 requests) — no batching needed, unlike the
    // ~220-alert warnings fetch this app already had to throttle.
    const results = await Promise.all(RADAR_STATIONS.map((s) => fetchStationWind(s.lat, s.lon)));
    return results.filter((r): r is WindObservation => r !== null);
  });
}
