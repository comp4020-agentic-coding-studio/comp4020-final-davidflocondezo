import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// /data is the one volume that survives a restart or redeploy (fly.toml).
// Locally this falls back to a gitignored file next to the repo.
const path = process.env.DATABASE_PATH ?? "/data/app.db";

mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma("journal_mode = WAL");

// Deliberately generic: a later crit adds a users table and repoints this at
// a signed-in user instead of a cookie, without a schema rewrite.
db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    visitor_id TEXT PRIMARY KEY,
    geohash TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

export interface Trace {
  geohash: string;
  name: string;
  lat: number;
  lon: number;
}

export function getTrace(visitorId: string): Trace | undefined {
  const row = db
    .prepare("SELECT geohash, name, lat, lon FROM visits WHERE visitor_id = ?")
    .get(visitorId) as Trace | undefined;
  return row;
}

export function saveTrace(visitorId: string, trace: Trace): void {
  db.prepare(
    `INSERT INTO visits (visitor_id, geohash, name, lat, lon, updated_at)
     VALUES (@visitorId, @geohash, @name, @lat, @lon, @updatedAt)
     ON CONFLICT(visitor_id) DO UPDATE SET
       geohash = excluded.geohash,
       name = excluded.name,
       lat = excluded.lat,
       lon = excluded.lon,
       updated_at = excluded.updated_at`,
  ).run({ visitorId, ...trace, updatedAt: new Date().toISOString() });
}
