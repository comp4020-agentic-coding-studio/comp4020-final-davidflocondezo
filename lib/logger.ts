// Structured, one-line-per-event logging to stdout. Fly captures a machine's
// stdout and keeps it queryable after the process exits (`flyctl logs -a
// <repo>`), so this is the whole persistence story — no extra sink needed to
// survive past the crit (see crit-10 spec: logging has to outlive the demo).
//
// Every entry carries `visitorId` so two people in separate browser profiles
// produce distinguishable log lines, and `action`/`allowed` so a denied
// cross-user write is visible without touching the UI.
export interface LogEvent {
  action: string;
  visitorId: string;
  allowed: boolean;
  [key: string]: unknown;
}

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}
