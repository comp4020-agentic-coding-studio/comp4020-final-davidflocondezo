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

## Final project: unified "Layers" panel (radar, rings, coverage, lightning)

The 4th item on the original Final Project list: put every map layer behind
one toggle panel. Before this, radar was the only thing that behaved like a
layer (always on, no toggle); rings, coverage, and lightning didn't exist.
"Place names" — the 5th item on the original list — was explicitly dropped
by the user for this pass.

Rings and coverage needed no new data source: rings are concentric
`L.circle`s around the selected location (50/100/150km, arbitrary round
numbers for a sense of scale), and coverage is one circle around the
nearest radar station (`nearestStation`, `lib/radarStations.ts`) at BOM's
own public "~150km generally reliable" radar-range convention — not scraped
data, no new flakiness, same `L.circle` pattern the warning circles already
established.

Lightning looked like a dead end at first (Blitzortung.org, the only real
community lightning network with Australia coverage, has no public API),
but a second, deeper research pass found a legitimate path: a public MQTT
relay at `blitzortung.ha.sed.pl:1883` (no TLS, no auth, no key), run
specifically because Blitzortung's own usage policy requires third parties
to go through a relay like this rather than hit Blitzortung's own servers —
it's the same backend the actively-maintained Home Assistant Blitzortung
integration uses. Confirmed live: subscribing to the Australia/Oceania
geohash-prefix topics (`blitzortung/1.1/q/#`, `blitzortung/1.1/r/#`)
returned real AU strikes within 25s. Same risk category this app already
accepts for BOM's own flaky, reverse-engineered API — free and real, but
unofficial, on a community relay with no SLA.

**Architecture:** `lib/lightning.ts` holds a lazy MQTT singleton, mirroring
`lib/db.ts`'s `getDb()` pattern exactly — the connection is never opened at
module load, only from inside `getRecentStrikes()`, so `next build`'s
import-only page-data-collection pass never touches the network (the same
class of problem already fixed once for SQLite's build-time race). Recent
strikes are buffered in memory (capped at 30 minutes / 500 entries) and also
persisted to a new `lightning_cache` SQLite table, same shape as
`warning_areas_cache`, so a fresh server start (Fly's machine stops and
restarts on inactivity) serves the last known strikes immediately instead
of an empty layer while the new MQTT subscription reconnects in the
background. The client polls `/api/lightning` every 20s rather than using a
second SSE connection per visitor — strikes are bursty/infrequent per area,
so sub-second latency isn't needed, and polling avoids stacking a second
long-lived per-client connection on top of the already-persistent
server-side MQTT link on a single 256MB machine.

**Lightning marker (user-requested, not in the first draft):** the user
asked for a brief pulse/highlight with a lightning-bolt icon rather than a
plain dot. This needed diffing, not clear-and-redraw: without a stable key
per strike, every 20s poll would recreate every marker and the "pulse once"
animation would replay every poll, looking like constant flashing instead
of a one-time highlight on arrival. Strikes carry no id from Blitzortung, so
one is derived from `${time}:${lat}:${lon}` and used as a new
`lightningMarkersRef: Map<string, L.Marker>` key — the same pattern
`reportMarkersRef` already uses for community reports, keyed differently
since strikes have no server-assigned id. The icon itself is an inline SVG
`divIcon` (same convention as `TRASH_ICON_SVG`/`locationIcon`/`reportIcon` —
no icon-font, no new frontend dependency): a bolt plus a ring that expands
and fades via the SVG's own `<animate>`, playing once over ~700ms when the
marker is first created.

**Toggle mechanism:** given the component's existing reliance on refs and
one big mount effect, toggles are four small, independent `useEffect`s
(radar/rings/coverage/lightning), each keyed on its own toggle boolean plus
a couple of new readiness flags (`mapReady`, `radarLoaded`) — refs alone
don't retrigger effects, so these two `useState`s exist purely to give the
toggle effects something real to depend on. This mirrors the existing
`useEffect(() => mapRef.current?.setView([lat, lon]), [lat, lon])` pattern
of small, focused effects rather than cramming more into the one big mount
effect. The panel itself (`LayersPanel.tsx`) is a plain block rendered above
the map, not an overlay on the map canvas — this app has already hit real
click/z-index fragility stacking its own DOM on top of Leaflet's panes (see
the popup event-propagation comments above), so a toggle panel avoids that
entirely by sitting outside the map in normal page flow.

**Deploy risk found and fixed before it could bite in production:** Next's
standalone output tracing (what the Dockerfile actually ships) silently
dropped `mqtt` — confirmed by inspecting `.next/standalone/node_modules`
after a real build, which never contained it despite `mqtt.connect()` being
a real runtime call. The first fix attempted (copying
`node_modules/mqtt` into the Dockerfile explicitly, the same way
`better-sqlite3`'s native binding already is) turned out to be wrong: unlike
`better-sqlite3`, `mqtt` has a real dependency tree (`ws`, `mqtt-packet`,
etc.) laid out as pnpm's nested symlinks, so copying just the top-level
package directory left dangling symlinks and a live `Cannot find module
'mqtt-packet'` error on require — confirmed by actually running it in an
isolated copy, not just trusting it should work. The real fix is
`serverExternalPackages: ["mqtt"]` in `next.config.ts`, which tells the
tracer to copy the whole resolved package tree (not just the top-level
symlink) into standalone's output. Verified by rebuilding, then testing in
a fully isolated copy outside the project tree (`rsync -a`, preserving
symlinks the way Docker's `COPY` does) with no Docker available in this
sandbox: the server booted cleanly and a live request returned real strikes.

**Verified:** typecheck/build; the standalone-output/mqtt-tracing fix above,
tested in isolation rather than assumed; a live Playwright run confirming
each toggle's exact effect (radar off/on changes the tile-layer count by
exactly 1, rings-on adds exactly 3 circle paths, coverage-on adds exactly 1
more, rings-off removes exactly 3) and confirming real lightning strikes
render with the bolt-and-pulse icon, accumulating correctly across two poll
cycles (not resetting); a simulated restart (killed and restarted the dev
server, same SQLite file) returning persisted strikes on the very first
request rather than an empty array; full spec suite green, including a new
basic check that `GET /api/lightning` always responds with a JSON array
regardless of whether the MQTT connection has actually connected yet.

**Follow-up — the icon wasn't actually noticeable:** with only one live
strike in the API response, the user went looking for it on the map and
initially thought nothing was rendering — the strike was there, but the
original icon (a thin yellow bolt outline, pulse ring fading out once over
700ms and settling to a small static shape) didn't contrast enough against
the map's own light tan/green/blue tiles, especially once the one-shot pulse
had already finished by the time anyone looked. Fixed two ways: the ring
animation now loops continuously (`repeatCount="indefinite"` on both
`<animate>`s) instead of playing once and stopping, so a strike stays easy
to spot for as long as it's on the map rather than fading into a small
static dot; and the bolt itself gained a thick white halo stroke behind a
bright, more saturated yellow fill with a dark outline, plus the pulse ring
moved to a distinct saturated orange (`#ff9100`, not reused anywhere else on
the map) — together giving the icon real contrast against every tile color
the map actually uses, not just the yellow-on-pale-green case that happened
to look fine in the original design.

Verified the new icon in isolation (a standalone HTML render, screenshotted
mid-pulse and settled) against both a pale-green and pale-tan background,
confirming it reads clearly in both; inspected the live DOM on the running
app and confirmed the real on-page markers carry the same SVG with
`repeatCount="indefinite"` actually present (not just correct in the
isolated test) and are `display: block` / `opacity: 1`; confirmed 2 `<path>`
elements (halo + bolt) render per live strike, matching the design, and that
the marker count tracks the live `/api/lightning` response.

## "Use my location" button

Geolocation was previously requested only once, automatically, on page
load (`app/page.tsx`) — if a visitor denied it then, or the browser's own
prompt timed out, there was no way back to it short of reloading the page
and hoping. The user asked for a button to re-trigger it on demand.

The existing load-time geolocation call and the new button share one
`requestLocation` function rather than duplicating the
`getCurrentPosition`/`selectPlace` logic. The one real behavioral
difference is a `silent` flag: the initial page load passes `true` (an
unprompted denial on first visit isn't something the visitor did anything
about, so it falls through to the trace/default chain quietly), while the
button passes `false` (a visitor who clicked a location button and got
denied should actually be told why, not see nothing happen).

**A hard browser limitation, not a bug:** once a site's geolocation
permission is denied, Chrome/Firefox/Safari all suppress their own
permission prompt on every later call from that page — there's no API to
force it back open. The button can detect `PERMISSION_DENIED`
(`GeolocationPositionError.code`) and tell the visitor to re-allow it in
their browser's own site settings, but it cannot itself make the browser
ask again. This is stated directly in the error message rather than
leaving the visitor to guess why clicking the button appears to do nothing.

**Verified** with Playwright using two separate browser contexts: one with
geolocation granted (a mocked Melbourne coordinate) confirmed the button
click updates the URL to `?place=<geohash>` for the new location; one with
geolocation explicitly unset (`context.setGeolocation(null)`, `permissions: []`)
confirmed the click surfaces the "blocked for this site" message in red
text, with the previously-loaded place staying on screen rather than the
page breaking or going blank.

**Follow-up — the error message wasn't specific enough:** the user hit
"Couldn't get your location — try again" in Chrome on macOS, which turned
out to be `POSITION_UNAVAILABLE` (macOS's own Location Services off, or off
specifically for Chrome, in System Settings — a different, OS-level fix
from the `PERMISSION_DENIED` site-settings case already handled). The
original code collapsed both `POSITION_UNAVAILABLE` and `TIMEOUT` into one
generic message, which gave no clue which of the two applied or where to
go fix it. Split into 3 distinct messages, one per
`GeolocationPositionError` code: `PERMISSION_DENIED` (unchanged, points at
the browser's site settings), `POSITION_UNAVAILABLE` (now points at the
OS's Location Services setting, the actual fix in this reported case), and
`TIMEOUT` (points at the network/connection instead, since it's a different
failure mode from either).

Verified by stubbing `navigator.geolocation.getCurrentPosition` directly to
fail with each of the 3 real error codes in turn (bypassing the OS/browser
permission plumbing, which can't be scripted) and confirming each one
rendered its own distinct message, not the same generic text.

## Wind layer: speed + direction, multiple arrows across the map

5th layer in the Layers panel. BOM's own observations endpoint (already
used by `lib/bom.ts`'s `getWeather`, for the temperature/warnings shown
under the map) carries wind speed and a 16-point compass direction on
every response — confirmed live:
`"wind": { "speed_kilometre": 24, "speed_knot": 13, "direction": "E" }`.
No new third-party data source, no new dependency.

Asked whether this should be one arrow at the selected location (reusing
the weather fetch `app/page.tsx` already makes) or multiple arrows spread
across the map; the user pointed at BOM's own "Rain radar and weather
maps" page, whose Wind tab shows multiple arrows nationally. BOM's
observations API is per-location, not a grid — but it resolves any geohash
to its nearest real weather station internally, so feeding each of
`lib/radarStations.ts`'s 8 existing `RADAR_STATIONS` geohashes into it
returns 8 distinct real stations spread across the country (confirmed
live: Terrey Hills, Laverton, Alexandra Hills, Mandurah, Edinburgh, Tasman
Island, Knuckey Lagoon, Cooma Airport), reusing a list that already existed
for "nearest radar" rather than needing a new station dataset.

`lib/wind.ts` fetches all 8 in parallel (a fixed, small fan-out — no
batching needed, unlike the ~220-alert warnings fetch) and skips any
station with no current wind reading (confirmed live: this does happen)
rather than showing it as 0 km/h, which would misrepresent "no data" as
"calm." Cached via the same `cached()` helper `lib/bom.ts` already
exports, 10-minute TTL matching `getWeather`'s own TTL for the same
underlying data.

Each arrow is a rotated divIcon (same inline-SVG convention as
`lightningIcon`/`locationIcon`), rotated via `COMPASS_TO_DEGREES` (all 16
points BOM's `direction` field actually uses) and colored on the same
yellow→orange→red scale already established for warning severity — faster
wind reads as "hotter" the same way a more severe warning does, reusing an
existing visual language rather than inventing a new one. Clicking an
arrow opens a popup with the exact station name, km/h, and compass
direction, matching the existing Coverage/Warning-circle pattern (asked
and confirmed) rather than an always-visible label, which would be a new
UI convention not used anywhere else in this app.

The toggle effect fetches once per toggle-on and groups the markers into an
`L.layerGroup`, removed on toggle-off via the effect's cleanup — the same
simpler fetch-and-group shape Rings/Coverage already use, not Lightning's
poll+diff: wind doesn't change on a timescale that needs refreshing while
the layer stays open, and it has none of Lightning's "don't replay the
pulse animation" constraint that forced diffing there.

**Verified:** typecheck/build; live Playwright check confirming exactly 8
arrow markers render (one per station) when the toggle is switched on,
and that clicking one opens a popup reading `"Terrey Hills: 15 km/h from
the ENE"` — matching the live API response exactly, not an approximation;
visually confirmed in a screenshot that the arrow is genuinely rotated
(not stuck pointing north) and colored distinctly from the default blue
calm-wind color; full spec suite green, unaffected (client-rendering plus
a new simple GET route, same as the other non-lightning layers have no
dedicated spec coverage).

**Follow-up — too few arrows:** the user compared against BOM's own "Rain
radar and weather maps" page's wind tab, which shows noticeably more
arrows. The original design only queried the 8 `RADAR_STATIONS` — a list
that existed for a different purpose (nearest-radar labeling) and was
never meant to represent wind-station density. Replaced that with a fixed
grid of points spread across the Australian mainland and Tasmania (3
degrees of lat/lon spacing), letting BOM's observations endpoint resolve
each grid point to its nearest real station the same way it already did
for the 8 radar stations — confirmed live before committing to this
design: a 168-point grid resolved to 61 distinct real, named stations
(Batchelor, Bulman, Gove Airport, Kalgoorlie-Boulder, etc.) with live wind
data, with zero request failures even at concurrency 15.

Asked the user to confirm the grid size (this density vs. a smaller,
cheaper grid) and whether duplicate stations should be deduplicated, since
a denser grid means two nearby points can resolve to the same real
station; both confirmed. Dedup keys on BOM's own `station.bom_id` (not
name, which could collide) and, among duplicates, keeps whichever grid
point BOM itself reports as closer to the real station (`station.distance`)
— the grid point's own coordinates are what gets plotted, since BOM's
response never includes the station's actual lat/lon, so picking the
closer-reported point is the best available approximation of where it
really sits.

Concurrency (15, same restraint `lib/capWarnings.ts`/`lib/warningPlaces.ts`
already apply to this same flaky, reverse-engineered API) keeps the ~168
requests a cache-miss now needs from hammering BOM harder than the
previous 8. Still wrapped in the same 10-minute `cached()` TTL, so a
cache-miss (the only case all 168 requests actually fire) costs ~9s in
practice, confirmed live, while every request inside that window is
near-instant.

**Verified:** typecheck/build; live `curl` confirming 56-59 distinct
stations (varies run to run with which grid points fall nearest a live
station) on a cold fetch, instant response on a cached one; Playwright
confirming the marker count jumped from 8 to ~59 and that arrows now
spread noticeably across the visible map rather than clustering on only
the old radar-station locations; full spec suite green.

**Follow-up — icon style:** the user asked for the arrows to look like
BOM's own wind layer on their "Rain radar and weather maps" page, which I
couldn't load directly (blocks automated fetches) — asked the user
directly rather than guessing, and confirmed it's a thin, unfilled line
with a small open chevron arrowhead, not a solid filled triangle (the
original design). Replaced the single filled `<path>` triangle with a
`<line>` stem plus an open, fill-none chevron `<path>`, both stroked in the
same speed-based color as before (`windColor`'s yellow→orange→red/blue
scale, unchanged) — only the shape changed, not the color logic or the
rotation-by-compass-direction logic.

Verified by rendering the new icon in isolation at 3 different rotations
first (confirming the chevron and stem both rotate together as one unit,
not independently), then inspecting the live DOM on the running app to
confirm the real markers use the new `<line>`/open-`<path>` markup (not
just the isolated test), and a cropped screenshot confirming the rendered
result reads clearly as a thin arrow, not a solid shape.

## Temperature layer: true interpolated heat map

6th Layers-panel toggle. The user asked specifically for a heat map (smooth
gradient), not per-station numeric labels — "Can we just make it a heat
map on top of the map?" — so this uses `L.heatLayer` (the `leaflet.heat`
plugin) rather than discrete circles/markers, the only exception so far to
this app's otherwise-zero-extra-frontend-deps stance. `leaflet.heat` is
tiny (6.8kB), has no transitive dependencies, is written by Leaflet's own
creator, and has `@types/leaflet.heat` declaration-merging `L.heatLayer`
onto the `leaflet` module's own types — no `any`.

BOM's observations endpoint already returns `temp` on the exact same
response as `wind` (confirmed live — both sit in `data` together), from
the same ~168-point grid `lib/wind.ts` already fetches for the Wind layer.
Rather than add a second `lib/temperature.ts` with its own grid sweep
(doubling request volume against an API already shown to rate-limit close
to that volume — see below), `lib/wind.ts`'s `WindObservation` gained one
more field, `tempC: number | undefined` (undefined when a station has no
current reading, mirroring how a missing wind reading is already skipped
rather than faked). Both layers now read from the same `/api/bom/wind`
route and the same 10-minute `cached()` TTL, so toggling Wind and
Temperature on together costs one real BOM fetch, not two.

**The grid density was tested live, not assumed**, when the user asked for
"more than 60 sparse points" to get a finer-grained heat map than Wind's
existing density: a 378-point grid failed hard (257/378 requests 403'd); a
238-point grid failed partway through (first ~165 succeeded, then every
remaining request 403'd). Both recovered within a few seconds once the
burst stopped — a burst-rate limit, not a lasting ban, consistent with
this API's known flakiness elsewhere in this project — but this confirmed
the existing 168-point grid is already very close to the real ceiling for
a single burst. Presented this evidence to the user rather than silently
picking a denser number; the user chose to keep the proven 168-point grid
over risking a denser one that would intermittently leave gaps depending
on exactly when the limit trips mid-fetch.

**Bug found and fixed: `leaflet.heat` silently did nothing (`heatLayer is
not a function`) under this app's dynamic-import pattern.** `WeatherMap.tsx`
loads Leaflet via `import("leaflet")` (needed since Leaflet touches
`window` and can't be a static import under Next.js SSR) and had been
threading the resolved module namespace object through everywhere as `L`.
`leaflet.heat`'s bundle patches `heatLayer` onto a bare, undeclared `L`
identifier that resolves against the global object — which is
`window.L`, a separate UMD backward-compat object Leaflet's own bundle
sets as a side effect of loading, *not* the ES module namespace object
`import("leaflet")` returns. Confirmed live via an object-identity check:
`importedL !== window.L`, and `importedL.heatLayer` was `undefined` while
`window.L.heatLayer` was a function. Also confirmed `window.L` has full
method parity with the imported module (`map`, `marker`, `circle`,
`tileLayer`, `divIcon`, `layerGroup`, `popup` all present as functions on
both) before relying on it. Fix: after `import("leaflet")` resolves and
`import("leaflet.heat")` runs as a side-effect import right after it, the
mount effect reassigns its working `L` reference to `window.L` and uses
that everywhere (map creation, markers, tile layers, stored in
`leafletRef`) instead of the original import result.

Color scale is a dedicated blue→red `TEMP_GRADIENT` (BOM's own
temperature-map convention: blue=cold, red=hot) passed to `L.heatLayer`'s
`gradient` option, distinct from `windColor`'s yellow→orange→red scale
even though the hue ranges overlap, since the two answer different
questions (hazard-adjacent wind speed vs. plain temperature). Raw `tempC`
values are passed directly as the heat point's intensity with `max: 45`
(a sensible ceiling for Australian conditions) rather than hand-rolling a
0–1 normalization — `L.heatLayer` already does that internally.

**Verified:** typecheck clean (`@types/leaflet.heat` resolves without
`any`); live Playwright check confirming the heat layer canvas
(`canvas.leaflet-heatmap-layer`) renders (count: 1) with zero console/page
errors after the `window.L` fix, where before the fix it silently
produced zero canvases; a screenshot visually confirming a real
blue-to-orange gradient spanning the areas with data (Sydney, Canberra,
Bendigo all distinctly colored, not just isolated dots); full spec suite
green (10/10), unaffected — client-rendering only, no new route.

**Follow-up — heat map rendered but was practically invisible:** the user
reported "I cannot see the temperature heatmap." Live pixel inspection
(reading the canvas's own `ImageData` rather than eyeballing a screenshot)
showed the canvas genuinely had a heat layer drawing, but every pixel
topped out at ~5% alpha — invisible against the base map at any reasonable
radius/blur. Tried several radius/blur combinations (60/40 up to 150/80)
live; all produced the identical ~5% ceiling, which ruled out "opacity is
just too subtle" and pointed at something capping intensity itself before
radius/blur were even applied.

Root-caused by reading `leaflet.heat`'s own bundled source rather than
guessing further: `L.HeatLayer._redraw` scales every point's intensity by
`1/2^min(options.maxZoom - map.getZoom(), 12)` — a decay meant for density
clustering (so a cluster of points looks appropriately fainter when zoomed
out across many zoom levels), not for an absolute-value layer like
temperature. `options.maxZoom` had been left unset, defaulting to the
*map's* own `maxZoom` (Leaflet's default, 18) — an 11-level gap from this
app's zoom-7 view, decaying every point to near-zero before gradient or
radius ever mattered. Confirmed via an isolated single-point test in the
live browser: the same point scored max alpha 13/255 (~5%) with the
layer's default `maxZoom`, and 164/255 (~64%) with `maxZoom` pinned to the
current zoom — an over 10x difference from one option, nothing to do with
radius/blur.

Fix: the effect now creates the heat layer with `maxZoom: map.getZoom()`
and keeps it in sync via a `zoomend` listener (`heat.setOptions({ maxZoom:
map.getZoom() })`), removed on cleanup alongside the layer itself — so the
decay factor is always 1 (no decay) at whatever zoom the user is actually
looking at, regardless of how far it is from Leaflet's internal max zoom.
Radius/blur were reverted back to their original, sensible 60/40 (the
150/80 tried while chasing the wrong cause was unnecessary once the real
bug was fixed).

**Verified:** live pixel inspection of the real app (not an isolated test)
confirmed non-zero alpha across ~32% of the canvas with max alpha 152/255
(~60%) against a full ~59-station grid fetch, and a screenshot showing
clearly visible blue/white heat blobs spread across multiple areas of the
map — a real difference from the pre-fix screenshot, which showed nothing
outside the unrelated always-on warning circles. Typecheck clean, full
spec suite green (10/10).

This diagnosis took several live-test cycles because each one restarted
the dev server, and each restart forces `lib/wind.ts`'s full 168-point
grid sweep to re-run cold — which repeatedly tripped BOM's burst rate
limit (documented in `lib/wind.ts`'s own comments) and produced partial,
misleading results (e.g. 9 stations instead of ~55, all clustered in one
region) that looked like new bugs before turning out to just be a smaller,
incomplete fetch. Letting BOM's limiter cool down and the 10-minute cache
expire naturally, instead of restarting again, eventually produced a
clean full-grid result to verify against.

**Follow-up — custom 11-band color scale:** the user asked for a specific
set of 11 RGB colors mapped to 5°C-wide bands from "<0" through "45+",
rather than the original 5-stop blue→white→red gradient. `leaflet.heat`'s
`gradient` option only accepts fractions in `[0, 1]` against a single
positive `max`, so the open-ended "<0" band required shifting the whole
scale: `TEMP_MIN_C = -5` now anchors fraction `0` (instead of 0°C), and
each of the 11 requested colors sits at its band's lower boundary
(`-5, 0, 5, ... 45` → `0.0, 0.1, 0.2, ... 1.0`). Each heat point's
intensity is `tempC - TEMP_MIN_C` (not raw `tempC`) and `max` is
`TEMP_MAX_C - TEMP_MIN_C`, so the shift is consistent on both ends rather
than only changing the gradient stops. Readings below -5°C or above 45°C
clamp to the end colors, matching the open-ended "<0"/"45+" bands as
given rather than inventing new colors past them.

**Verified:** typecheck clean; live screenshot confirming the new
teal/green/yellow palette renders (visibly distinct from the old
blue-white-orange gradient); full spec suite green (10/10, after one
transient SSE-stream test flake cleared on an isolated re-run — confirmed
unrelated to this change).

## Temperature layer: switched data source from BOM to Open-Meteo

The user compared the Temperature heat map against BOM's own temperature
map and found it visibly worse — too sparse, with large isolated blobs
instead of a continuous field — and asked whether a different data source
could give more points. The underlying constraint hadn't changed:
Temperature was riding on `lib/wind.ts`'s BOM station grid, which is
capped at a density close to BOM's burst rate-limit ceiling (documented
above), regardless of how the heat map itself was tuned.

Researched rather than guessed: **Open-Meteo** (`api.open-meteo.com`) is a
free, keyless weather API that accepts up to 1000 comma-separated lat/lon
pairs in a *single* HTTP request and returns model-interpolated current
weather for each one. Confirmed live before committing to it: a 644-point
grid across the Australia+Tasmania bounding box this app already uses
(`lib/wind.ts`'s existing bounds) returned in ~3s with 100% success — no
per-point station resolution, nothing like BOM's burst-limiting. Being
model data rather than individual station readings, it also returns a
value at *every* point, including ocean and remote inland areas lib/wind's
real-station approach has no coverage for at all — which turns out to
matter more for a smooth heat map than "real" station data does.

Free-tier limits: 600 calls/min, 5,000/hour, 10,000/day (each point in a
batch counts as one call). Asked the user directly rather than picking a
number myself: offered a safer ~400-point/hourly option (~9,600 calls/day)
against a denser ~650-point/90-minute option (~10,400 calls/day, slightly
over the stated daily cap). The user chose the denser option, preferring
map quality closer to BOM's own resolution over strict adherence to an
unenforced-in-practice daily cap (Open-Meteo's own FAQ notes the monthly
limit isn't currently enforced while their usage-stats dashboard is still
in development) — a deliberate, informed trade, not a default.

Also asked whether Wind should move to Open-Meteo too, since it returns
wind speed/direction alongside temperature and could have unified both
layers onto one source again. Decided against it: Wind's popups name real
BOM stations ("Terrey Hills: 15 km/h from the ENE"), and that's worth
keeping as genuine observed data — anonymous Open-Meteo grid points would
be a downgrade there, even though it would simplify the codebase to one
data source. **Wind stays on BOM; only Temperature moved.**

New `lib/temperature.ts` mirrors `lib/wind.ts`'s existing conventions
(grid generation over the same bounding box, `cached()` reuse from
`lib/bom.ts`) but is simpler — one HTTP request for the whole grid, not
N per-point requests, so no concurrency batching or station-dedup logic is
needed. New `app/api/bom/temperature/route.ts` is a thin proxy, same shape
as the existing `app/api/bom/wind/route.ts`. `lib/wind.ts`'s `tempC` field
(added when Temperature first piggybacked on it) was removed — Wind is
wind-only again. `WeatherMap.tsx`'s Temperature effect now fetches
`/api/bom/temperature` instead of `/api/bom/wind`; the heat-map rendering
itself (gradient, the zoom-decay fix, radius/blur) didn't need to change,
since all of that is about `leaflet.heat` and is independent of where the
points come from.

**Verified:** typecheck clean; live `curl` confirming 644 points across
the full lat/lon bounding box (including areas BOM's grid has no coverage
for) in a single ~3s request; live Playwright pixel inspection showing
heat-layer canvas coverage jumped from ~32% (BOM, sparse blobs) to ~99.7%
(Open-Meteo, a genuinely continuous field) with zero console/page errors;
a zoomed-out screenshot showing a smooth, physically plausible
inland-hot/coastal-cooler gradient, closer to BOM's own temperature map
in character than the previous sparse version; confirmed Wind still works
independently afterward (61 arrow markers, real station-named popup
unaffected by the Temperature change); full spec suite green (10/10,
after the same known-flaky SSE-stream test cleared on an isolated re-run).

## Temperature layer: `leaflet.heat` replaced with a hand-rolled interpolated image

After the Open-Meteo switch above, the user reported the heat map had
regressed to "just a big square of colour ontop of australia" — not sparse
blobs this time, a flat saturated block. Investigated live rather than
guessing: pixel-inspecting the real canvas found 36% of pixels at zoom 4
pinned to exactly the hottest gradient color, a literal flat region, not a
visibility/opacity issue (ruling out the kind of bug the two earlier
Temperature write-ups above both turned out to be).

Root cause, found by reading `leaflet.heat`'s own bundled source directly
rather than tuning parameters blind: `L.HeatLayer._redraw` stamps every
point as a soft circle and **sums** overlapping circles' intensity — it's a
density-clustering algorithm ("more points here = hotter"), correct for
sparse event data, but wrong for data where every point already carries a
real value to be *blended*, not counted. BOM's old ~60-station grid never
exposed this (points were ~300km+ apart, circles rarely overlapped).
Open-Meteo's dense 644-point grid (~165km spacing) overlaps heavily,
especially zoomed out where more points fit on screen — summed intensity
blows past the gradient's `max` and flattens whole regions to one color.

Tried tuning around it before concluding the algorithm itself was the
wrong fit: a fixed smaller radius (60→40→25→15→10) either still saturated
or, once small enough to stop overlapping, rendered as isolated unblended
dots with visible quarter-circle "waffle" edges from each point's own
shadow-stamp shape; a radius rescaled per zoom to match on-screen grid
spacing reduced saturation but kept the waffle artifacts and an inflated
"everything looks hot" bias from the residual summing; tiny radius with
huge blur dropped opacity below visibility entirely. No parameter
combination worked at both normal and zoomed-out views at once, because
the bug was the summing, not any one setting.

Presented this finding and three fix options to the user; chosen: drop
`leaflet.heat` for Temperature entirely and render a custom
bilinear-interpolated image instead. Since Open-Meteo's grid is a perfect
regular lat/lon rectangle, standard bilinear interpolation between the 4
nearest grid points gives a correct, smooth value anywhere — it blends,
never sums, so it cannot saturate by construction. `WeatherMap.tsx` now
reshapes the flat `/api/bom/temperature` response into a 2D grid (row-major,
matching `lib/temperature.ts`'s own `gridPoints()` generation order),
builds an offscreen `<canvas>` where each pixel is bilinearly sampled and
colored via the existing 11-stop RGB scale (unchanged — only how it's
applied per-pixel changed, from handing it to `leaflet.heat`'s `gradient`
option to a manual linear interpolation between adjacent stops), and places
the resulting data URL on the map with Leaflet's own `L.imageOverlay`
(core Leaflet, not a plugin) stretched to the grid's exact lat/lon bounds.
This also removed the `leaflet.heat`/`@types/leaflet.heat` dependency
entirely (confirmed unused elsewhere via grep) along with the `window.L`
ES-module workaround that existed solely to reach the plugin's
global-patching behavior, and the `maxZoom`/`zoomend`-sync hack from the
earlier zoom-decay fix — none of that is relevant to a plain image overlay,
which Leaflet already scales and repositions on pan/zoom like any other
layer (the same way the existing radar tile layer already behaves).

A related correctness bug surfaced while implementing this: reshaping a
flat array back into a row-major grid requires every position to be
preserved, but `getTemperatureObservations()` had been filtering out
missing readings — doing that would silently shift every later point into
the wrong grid cell. Fixed by changing `TemperatureObservation.tempC` to
`number | null` and preserving the full array length/order; `null` entries
are filled by averaging their immediate grid neighbors (falling back to
the grid's overall average if all neighbors are also missing) before
interpolation, rather than being coerced to 0.

**Verified:** `pnpm exec tsc --noEmit` clean; live Playwright screenshots
at both the app's normal zoom (7) and zoomed further out (the view where
the old bug was worst) show a smooth, continuous gradient with no flat
saturated block and no visible per-grid-cell boundaries — confirmed via
the `.leaflet-image-layer` element rendering (count: 1) with zero
console/page errors; spot-checked the live color scale against the
current data's actual hottest (39.5°C → RGB [176,76,6], correctly between
the 35-40/40-45 deep-orange stops) and coolest (6.4°C → RGB [64,181,165],
correctly in the 5-10 teal/green band) points; confirmed Wind is
unaffected (separate code path, untouched by this change — a live check
during this verification round hit a 403 from BOM's own API directly,
unrelated to any code here, consistent with the burst-rate-limit behavior
already documented for that API elsewhere in this file); full spec suite
green (10/10).

## Temperature layer: clipped to Australia's real coastline

The user pointed out the heat map (correct colors, correct gradient after
the fix above) still rendered as a square over the continent — the
Open-Meteo grid's lat/lon bounding box, with no masking of any kind. Asked
for the overlay to follow Australia's actual outline instead.

Researched a data source rather than hand-drawing one: **Natural Earth's
1:110m Admin-0 Countries dataset** is explicitly public domain (no
attribution required) and its Australia feature (mainland + Tasmania, 2
rings, 241 points total) is small enough to vendor directly — extracted
from the GeoJSON mirror at `github.com/nvkelso/natural-earth-vector` down
to just the geometry (no properties), it's ~5.8KB as a plain array. A finer
50m-resolution version exists (~46.6KB, 42 polygons incl. minor islands) if
the 110m outline ever looks too coarse, but 110m already reads clearly as
Australia's real coastline at this app's zoom levels. New `lib/australiaOutline.ts`
holds it as a plain exported constant — matching `lib/radarStations.ts`'s
existing convention for small embedded geographic data — rather than a
`public/*.json` fetched asset, keeping it synchronous with no extra
network request on every render. No new npm dependency: the repo had zero
geo/GIS packages already, and a whole-world dataset package just to
extract one country would be unnecessary weight for ~6KB of data.

**Clipping technique:** `buildTemperatureImage` already draws the full
rectangular color grid into an offscreen canvas before calling
`toDataURL()`. After the existing `putImageData` call, each outline ring is
traced as a subpath of one `Path2D` (mapping `[lon, lat]` to pixel space
with the exact inverse of the bilinear sampling loop's own index math), and
`ctx.globalCompositeOperation = "destination-in"` followed by `ctx.fill(path)`
keeps only the pixels already drawn that fall inside either ring, making
everything else transparent. This is the standard canvas technique for
masking an already-rendered image to an arbitrary shape — no second canvas,
no library, and it composes directly with the existing pixel-writing loop
rather than requiring a redraw.

**Verified:** `pnpm exec tsc --noEmit` clean; live Playwright screenshots
at the app's normal zoom and zoomed out to see the whole country confirm
the heat color now stops exactly at the coastline (visible directly near
Sydney/Wollongong, where color ends and the blue ocean basemap begins) and
the zoomed-out silhouette reads unmistakably as Australia's real shape,
not a rectangle; a cropped, 3x-zoomed screenshot of the Tasmania region
confirms its ring is independently clipped to its own island outline, not
merged into or excluded from the mainland's mask; full spec suite green
(10/10); confirmed no leftover debug code via grep.

**Follow-up — the clipped heat map was offset down slightly.** The user
noticed the colored region sat a little below where it should against the
real coastline. Root cause: `lib/temperature.ts`'s grid steps 1.5° over a
34° latitude span and a 41° longitude span — neither span is an exact
multiple of 1.5, so `gridPoints()`'s loop stops one step short of the
*nominal* `GRID_LAT_RANGE.min`/`GRID_LON_RANGE.max` rather than reaching
them exactly (confirmed by running the loop: the real southernmost sampled
row is lat -43, not the configured -44; the real easternmost column is
lon 153.5, not 154). Both the `imageOverlay`'s bounds and the Australia
outline's lon/lat-to-pixel clip-path math had been using the nominal range
directly, stretching the image (and its clip mask) over up to 1° of space
with no actual sample data — shifting the true content down and very
slightly left of where it was drawn.

Fixed by adding `GRID_LAT_MIN`/`GRID_LON_MAX` to `lib/temperature.ts`,
derived with the same arithmetic that already produces `GRID_ROWS`/
`GRID_COLS` (the grid's real edges, not the configured ones), and using
those instead of the nominal `GRID_LAT_RANGE.min`/`GRID_LON_RANGE.max`
everywhere `WeatherMap.tsx` places or clips the rendered image — the
overlay bounds and the clip-path pixel mapping now agree on the exact same
coordinate space the data actually occupies.

**Verified:** typecheck clean; live screenshots at both zoom levels
confirm the coastline boundary (checked directly against Sydney/
Wollongong) now hugs the real coast more precisely than before the fix;
re-checked the Tasmania crop specifically, since the 1° latitude error was
largest at the grid's southern edge; full spec suite green (10/10).

**Follow-up — still offset after the bounds fix, a second, different bug.**
The user reported the heat color was still shifted down slightly even
after the grid-edge fix above. Investigated rather than assuming that fix
was simply incomplete: read Leaflet's own `ImageOverlay._reset()` source
directly and confirmed `L.imageOverlay` does a flat corner-to-corner
stretch — it projects only the bounds' two corner points, then CSS-
stretches the raw bitmap between them, with no per-pixel reprojection of
the image's own content. The map renders in Web Mercator, where latitude
lines are *not* evenly spaced in screen pixels (spacing grows away from
the equator), but `buildTemperatureImage`'s rows were laid out evenly
spaced in plain degrees (matching the Open-Meteo grid) and then handed to
`imageOverlay` to be stretched as if already Mercator-even.

Quantified rather than assumed: over Australia's real span (lat -10° to
-43°), the gap between "linear in degrees" and "linear in true Mercator"
peaks at ~3.8% of the image's height, centered right around lat -27° to
-35° — almost exactly the Sydney/Canberra/Melbourne band, which is why the
earlier reports specifically described that area as shifted rather than a
uniform, easy-to-spot offset. This is a distinct bug from the grid-edge
one above: that one was a constant error in where the whole image's bounds
sit; this one is a latitude-dependent distortion of the image's own
internal content, present even with perfectly correct bounds. Longitude
needed no equivalent fix, since Mercator's x-axis is already linear in
longitude.

Fixed by adding `mercatorY`/`latAtMercatorFraction` helpers to
`WeatherMap.tsx` and using them to convert each output pixel row's
fractional position to a true latitude (then to a grid-row index) before
sampling, instead of assuming linear-degree spacing — and applying the
same conversion to the Australia outline's clip-path latitude mapping, so
the color data and the coastline mask stay aligned with each other.

**Verified:** typecheck clean; live screenshot at the app's normal zoom
shows the coastline boundary hugging the real coast from Newcastle through
Sydney and Wollongong noticeably more tightly than before this fix;
zoomed-out screenshot still reads as Australia's correct silhouette; the
Tasmania crop looks essentially unchanged from before this fix, as
predicted (the Mercator/degree gap returns to zero at the grid's own
top/bottom bounds, so the correction is concentrated in the mid-latitude
band, not the edges); full spec suite green (10/10).
