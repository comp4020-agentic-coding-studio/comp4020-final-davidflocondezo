import { EventEmitter } from "node:events";
import type { Report } from "./db.ts";

// In-process fan-out of newly created reports to every open SSE connection.
// This only works because fly.toml fixes one machine (no horizontal scaling)
// — see the crit 9 ADR for the trade-off this relies on.
export const reportsBus = new EventEmitter();
reportsBus.setMaxListeners(0);

export function publishReport(report: Report): void {
  reportsBus.emit("report", report);
}
