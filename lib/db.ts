import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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

// Community reports: unverified, user-dropped pins ("raining here right
// now"). Kept in the same SQLite volume as `visits` so a reconnecting viewer
// sees recent reports rather than starting from a blank map (see PROCESS.md,
// crit 9 decision). Expiry is enforced here so a stale report can never leak
// out of `listActiveReports`, even if a client's own fade logic is wrong or
// skipped.
export const REPORT_LIFETIME_MS = 2 * 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    geohash TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )
`);
// The live Fly volume already has a `reports` table from before this column
// existed; add it for that case (CREATE TABLE IF NOT EXISTS above is a no-op
// there). Harmless to repeat once it exists.
try {
  db.exec(`ALTER TABLE reports ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}

export interface Report {
  id: string;
  lat: number;
  lon: number;
  geohash: string;
  description: string;
  createdAt: string;
}

// A fixed length cap, enforced here (not just client-side), so the stored
// value can never grow unbounded regardless of what a client sends.
export const REPORT_DESCRIPTION_MAX_LENGTH = 280;

export function createReport(
  lat: number,
  lon: number,
  geohash: string,
  description: string,
): Report {
  const report: Report = {
    id: randomUUID(),
    lat,
    lon,
    geohash,
    description: description.slice(0, REPORT_DESCRIPTION_MAX_LENGTH),
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO reports (id, lat, lon, geohash, description, created_at)
     VALUES (@id, @lat, @lon, @geohash, @description, @createdAt)`,
  ).run(report);
  return report;
}

export function listActiveReports(): Report[] {
  const cutoff = new Date(Date.now() - REPORT_LIFETIME_MS).toISOString();
  return db
    .prepare(
      `SELECT id, lat, lon, geohash, description, created_at AS createdAt
       FROM reports
       WHERE created_at > ?
       ORDER BY created_at DESC`,
    )
    .all(cutoff) as Report[];
}
