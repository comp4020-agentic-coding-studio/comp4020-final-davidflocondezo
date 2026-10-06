// Proxy + short cache for BOM's own location/weather endpoints. None of
// these are an official, documented API — they're the ones community
// weather tools have reverse-engineered from weather.bom.gov.au. Confirmed
// live against the real API during implementation (see PROCESS.md): search
// results carry no lat/lon (decoded from the geohash instead), and
// observations strictly requires a 6-character geohash while forecasts and
// warnings accept the fuller one BOM's search returns.
import ngeohash from "ngeohash";

const API_BASE = "https://api.weather.bom.gov.au/v1";

const cache = new Map<string, { expires: number; data: unknown }>();

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data as T;
  const data = await fetcher();
  cache.set(key, { expires: Date.now() + ttlMs, data });
  return data;
}

export interface LocationResult {
  geohash: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export async function searchLocations(query: string): Promise<LocationResult[]> {
  return cached(`search:${query}`, 60_000, async () => {
    const res = await fetch(`${API_BASE}/locations?search=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`BOM location search failed: ${res.status}`);
    const body = (await res.json()) as {
      data: { geohash: string; name: string; state: string }[];
    };
    return body.data.map((d) => {
      const { latitude, longitude } = ngeohash.decode(d.geohash);
      return { geohash: d.geohash, name: d.name, state: d.state, lat: latitude, lon: longitude };
    });
  });
}

export interface Weather {
  forecast: unknown;
  observations: unknown;
  warnings: unknown;
}

export async function getWeather(geohash: string): Promise<Weather> {
  return cached(`weather:${geohash}`, 10 * 60_000, async () => {
    // Observations rejects anything but exactly 6 characters; forecasts and
    // warnings accept the longer geohash BOM's own search returns.
    const observationsGeohash = geohash.slice(0, 6);
    const [forecast, observations, warnings] = await Promise.all([
      fetch(`${API_BASE}/locations/${geohash}/forecasts/daily`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`${API_BASE}/locations/${observationsGeohash}/observations`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`${API_BASE}/locations/${geohash}/warnings`).then((r) => (r.ok ? r.json() : null)),
    ]);
    return { forecast, observations, warnings };
  });
}
