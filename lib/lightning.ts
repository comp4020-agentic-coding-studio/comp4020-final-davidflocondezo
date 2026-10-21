// Live lightning strikes. Blitzortung.org (the only real community lightning
// network with Australia coverage) has no public API of its own — its usage
// policy requires third parties to run their own relay rather than hit
// Blitzortung's servers directly. blitzortung.ha.sed.pl:1883 is exactly such
// a relay, run specifically to serve apps like this one (it's the backend
// behind the actively-maintained Home Assistant Blitzortung integration):
// plain MQTT, no TLS, no auth, no key. Confirmed live during development:
// subscribing to the Australia/Oceania geohash-prefix topics returned real
// AU strikes within 25s. Same risk category this app already accepts for
// BOM's own flaky, reverse-engineered API — free and real, but unofficial,
// running on a community relay with no SLA.
import mqtt, { type MqttClient } from "mqtt";
import { getCachedLightning, saveLightningCache } from "./db.ts";

const BROKER_URL = "mqtt://blitzortung.ha.sed.pl:1883";
// Geohash-prefixed topics; "q" and "r" are the geohash first-characters that
// cover Australia/Oceania, so this never subscribes to (or has to filter
// out) the rest of the world's strikes.
const TOPICS = ["blitzortung/1.1/q/#", "blitzortung/1.1/r/#"];

export interface Strike {
  lat: number;
  lon: number;
  time: number;
}

const BUFFER_MAX_AGE_MS = 30 * 60_000;
const BUFFER_MAX_COUNT = 500;
// Not every single strike — persisting on every message would mean one
// SQLite write per incoming strike, which is unnecessary for data that only
// needs to survive a restart, not be transactionally exact.
const PERSIST_INTERVAL_MS = 30_000;

let buffer: Strike[] = [];
let client: MqttClient | undefined;
let lastPersistedAt = 0;
let seededFromCache = false;

function pruneBuffer(): void {
  const cutoff = Date.now() - BUFFER_MAX_AGE_MS;
  buffer = buffer.filter((s) => s.time > cutoff);
  if (buffer.length > BUFFER_MAX_COUNT) {
    buffer = buffer.slice(buffer.length - BUFFER_MAX_COUNT);
  }
}

function maybePersist(): void {
  const now = Date.now();
  if (now - lastPersistedAt < PERSIST_INTERVAL_MS) return;
  lastPersistedAt = now;
  saveLightningCache(buffer);
}

// Never called at module load — only from inside getRecentStrikes(), the
// same lazy pattern lib/db.ts's getDb() uses. `next build`'s "Collecting
// page data" step imports every route module just to inspect its exports;
// an eager connection here would mean that import-only pass opens a live
// network socket for no reason, the same class of problem already fixed
// once for SQLite's build-time race.
function ensureConnected(): void {
  if (client) return;
  client = mqtt.connect(BROKER_URL, { reconnectPeriod: 5000 });
  client.on("connect", () => {
    client?.subscribe(TOPICS);
  });
  client.on("message", (_topic, payload) => {
    try {
      const parsed = JSON.parse(payload.toString()) as { lat?: number; lon?: number; time?: number };
      if (typeof parsed.lat !== "number" || typeof parsed.lon !== "number" || typeof parsed.time !== "number") {
        return;
      }
      // Blitzortung timestamps are nanoseconds since epoch; this app only
      // ever compares against Date.now() (milliseconds), so convert once
      // here rather than at every call site.
      buffer.push({ lat: parsed.lat, lon: parsed.lon, time: Math.floor(parsed.time / 1_000_000) });
      pruneBuffer();
      maybePersist();
    } catch {
      // Malformed payload — skip it, nothing to recover.
    }
  });
  // A relay with no SLA will sometimes be unreachable or reject the
  // connection outright; the layer just shows whatever's already buffered
  // (possibly nothing) rather than erroring the whole app, same as a failed
  // warning-areas/radar fetch degrades silently today.
  client.on("error", () => {
    // Swallow — mqtt.js already retries via reconnectPeriod.
  });
}

export function getRecentStrikes(): Strike[] {
  // On this process's very first call, seed from whatever was persisted
  // before the last restart, so a request right after a cold start sees the
  // last known strikes immediately instead of an empty layer while the new
  // MQTT subscription spins back up.
  if (!seededFromCache) {
    seededFromCache = true;
    const persisted = getCachedLightning();
    if (persisted) buffer = persisted.data as Strike[];
  }
  ensureConnected();
  pruneBuffer();
  return buffer;
}
