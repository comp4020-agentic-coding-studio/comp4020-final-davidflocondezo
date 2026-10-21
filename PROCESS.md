# Process overview

## Stack decision: Next.js (App Router) + SQLite + Leaflet

I'd used React before but nothing else here, so the deciding factors were
mostly about infrastructure fit rather than preference:

- **fly.toml fixes one machine, 256MB memory, one volume at `/data`, no
  separate database server.** That rules out anything needing its own DB
  process. SQLite is a single file that lives happily on that volume.
- **BOM has no public, CORS-enabled API** — the location search, forecast and
  radar data all need fetching server-side, cached, and proxied to the
  browser. Next.js's route handlers put that backend in the same process and
  the same deploy as the frontend, rather than standing up a second service
  the 256MB/one-machine budget can't really afford.
- React familiarity meant the UI layer cost nothing new to learn, leaving the
  actual new ground (the BOM proxy, SQLite, Leaflet) as the only unknowns.

Alternatives considered: SvelteKit (smaller runtime footprint, but no React
experience to carry over) and Remix (same tradeoff, different framework). Both
documented to me as viable if Next's standalone build turns out to not fit the
memory budget in practice — that's the thing to watch once this is deployed
and measured, not assumed from the spec sheet.

It's a first choice. If the real-time layer planned for a later crit doesn't
fit this shape, I'll write a new record here saying why it changed.

## Scope for crit 8: proof-of-life only

The spec for this crit only asks for signs of life — deployed, a stranger can
do the core thing, a trace persists. The brief is explicit that the feature
list (including login and a customisable pinned dashboard) can wait. I scoped
this week to: geolocation on load, search by location, radar + warnings +
forecast for the resolved place, and an anonymous cookie-based "last viewed
location" as the persisted trace — no login yet. The SQLite schema
(`lib/db.ts`) is deliberately generic (a `visits` table keyed by an opaque
visitor id) so a later crit can add a `users` table and point the same record
at a signed-in user instead of a cookie, without a schema rewrite.

## What actually broke when BOM's endpoints were tested live

The location search, forecast/observations/warnings JSON, and radar imagery
endpoints in `lib/bom.ts` are reverse-engineered, not documented by BOM. Early
on, the agent's own sandbox couldn't reach them (timeout on search, 403 on the
radar page) and it initially read that as BOM geo-blocking the whole
environment. That turned out to be specific to one fetch path, not a real
network block — direct `fetch`/`curl` calls from the same sandbox worked fine
once retried, which is what surfaced the three real issues below:

- **Search response has no `lat`/`lon` fields** — only `geohash`, `id`, `name`,
  `postcode`, `state`. The first version silently defaulted to `(0, 0)`; fixed
  by decoding lat/lon from the geohash with `ngeohash.decode` instead.
- **`/observations` requires exactly a 6-character geohash**; forecasts and
  warnings accept the 7-character one BOM's own search returns. Passing the
  7-character hash to observations returned a 400. Fixed by truncating just
  for that call.
- **Radar imagery isn't a plain file listing any more.** The original plan's
  approach — scrape `https://www.bom.gov.au/radar/` for the newest PNG — is
  blocked by Akamai bot protection (403, even with a realistic User-Agent).
  BOM's current radar page uses a WMTS tile service instead
  (`api.bom.gov.au/.../wmts/...`), but its tile grid uses a non-standard,
  Australia-cropped origin per zoom level rather than the global slippy-map
  pyramid Leaflet (and most tile-serving conventions) expect — correctly
  reverse-engineering that grid, with no browser available in the dev sandbox
  to check the result lined up visually, wasn't a safe bet for this crit's
  scope. Swapped to [RainViewer's public radar
  API](https://www.rainviewer.com/api.html) instead: documented, free, no key,
  global coverage (Australia included), standard XYZ tiles. BOM still serves
  the location search, forecast, observations and warnings — all data this
  app displays as BOM's.

**Worth a second look before this goes further:** the observations response
carries `"copyright": "This application programming interface (API) is owned
by the Bureau of Meteorology. You must not use, copy or share it."` This is a
reverse-engineered API, not a published one with its own terms — that notice
is worth weighing before this app is relied on past a classroom proof-of-life.

## Crit 9: choosing the concurrency feature

Before settling on tap-to-drop community report pins, I considered two other
shapes for "what happens when several people use this at once":

- **Shared prep tasks** — checklist items like "secure outdoor items" or "fuel
  the car," surfaced off the back of active weather warnings, that sync
  instantly when anyone ticks one off, so a household or street sees the same
  checklist state live.
- **Confirm conditions inside a warning** — when BOM has an active warning
  (e.g. a flash flood warning), people in that area can confirm what they're
  actually seeing ("flash flooding on Main St"), rendered as a community layer
  underneath the official warning rather than standing alone.

I went with the community report pins instead. Weighed against the other two,
pins are the most user-friendly entry point — tap the map, no checklist to
set up and no warning needing to already be active first — and they're the
one that asks the least of a new user while still giving something back to
everyone else looking at the same place. The shared-tasks idea only has
something to sync once someone has warnings and a household already set up;
the warning-confirmation idea only works inside an active warning area, so it
has nothing to show on an ordinary day. Pins work from the very first tap, by
anyone, anywhere — which is also what makes them the shape most likely to
actually build up a base of contributors, since there's no bar to clear
before the first person's pin is useful to the second.

## Crit 9: real-time community reports

The feature built this week — tap the map to drop a "community report" pin
that appears live for everyone viewing roughly the same area, persists across
reloads, and fades out after two hours — is this crit's answer to both of
its spec lines at once: it's the real-time mechanism, and the choices inside
how it works are the one documented concurrency decision the spec asks for.

Full reasoning, alternatives considered and costs are in
[`docs/decisions/0001-community-reports-concurrency.md`](docs/decisions/0001-community-reports-concurrency.md).
Short version: Server-Sent Events over an in-process `EventEmitter`
(`lib/reportsBus.ts`), not WebSockets (would need a custom server, losing the
standalone build) or polling (too chatty for the 256MB/one-machine budget).
Reports persist to the same SQLite volume as `visits`
(`lib/db.ts`) rather than living only in memory, because the one Fly machine
stops and restarts on inactivity (`fly.toml`'s `auto_stop_machines`) — an
in-memory board would be wiped far more often than the two-hour lifetime
reports are meant to have. The EventEmitter fan-out only works *because*
`fly.toml` fixes one machine; it would silently stop being real-time under
horizontal scaling, which is the main cost worth re-checking if that ever
changes.

Report pins are visually distinct from anything an official BOM warning
would use (amber circle, not red/triangle) and always carry an explicit
"Community report — not verified" label, so a stranger glancing at the map
can't mistake one for an authoritative alert.

**Added after the initial build: a description, and a confirm step before
creating.** Tapping the map now opens an editable popup (a short text
description plus a Create button) instead of posting immediately — nothing
is saved until Create is clicked, so an accidental tap costs nothing and a
reporter can say what they're actually seeing ("flash flooding on Main St"),
not just drop an unlabelled dot. The description is capped at 280 characters,
enforced both in the input and server-side (`lib/db.ts`,
`REPORT_DESCRIPTION_MAX_LENGTH`), and rendered through a small HTML-escaping
helper before going into a report's popup, since it's untrusted free text
from any visitor.

**Deliberately not handled this crit:** no auth, no rate-limiting, no
de-duplication, no way to retract a mistaken tap. Sits alongside the
login/pinned-dashboard scope note from crit 8 as a known gap, not an
oversight.

**Bug found after deploy: tapping the map appeared to do nothing.** I'd only
verified the POST/SSE plumbing directly (curl, a small Node script) before
reporting this feature done — never actually clicked the map in a browser.
When asked why tapping didn't seem to work, I drove the live site with
Playwright (desktop click and an emulated iPhone tap, both against
`https://comp4020-final-davidflocondezo.fly.dev/`) and found the tap *did*
POST successfully and the report *was* saved — it just never rendered,
because the client-side "is this report nearby" filter used a fixed
~4km geohash cell while the map itself opens zoomed out to ~900km across.
Tapping almost anywhere outside a sliver smaller than a pixel silently
dropped the pin with no error. Replaced that filter with a check against
Leaflet's actual visible bounds (`map.getBounds()`, re-checked on every
pan/zoom) — see `docs/decisions/0001-community-reports-concurrency.md`,
decision 3, for the full account. Lesson for this project: a 201 response
and a database row are not the same claim as "the user sees it" — the actual
UI needs driving, not just the API.

## Crit 10: ownership enforcement

The satisfy this week's brief, I decided to add a delete functionality to the weather reports but only allow the creator to delete their own reports. I also made the report's description editable by its owner only and added a validate/confirm report button that can act as an upvote that everyone can give to a report to verify it is real. This can be done once per user. The combination of the 3 provide a great response to this crit.

To achieve this the **Ownership.** `reports` gained a `visitor_id` column, set from the creating request's existing `visitor_id` cookie (`lib/visitor.ts`, already issued per browser since crit 8 for the weather trace feature — no new identity scheme needed). `DELETE /api/reports/:id` (new route,
`app/api/reports/[id]/route.ts`) checks `visitor_id` match in the SQL delete
itself (`deleteReportIfOwner`, `lib/db.ts`), so there's no window where a check passes and a later write targets a different row. A non-owner gets 403; a missing report gets a 404; the two are distinguished only after the delete already failed, so the failure path can't be used to probe which reports exist versus who owns
them beyond that.

### Server-side logging

`lib/logger.ts` writes one JSON line per server-side mutation
(`report.create`, `report.delete`, `trace.save`) to stdout: `visitorId`,
`allowed`, and the outcome. No new infrastructure — Fly retains a machine's
stdout and `flyctl logs -a <repo>` reads it after the fact, which is what
"persists beyond the crit" actually requires; a bespoke log store would be
solving a problem Fly already solves. A denied delete logs
`allowed: false` with a reason (`"not the owner"` vs `"not found"`), so the
cross-user-write failure case the brief calls out is visible in the log
stream, not just in the HTTP status code the demo would otherwise have to
narrate from a terminal running curl.

**Verified before calling this done:** two `fetch()` calls with independent
cookie jars (the same shape as two browser profiles sharing no storage) — one
creates a report, the other's delete attempt gets 403 and the report
survives, the owner's own delete then succeeds (`spec/access-control.test.ts`).
Also checked that a report payload never carries `visitorId`/`visitor_id` in
either the list response or the SSE broadcast, for both the owner and a
stranger's view of the same report.

### Description edit

The description edit is just a simple functionality that allows the creator of the weather report to edit the description in case any additional warnings or information are made available.

**Editing reuses the exact ownership shape as delete, deliberately.**
`updateReportDescriptionIfOwner` (`lib/db.ts`) puts the `visitor_id` check
inside the `UPDATE ... WHERE id = ? AND visitor_id = ?` statement itself —
same reasoning as the delete: no read-then-write gap for a race to land in.
`PATCH /api/reports/:id` (`app/api/reports/[id]/route.ts`) mirrors `DELETE`'s
403-vs-404 distinction and logs `report.edit` the same way `report.delete`
is logged. Keeping edit and delete structurally identical means there's one
pattern to get right for "only the owner may mutate this," not two.

### Once-per-user confirm

Lastly the confirm just allows users to confrim a weather warning if they are aware of it. Once per user so that it doesn't get false confirmations.

**Confirm/upvote is a different kind of server-enforced rule.** Ownership
answers "is this your own thing to change," which a client could in
principle get right on its own and the server just double-checks. "At most
once per visitor" is different: a client has no way to know whether *this*
device already confirmed without asking the server, and there's no
UI-hiding equivalent of hiding someone else's delete button — any visitor
is allowed to confirm, including the report's own creator (an explicit
choice: for an anonymous, 2-hour-lived community report, blocking
self-confirmation would mostly just be friction, not a real guarantee of
anything, since nothing stops a visitor from reporting what they can already
see is true). So this is enforced as a database constraint, not application
logic: `report_confirmations` has `PRIMARY KEY (report_id, visitor_id)`, and
`confirmReport` does `INSERT OR IGNORE` against it — a repeat confirm is a
no-op at the SQL level, not something a bug in the route handler's `if`
logic could accidentally allow twice. `POST /api/reports/:id/confirm`
(new route) always returns 200, with `confirmCount` and `confirmedByMe`; a
repeat confirm is logged as `allowed: true, reason: "already confirmed"`
rather than treated as an error, since the user's second click isn't wrong,
it's just redundant.

**Ownership vs. once-per-user both stay requester-relative, which is why
they're excluded from the SSE broadcast the same way `visitor_id` already
was.** `confirmedByMe` means something different to every open connection —
whether *that* visitor confirmed — so `publishReport` strips it just like it
strips `visitorId`, and the `confirmed`/`edited` SSE events carry only the
shared fact (`confirmCount`, `description`), never a full `Report` object a
client might otherwise naively adopt as if it applied to them too.

**Verified:** `spec/access-control.test.ts` extended to cover a non-owner's
edit being rejected (403, description unchanged) and the owner's own edit
succeeding; confirming twice from the same cookie jar holding the count at 1,
a second visitor bringing it to 2, and each visitor's own `confirmedByMe`
being correct for their own view. Manually walked the full two-visitor
sequence with independent `curl` cookie jars — create, self-confirm,
repeat-confirm (no-op), stranger-confirm, stranger-edit (403),
owner-edit (200), stranger-delete (403), owner-delete (204) — and confirmed
every step produced a distinguishable log line.

## Bug found by CI, after local testing passed: the deploy build itself

A local rebuild loop (3 runs) passed clean after the ownership work above, but
CI's own `deploy` job — which rebuilds the Docker image remotely on push —
failed with `SqliteError: database is locked` / `SQLITE_BUSY` during `next
build`'s "Collecting page data" step. Passing locally and failing in CI on the
same build command meant the race depended on timing/parallelism, not on
anything specific to my machine.

The actual cause: `lib/db.ts` opened the SQLite connection and ran its
`CREATE TABLE`/`ALTER TABLE` statements eagerly, at module load. `next
build`'s page-data step imports every route module in parallel worker
processes just to inspect its exports — it never calls anything in them —
so several workers ended up opening and migrating the same SQLite file at
once, purely as a side effect of being imported. A `busy_timeout` pragma
(added earlier, see the delete/edit section above) made this less likely by
letting a blocked writer retry for a few seconds instead of failing
immediately, but it was still a race against however many workers a given
machine spawns — it happened to lose on GitHub Actions' runner and not on
three manual attempts on my own laptop, which is exactly the kind of
intermittent failure a fixed timeout papers over rather than removes.

Fixed properly rather than raising the timeout further: `lib/db.ts` now opens
the connection and runs schema setup lazily, inside a `getDb()` called from
every exported function, instead of at the top of the module. `next build`'s
import-only page-data step never calls any of those functions, so it no
longer touches SQLite at all — the race isn't rarer, it's structurally not
possible, since the thing that was racing (multiple workers opening the file
on import) no longer happens. Verified by rebuilding 5 times in a row with no
`DATABASE_PATH` set at all — meaning the default path is `/data/app.db`,
which doesn't exist and isn't writable on my laptop, so any accidental
build-time database touch would crash loudly rather than silently coincide.
All 5 builds succeeded.

## Final project: shareable URL + localStorage for the selected place

The selected place now lives in the URL (`?place=<geohash>`) as the primary,
shareable source of truth, not just a cookie-backed server-side trace. Load
priority: the URL, then geolocation, then `localStorage`/the existing trace,
then the hardcoded default — a bookmarked link has to show what it promised
regardless of where the visitor actually is. `localStorage` writes are
wrapped in try/catch (private browsing can throw) since it's a same-browser
convenience cache, not the only copy of this state. Verified in a real
browser with Playwright against a fresh profile with no cookies: a
`?place=` URL alone reproduces the right location, and searching updates the
URL live via `router.replace` (no extra history entries, no full reload).

## Final project: BOM warnings shown as approximate map circles

The first attempt at this — shading the BOM forecast district a warning
actually applies to — used BOM's own public forecast-map pages, which embed
real district polygons as pixel coordinates on a map image. Converting those
pixel coordinates to lat/lon needed guessing at BOM's map projection, since
nothing publishes it. Two calibration attempts (a simple linear fit, then a
full affine fit, each checked against precisely located real towns) both
left 65-80km of error on towns the fit wasn't trained on, with no pattern in
the residuals that pointed to a fixable cause. Abandoned rather than ship a
shape that could misrepresent where a warning actually applies — the same
"don't ship an unverifiable geometry" call already made once for the radar
WMTS grid in crit 8.

**What shipped instead:** CAP alert text already names real places (e.g.
"Minor Flood Warning for Bulloo River to Quilpie"). `lib/warningPlaces.ts`
extracts capitalized phrases from the alert's `areaDesc` and resolves them
through the location search this app already trusts
(`searchLocations`, `lib/bom.ts`), drawing a fixed-radius circle (25km) only
around places that actually resolve — anything that doesn't match (most
coastal/marine and generic district-name warnings) falls through to the
existing text-only warnings list, unchanged. This never shows a
wrong-but-confident shape: a candidate phrase either resolves to a real,
correctly-placed location or it resolves to nothing, by construction.

Extraction deliberately reads from `areaDesc`, not `headline`. The first
version read both, and live testing against the full current alert feed (499
RSS items, 220 after dedup) surfaced a real false-positive: `headline`'s own
boilerplate ("Warning", "Severe Thunderstorm", the state name when it's
"Victoria") substring-matches real unrelated places — "Mount Warning" (NSW),
"Victoria Point" (QLD) — and those resolved as if they were the warning's
actual location. `areaDesc`'s text (after its own `State: ` prefix) never
carries that boilerplate, which eliminated both false positives without
needing a stopword list.

Two more issues only showed up under real load, not the small manual samples
checked while designing this:
- `getCapAlerts` originally fetched every RSS item's XML individually —
  ~500 requests, when the feed reissues the same alert repeatedly and only
  ~220 are actually distinct. Deduped by the RSS item's own `<title>`
  (exactly the alert's headline) before fetching any XML, roughly halving
  the fetch count and being less demanding of a free third-party feed.
- Resolving every alert's places with one unbounded `Promise.all` across
  ~220 alerts produced enough concurrent calls to BOM's location search to
  draw a live 403 from its own (separately pre-existing) Akamai protection
  during testing — and that same endpoint turned out to be intermittently
  flaky on its own, confirmed by spaced single requests several seconds
  apart still occasionally 403'ing with zero added concurrency. Fixed two
  ways: `resolveWarningPlaces` now treats a failed search the same as "no
  match" rather than letting one rejection crash the whole alert, and the
  route resolves alerts in small batches (8 at a time) instead of all at
  once, since there's no way to make an already-flaky third party reliable,
  only to stop making it worse.

A `location, { interactive: false }` was also added to the selected-location
marker: a warning circle whose place happens to be very close to the
selected location sits under that marker, and I initially suspected (wrongly
— confirmed with `document.elementFromPoint` during testing) that the marker
was eating clicks meant for the circle underneath it. The actual cause of
that specific test failure was simpler: I was clicking just outside the
circle's drawn SVG path, not actually on it. `interactive: false` is harmless
regardless (the marker has no popup of its own) and is kept as a precaution,
but the real lesson was to verify *which* layer swallowed a click
(`elementFromPoint`) before assuming why, rather than fixing the first
plausible-sounding cause.

**Verified:** typecheck/build, the full spec suite (unaffected — this is
client/warnings-only, no server behavior change to what the spec checks),
and a live Playwright run against the real current CAP feed — a known
QLD flood warning's circle opens with its full real headline, description,
emergency-services instructions, and the "approximate area, not an official
BOM boundary" disclaimer, centered correctly on the named town.

A later fix: a warning's real description/instruction text could run past
the map's own height, cut off with nothing to scroll it into view. Leaflet
already has a built-in `maxHeight` popup option that caps the popup and
applies its own `.leaflet-popup-scrolled` CSS (`overflow: auto`) once
content exceeds it — the fix was passing that option, not writing custom
CSS. Verified the content (402px) gets capped to the configured 300px with
the scrolled class present, confirming the overflow is genuinely scrollable.

## Final project: warning circles were slow, and a naive persistence fix would have been unsafe

Warning circles took 5-35s to appear after page load — slower than
acceptable, and inconsistent. Profiling found the real bottleneck:
`lib/capWarnings.ts` fetched all ~218 current CAP alerts' individual XML
documents with one unbounded `Promise.all`. Testing different concurrency
levels against *fresh, non-overlapping* URLs each time (an earlier read
using the same 60 URLs across tests was fooled by what looks like a CDN
warming its own cache, showing a false 100x speedup) found real gains up to
about concurrency 30 (~35s → ~13s), with no consistent benefit pushing
higher — and real risk of hammering a third-party feed harder for little
return, the same restraint already applied to `resolveWarningPlaces`'s
BOM-search batching.

The user separately asked whether persisting the result across server
restarts (Fly's machine stops and restarts on inactivity) could make the app
show a warning after it's been cancelled, or miss a brand-new one — asked
unprompted, and the right question to ask before building this. A naive
"cache forever across restarts" would risk exactly that: CAP alerts are
live, safety-relevant data, which is why the existing 10-minute in-memory
TTL exists at all. The version that shipped instead is stale-while-
revalidate (`lib/warningAreas.ts`, backed by a new one-row
`warning_areas_cache` table in `lib/db.ts`, same SQLite volume as
reports/trace): a fresh server start serves the last persisted result
instantly rather than blank, while a real refetch already runs in the
background and replaces both the in-memory cache and the persisted row the
moment it completes. A module-level in-flight-refresh guard means several
requests arriving during that window share one refresh rather than each
kicking off a redundant one. The only case persisted data is ever shown at
all is the very first request after a restart, and it's never stale by more
than one fetch cycle (~13s) — the same bound as normal operation, never
"until the next 10-minute window."

This also prompted consolidating logic that had drifted into two places: the
route handler previously owned the batching/resolution loop directly, and
`WarningArea` was independently declared in both the route and
`WeatherMap.tsx`. Both now live in `lib/warningAreas.ts`, with the route
reduced to a plain fetch-and-respond and the component importing the type
rather than redeclaring it.

**Verified:** typecheck/build; a fresh process with nothing persisted still
pays the real fetch cost (measured 7-24s across repeated runs — genuine
variance from two third-party services, not a regression, confirmed by
timing `getCapAlerts` and `resolveWarningPlaces` separately); a simulated
restart (same SQLite file, new process) with a prior persisted row responded
in 0.14s; the persisted row's `updated_at` timestamp was confirmed to
advance on its own shortly after, proving the background refresh actually
ran and replaced it; 5 concurrent requests fired immediately after a restart
all returned in under 0.1s with only one refresh observed, not five.

## Warning severity color-coding

`WarningArea.severity` came from the CAP alert's own `<severity>` tag and had
been parsed and threaded through the whole pipeline since the warnings work
above, but nothing rendered it — every circle used the same fixed red/orange
regardless of severity. Asked directly how severity was being
differentiated, the honest answer was "it isn't yet," which is the reason
for this pass.

CAP v1.2's `severity` is a closed enum, not an open string: `Extreme`,
`Severe`, `Moderate`, `Minor`, `Unknown`. Checked against the live feed before
designing anything: of 82 resolved warnings at the time, `Unknown: 43,
Minor: 21, Moderate: 17, Severe: 1` — `Unknown` is the largest group, not an
edge case. BOM's own feed leaves it unset more often than it sets it, which
says nothing about the warning's actual severity, so treating `Unknown` as
low-severity would misrepresent real warnings (confirmed live: a genuine
"Severe Thunderstorm Warning" near Sydney has an `Unknown` CAP severity
field). Asked the user how to handle this before implementing; confirmed
`Unknown` should keep today's existing look unchanged, not be recolored.

`app/components/WeatherMap.tsx`'s `warningCircleOptions` took no argument
before this; it now takes `severity: string` and looks up a
yellow→orange→red color pair (`SEVERITY_COLORS`, the dominant international
convention for low→high severity), falling back to the pre-existing
red/orange (`DEFAULT_SEVERITY_COLORS`) for `Unknown` or anything
unrecognized. `warningPopupHtml` gained a colored severity line under the
headline (same lookup, so popup and circle always agree), shown for every
severity including `Unknown` rather than hidden conditionally — hiding it
only for the majority case would make it look like something was omitted
rather than genuinely unspecified by BOM. This was also the user's own
request: severity needed to be conveyed as text, not only through color,
since color alone excludes colorblind users.

No other file changed — this is purely how already-fetched data renders,
not a new data source or pipeline change.

**Verified:** typecheck/build clean; live against the real feed with
Playwright — confirmed three distinct stroke colors rendering simultaneously
on the map (`#c0392b` Severe/Unknown-default, `#d68910` Moderate, `#9a7d0a`
Minor); opened popups on separate circles and confirmed the text label
matches each circle's color tier, including confirming the Unknown case
(Sydney) still reads "Unknown severity" in the unchanged default color,
and a Minor-tier circle (regional Victoria) shows "Minor severity" in the
dark-yellow tier color — a direct regression check, since `Unknown` being
the majority case means it was the one most likely to break silently; full
spec suite (`pnpm test`) still green, unaffected since this is a client-only
rendering change with no spec coverage of warning styling.

Hit the same stale-`.next`-cache issue documented in `CLAUDE.md` while
verifying this: ran `rm -rf .next && pnpm run build` for a manual check
while the `next dev` server was still running against the old build,
producing `Cannot find module './908.js'` and zero circles rendering.
Caught it from the dev log rather than guessing, killed the stale process,
and restarted cleanly — the rule earned its place in `CLAUDE.md` by catching
a real second occurrence, not just a hypothetical one.

**Follow-up:** the user asked whether the outline was the only thing
actually changing color, since at `fillOpacity: 0.15` the original design's
separate, lighter fill color per tier (`fillColor`, one shade lighter than
`color`) read as visually indistinguishable from the outline at a glance —
confirmed live (same Playwright method) that both were technically present
in the SVG but didn't read as the same color. Switched to one color per
tier used for both `color` and `fillColor`, so the circle reads as a single
coherent tint instead of a mismatched outline/fill; `fillOpacity` (still
0.15, unchanged) does the work of keeping the fill light over the map
tiles, rather than a second, paler color doing it. Verified live: stroke
and fill now match exactly on all 137 currently-live circles.
