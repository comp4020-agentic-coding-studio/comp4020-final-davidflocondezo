# ADR 0001: Community reports — real-time transport, scope, and persistence

## Status

Accepted (crit 9).

## Context

Crit 9 asks the app to be real-time — a change one person makes reaches
everyone else within about a second, no reload — and asks for one decision
about how the app behaves with several people in it, written down with the
options considered and what the choice costs.

The feature built for this: tapping the map drops a "community report" pin
("raining here, right now") that appears live for everyone else currently
viewing roughly the same area, persists across reloads for about two hours,
then fades out. This single feature is the answer to both spec lines — the
report pins *are* the real-time behavior, and the decisions inside how they
work are the ones this record is about.

What good means here (from `README.md`): the app answers "is it raining near
me, or about to" in one glance, for a stranger, with no account. A community
report has to support that without ever being mistaken for an official BOM
warning — if it reads as authoritative, it stops being a fast, honest glance
and starts being a liability.

## Alternative features considered before this one

Three shapes for "what happens with several people in the app at once" were
on the table; community report pins is the one built. The other two:

- **Shared prep tasks.** Checklist items ("secure outdoor items," "fuel the
  car") driven off active BOM warnings, syncing live when anyone ticks one
  off, so a household sees the same checklist state. Rejected: it only has
  anything to sync once a warning is already active and a checklist already
  exists for it — nothing for a new user to do or see on an ordinary day, and
  it answers a different question ("what should I do") than the app's stated
  one ("is it raining near me").
- **Confirm conditions inside a warning.** Within an active BOM warning area,
  people confirm what they're actually seeing ("flash flooding on Main St"),
  shown as a community layer under the official warning. Rejected for this
  crit for the same reason: it has nothing to show outside an active warning,
  so it can't be demoed, or be useful, on a day with no warnings nearby — and
  most crit demos won't coincide with a live warning.

Community report pins don't have either gap: dropping one needs nothing to
already exist (no active warning, no account, no prior setup), which is also
what should make the feature self-sustaining — the first pin is useful to the
second viewer with no bar to clear in between. That's the deciding factor
against the other two, both of which need either an existing warning or an
existing set of users before they do anything.

## Decisions and alternatives considered

### 1. Transport: Server-Sent Events, not WebSockets or polling

**Considered:**
- **WebSockets.** Full duplex, the "default" choice for real-time, but Next's
  standalone output (`.next/standalone`, run as `node server.js`, see the
  `Dockerfile`) doesn't expose a hook to upgrade a connection — doing this
  means hand-rolling a custom server and giving up the standalone build the
  rest of the deploy relies on.
- **Short polling** (client re-fetches `/api/reports` every N seconds). No
  server changes beyond what already exists, but "within about a second"
  means polling every ~1s from every open tab, which is wasteful for a
  256MB/one-machine budget (`fly.toml`) and still only approximates
  real-time rather than pushing a change the moment it happens.
- **Server-Sent Events** — a route handler returning a `ReadableStream`, kept
  open as `text/event-stream`. Fits inside a standard Next.js route handler,
  no custom server, no new dependency.

**Decision:** SSE. `app/api/reports/stream/route.ts` holds one open stream
per client; `lib/reportsBus.ts` is a single in-process `EventEmitter` that
every POST to `/api/reports` publishes to, and every open stream reads from.

**Cost:** this only works because `fly.toml` fixes `min_machines_running = 0`
and no multi-instance scaling — one machine means one in-memory
`EventEmitter` sees every request. If this app ever ran on more than one
machine, a report posted to machine A would never reach a client whose SSE
stream is held open on machine B, silently breaking the real-time guarantee
with no error anywhere. Scaling past one machine would mean replacing the
`EventEmitter` with a shared channel (e.g. Postgres `LISTEN/NOTIFY`, or
Redis pub/sub) — out of scope while the course's Fly setup is single-machine,
but the first thing to revisit if that changes.

### 2. What's live vs. what waits for reload

Only new community reports are pushed live. The weather observations,
warnings and forecast (`/api/bom/weather`) are not — they're BOM data on a
slower-moving cadence (BOM's own feeds update every ~10 minutes), and pushing
them live would mean polling BOM's reverse-engineered endpoints from the
server on every client's behalf, which risks the same rate-limit/geo-block
issues crit 8's `PROCESS.md` already ran into. A report is the one thing in
this app that is genuinely instantaneous and person-generated, so it's the
one thing made to feel that way.

**Cost:** a viewer could, in principle, see a stale temperature next to a
report posted seconds ago. Treated as acceptable — the brief's "is it raining
near me" question is answered by radar + reports together, and reports are
explicitly the faster-moving layer.

### 3. Who sees a report: geohash-prefix match, not global broadcast

Every report is broadcast to every open SSE connection (cheap at this
scale), but the client only renders one if its geohash shares a 5-character
prefix with the geohash of the place currently being viewed (`app/page.tsx`
already geohashes the viewed place at precision 6 for the visit trace in
`lib/db.ts`; reports reuse that same encoding, filtered at the coarser
5-character/~4.9km cell). A report dropped in Perth never appears on a
screen showing Canberra.

**Alternative considered:** server-side spatial filtering (only push a
report to streams whose last-known viewport is nearby). Rejected for this
scope — it would mean the server tracking each connection's current place,
adding state the simpler client-side filter doesn't need. Correct behavior
for a pod all viewing the same place at a crit demo; the cost is that every
client receives every report over the wire regardless of relevance, which is
fine at this report volume and would need revisiting at a much larger
userbase.

### 4. What a reconnecting or late-arriving viewer sees

Reports are written to the same SQLite volume as `visits`
(`/data/app.db`, the one volume `fly.toml` mounts), not held only in memory.
`GET /api/reports` returns every report younger than two hours; a client
fetches this once on load (and again on switching place) to seed pins that
existed before it connected, then relies on the SSE stream for anything
created afterward. Someone who opens the app 20 minutes after a report was
dropped sees it already there, fading, not a blank map that only catches up
on the next report.

**Cost:** this is the one place real persistence was chosen over the
simplicity of an in-memory-only board (reports living only in the
`EventEmitter`'s recent history, gone on redeploy or restart). In-memory-only
was rejected because `fly.toml`'s `auto_stop_machines = "stop"` means the one
machine goes to sleep and restarts on every period of inactivity — an
in-memory report list would be wiped far more often than the two-hour
lifetime the reports are meant to have.

### 5. Visual distinctness from an official warning

Community reports render as a small amber circle with a bound popup reading
"Community report — not verified" plus a relative timestamp, never a
red/triangle marker — the shape and color conventionally read as an official
alert. The app currently has no marker at all for BOM warnings (they render
as a plain text list), so there's no existing visual to collide with, but the
styling was still chosen with that collision in mind, so it stays unambiguous
if warnings gain their own markers later.

**Cost:** none identified; this one was closer to free given the brief's
explicit requirement, which is why it isn't treated as a live trade-off the
way 1–4 are.

## What this doesn't handle (out of scope for this crit)

No auth, no rate-limiting, no de-duplication of near-identical reports, no
way to retract a mistaken tap. Anyone can drop a report, unlimited times.
This is a scope decision, not an oversight — the brief asks for one
documented decision about concurrent behavior, not a moderation system — and
it sits alongside the login/pinned-dashboard scope note already in
`PROCESS.md` from crit 8 as a thing this version deliberately doesn't do yet.
