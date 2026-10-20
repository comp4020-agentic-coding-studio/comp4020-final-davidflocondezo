import { EventEmitter } from "node:events";
import type { Report } from "./db.ts";

// In-process fan-out of newly created reports to every open SSE connection.
// This only works because fly.toml fixes one machine (no horizontal scaling)
// — see the crit 9 ADR for the trade-off this relies on.
export const reportsBus = new EventEmitter();
reportsBus.setMaxListeners(0);

// confirmedByMe is excluded too: it's relative to whoever created the
// report, and every connection would otherwise adopt that one value as if it
// were their own (harmless right now, since a brand-new report always has
// confirmedByMe: false, but not a guarantee worth relying on as this shape
// gets reused).
export type BroadcastReport = Omit<Report, "visitorId" | "confirmedByMe">;

// visitor_id never goes out over the broadcast: every open connection shares
// it regardless of who owns the report, and a client could otherwise read
// another visitor's id straight off the wire and replay it as their own
// cookie to claim ownership.
export function publishReport(report: Report): void {
  const { visitorId: _visitorId, confirmedByMe: _confirmedByMe, ...broadcast } = report;
  reportsBus.emit("report", broadcast);
}

export function publishReportDeleted(id: string): void {
  reportsBus.emit("report-deleted", id);
}

// Only the fields that changed, not a full report: confirmCount/description
// are shared facts, but a full Report also carries ownedByMe/confirmedByMe,
// which are relative to whoever's asking and must never be broadcast as one
// value for every connection to adopt.
export function publishReportEdited(id: string, description: string): void {
  reportsBus.emit("report-edited", { id, description });
}

export function publishReportConfirmed(id: string, confirmCount: number): void {
  reportsBus.emit("report-confirmed", { id, confirmCount });
}
