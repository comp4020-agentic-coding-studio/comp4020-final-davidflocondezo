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
    created_at TEXT NOT NULL
  )
`);

export interface Report {
  id: string;
  lat: number;
  lon: number;
  geohash: string;
  createdAt: string;
}

export function createReport(lat: number, lon: number, geohash: string): Report {
  const report: Report = {
    id: randomUUID(),
    lat,
    lon,
    geohash,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO reports (id, lat, lon, geohash, created_at)
     VALUES (@id, @lat, @lon, @geohash, @createdAt)`,
  ).run(report);
  return report;
}

export function listActiveReports(): Report[] {
  const cutoff = new Date(Date.now() - REPORT_LIFETIME_MS).toISOString();
  return db
    .prepare(
      `SELECT id, lat, lon, geohash, created_at AS createdAt
       FROM reports
       WHERE created_at > ?
       ORDER BY created_at DESC`,
    )
    .all(cutoff) as Report[];
}
