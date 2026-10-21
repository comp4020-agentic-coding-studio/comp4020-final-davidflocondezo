// Owns the full BOM-warnings-as-approximate-circles pipeline: fetch the CAP
// feed, resolve each alert to real places, and keep a fast path available
// across server restarts without risking showing stale safety-relevant data
// (see PROCESS.md for the full reasoning behind the stale-while-revalidate
// design below).
import { getCapAlerts } from "./capWarnings.ts";
import { getCachedWarningAreas, saveWarningAreasCache } from "./db.ts";
import { resolveWarningPlaces, type WarningPlace } from "./warningPlaces.ts";

export interface WarningArea {
  id: string;
  headline: string;
  description: string;
  instruction: string;
  severity: string;
  places: WarningPlace[];
}

// BOM's location search (lib/bom.ts, used by resolveWarningPlaces) is a
// reverse-engineered, rate-limited endpoint that already drew a live 403
// during testing under heavier concurrent load. Alerts are resolved in
// small batches rather than all at once, trading a little latency for not
// hammering a third party's API with 100+ simultaneous requests.
const RESOLVE_CONCURRENCY = 8;

async function fetchAndResolve(): Promise<WarningArea[]> {
  const alerts = await getCapAlerts();
  const resolved: WarningArea[] = [];
  for (let i = 0; i < alerts.length; i += RESOLVE_CONCURRENCY) {
    const batch = alerts.slice(i, i + RESOLVE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (alert) => ({
        id: alert.id,
        headline: alert.headline,
        description: alert.description,
        instruction: alert.instruction,
        severity: alert.severity,
        places: await resolveWarningPlaces(alert),
      })),
    );
    for (const area of batchResults) if (area.places.length > 0) resolved.push(area);
  }
  return resolved;
}

let memoryCache: { expires: number; data: WarningArea[] } | undefined;
const MEMORY_TTL_MS = 10 * 60_000;

// Prevents concurrent requests arriving during the same refresh window from
// each kicking off their own redundant fetch+resolve pass.
let inFlightRefresh: Promise<WarningArea[]> | undefined;

function refresh(): Promise<WarningArea[]> {
  if (!inFlightRefresh) {
    inFlightRefresh = fetchAndResolve()
      .then((data) => {
        memoryCache = { expires: Date.now() + MEMORY_TTL_MS, data };
        saveWarningAreasCache(data);
        return data;
      })
      .finally(() => {
        inFlightRefresh = undefined;
      });
  }
  return inFlightRefresh;
}

export async function getWarningAreas(): Promise<WarningArea[]> {
  if (memoryCache && memoryCache.expires > Date.now()) return memoryCache.data;

  // A fresh server start (Fly's machine stops and restarts on inactivity)
  // has no in-memory cache yet, but may have a persisted result from before
  // the restart. Serving that instantly, while a real refresh already runs
  // in the background, bounds how stale it can ever be to one fetch cycle
  // (~13s) — never "until the next 10-minute window," which is what made a
  // naive "cache forever across restarts" unsafe for live warning data.
  const persisted = getCachedWarningAreas();
  if (persisted) {
    void refresh();
    return persisted.data as WarningArea[];
  }

  // Nothing persisted yet at all (this machine's very first request) — the
  // only case where a caller actually waits for the full fetch.
  return refresh();
}
