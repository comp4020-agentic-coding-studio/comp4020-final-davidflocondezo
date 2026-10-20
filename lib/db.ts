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
// `next build` can briefly open this same file from more than one worker
// while collecting route page data; without this a concurrent writer gets an
// immediate SQLITE_BUSY instead of waiting the few ms the other one needs.
db.pragma("busy_timeout = 5000");

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
// The live Fly volume already has a `reports` table from before these columns
// existed; add them for that case (CREATE TABLE IF NOT EXISTS above is a
// no-op there). Harmless to repeat once they exist.
try {
  db.exec(`ALTER TABLE reports ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
} catch {
  // column already exists
}
// Ownership for access control (crit 10): only the visitor who created a
// report may delete or edit it. A pre-existing row on the live volume has no
// owner, so it's left undeletable/uneditable by anyone rather than guessed
// at — see deleteReportIfOwner/updateReportDescriptionIfOwner and PROCESS.md.
try {
  db.exec(`ALTER TABLE reports ADD COLUMN visitor_id TEXT`);
} catch {
  // column already exists
}

// One row per (report, visitor) who confirmed it's real. The primary key is
// what makes "once per visitor" a guarantee the database enforces, not
// something an app-level check could get wrong — same reasoning as pinning
// the delete/edit ownership check inside the SQL statement itself below.
db.exec(`
  CREATE TABLE IF NOT EXISTS report_confirmations (
    report_id TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (report_id, visitor_id)
  )
`);

export interface Report {
  id: string;
  lat: number;
  lon: number;
  geohash: string;
  description: string;
  createdAt: string;
  visitorId: string;
  // Both requester-relative: computed fresh per request, never a value one
  // visitor's response could leak to another (see toPublic in
  // app/api/reports/route.ts and the SSE broadcast shapes in reportsBus.ts).
  confirmCount: number;
  confirmedByMe: boolean;
}

// A fixed length cap, enforced here (not just client-side), so the stored
// value can never grow unbounded regardless of what a client sends.
export const REPORT_DESCRIPTION_MAX_LENGTH = 280;

export function createReport(
  lat: number,
  lon: number,
  geohash: string,
  description: string,
  visitorId: string,
): Report {
  const report: Report = {
    id: randomUUID(),
    lat,
    lon,
    geohash,
    description: description.slice(0, REPORT_DESCRIPTION_MAX_LENGTH),
    createdAt: new Date().toISOString(),
    visitorId,
    // A brand-new report has no confirmations yet — no DB read needed to
    // know that.
    confirmCount: 0,
    confirmedByMe: false,
  };
  db.prepare(
    `INSERT INTO reports (id, lat, lon, geohash, description, created_at, visitor_id)
     VALUES (@id, @lat, @lon, @geohash, @description, @createdAt, @visitorId)`,
  ).run(report);
  return report;
}

export function listActiveReports(requesterId: string): Report[] {
  const cutoff = new Date(Date.now() - REPORT_LIFETIME_MS).toISOString();
  return db
    .prepare(
      `SELECT r.id, r.lat, r.lon, r.geohash, r.description,
              r.created_at AS createdAt, r.visitor_id AS visitorId,
              (SELECT COUNT(*) FROM report_confirmations c WHERE c.report_id = r.id) AS confirmCount,
              EXISTS(
                SELECT 1 FROM report_confirmations c
                WHERE c.report_id = r.id AND c.visitor_id = ?
              ) AS confirmedByMe
       FROM reports r
       WHERE r.created_at > ?
       ORDER BY r.created_at DESC`,
    )
    .all(requesterId, cutoff)
    .map((row) => ({ ...(row as Report), confirmedByMe: Boolean((row as { confirmedByMe: number }).confirmedByMe) }));
}

// `visitor_id` may be NULL on rows created before ownership existed (see the
// ALTER TABLE above) — those are nobody's to delete, which `=` naturally
// gives us since NULL never equals a real visitor id.
export function deleteReportIfOwner(id: string, visitorId: string): boolean {
  const result = deleteReportIfOwnerTxn(id, visitorId);
  return result.changes > 0;
}

// A report's confirmations have no reason to outlive the report itself; both
// rows go together or neither does.
const deleteReportIfOwnerTxn = db.transaction((id: string, visitorId: string) => {
  const result = db.prepare(`DELETE FROM reports WHERE id = ? AND visitor_id = ?`).run(id, visitorId);
  if (result.changes > 0) {
    db.prepare(`DELETE FROM report_confirmations WHERE report_id = ?`).run(id);
  }
  return result;
});

// Same shape as deleteReportIfOwner: the ownership check lives inside the
// UPDATE's WHERE clause itself, so there's no separate read-then-write step
// a race could land between.
export function updateReportDescriptionIfOwner(id: string, visitorId: string, description: string): boolean {
  const result = db
    .prepare(`UPDATE reports SET description = ? WHERE id = ? AND visitor_id = ?`)
    .run(description.slice(0, REPORT_DESCRIPTION_MAX_LENGTH), id, visitorId);
  return result.changes > 0;
}

export function reportExists(id: string): boolean {
  return db.prepare(`SELECT 1 FROM reports WHERE id = ?`).get(id) !== undefined;
}

// INSERT OR IGNORE + the (report_id, visitor_id) primary key is what makes a
// repeat confirm a no-op rather than a second row — the database enforces
// "once per visitor," not just this function's own logic.
export function confirmReport(reportId: string, visitorId: string): { added: boolean; confirmCount: number } {
  const result = db
    .prepare(`INSERT OR IGNORE INTO report_confirmations (report_id, visitor_id, created_at) VALUES (?, ?, ?)`)
    .run(reportId, visitorId, new Date().toISOString());
  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM report_confirmations WHERE report_id = ?`)
    .get(reportId) as { count: number };
  return { added: result.changes > 0, confirmCount: count };
}
