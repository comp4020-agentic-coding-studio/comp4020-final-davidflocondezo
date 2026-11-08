# Process overview

This describes the project as it stands, rewritten rather than appended to
at each crit — see the commit history for how it got here.

## Stack and workflow

[Next.js (App Router), SQLite, and Leaflet](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/8d5e902).
The deciding factor was `fly.toml`'s fixed shape — one 256MB machine, one
volume, no separate database server — which ruled out anything needing its
own DB process; SQLite is a single file that lives on that volume. BOM has no
public, CORS-enabled API, so Next's route handlers put the BOM proxy in the
same process and deploy as the frontend rather than standing up a second
service. I'd used React before but nothing else here, so the actual unknowns
were the BOM proxy, SQLite, and Leaflet, not the UI layer.

**Agentic workflow:** for anything touching more than one file, a schema
change, a new API route, or an architectural call, the agent presents a plan
and I approve before it writes code — a standing [CLAUDE.md](CLAUDE.md) rule,
tightened after crit 10 when the agent started editing files on "read the
brief" without showing a plan, reasoning the deadline justified moving fast.
I pushed back explicitly (see
[reflections/crit-10.md](reflections/crit-10.md)); that's now written down
rather than a one-off correction. A second standing rule
([4d556c6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/4d556c6))
came from a dev server left running against a `.next` directory rebuilt out
from under it.

## BOM's reverse-engineered API

BOM's search/forecast/observations/radar endpoints aren't public — search
returns no lat/lon (decoded from geohash instead), observations need a
6-char geohash where forecasts/warnings take 7, and the radar page itself is
bot-protected, so radar imagery comes from RainViewer's public API instead
([3c5e147](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/3c5e147)
fixed a related zoom-level gap). Being reverse-engineered means BOM also
rate-limits under load: warning-place resolution and the Wind/Temperature
grids all hit live 403s during testing at high concurrency, fixed by
batching (8–15 at a time) rather than firing every request at once
([797dafa](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/797dafa)).
Temperature's data source later moved off BOM to Open-Meteo entirely
([c0c050c](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/c0c050c))
— a single-request, keyless, much denser grid — once BOM's station
density proved to be the real ceiling on heat-map quality, while Wind stayed
on BOM because its popups name real stations
([95408e5](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/95408e5)),
which Open-Meteo's anonymous grid can't give.

## Warnings as approximate map circles

The first attempt shaded BOM's real forecast-district polygons, extracted
from pixel coordinates on a map image — abandoned after two calibration
attempts both left 65–80km of error with no fixable pattern, the same "don't
ship an unverifiable geometry" call already made once for the radar tile
grid. What shipped instead
([fc70955](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/fc70955))
resolves place names mentioned in each alert's `areaDesc` through the
existing location search, drawing a fixed-radius circle only around places
that actually resolve — a warning either anchors to a real, correctly-placed
location or shows nothing, never a wrong-but-confident shape. Circles are
colored by CAP severity
([48d6219](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/48d6219),
[6f5f7a8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/6f5f7a8)),
persisted across Fly's machine restarts via stale-while-revalidate rather
than a naive forever-cache, since this is safety-relevant live data.

## Real-time community reports (crit 9's concurrency feature)

Tap the map to drop a report that appears live for everyone nearby
([bd3ffdb](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/bd3ffdb),
[2669c06](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/2669c06)).
Full reasoning is in
[`docs/decisions/0001-community-reports-concurrency.md`](docs/decisions/0001-community-reports-concurrency.md):
Server-Sent Events over an in-process `EventEmitter`, not WebSockets (needs a
custom server) or polling (too chatty for one machine).

A real bug here is the clearest process lesson in this project: the feature
shipped and was marked done after verifying the POST/SSE plumbing with
`curl`, but tapping the map in a real browser did nothing — a fixed ~4km
geohash filter silently dropped pins outside a sliver smaller than a pixel at
the map's default zoom
([f81a317](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/f81a317)).
A 201 and a database row are not the same claim as "the user sees it."

## Ownership enforcement (crit 10)

Reports gained a `visitor_id` column from the existing per-browser cookie;
delete/edit check ownership inside the SQL statement itself
(`WHERE id = ? AND visitor_id = ?`), so there's no read-then-write gap a race
could land in, and confirm-once-per-visitor is a database primary key, not
application logic
([fbabe44](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/fbabe44)).
I nearly shipped a version returning each report's raw `visitor_id` to the
browser so the client could decide locally whether to show a delete button —
writing up the design, not a passing test, is what caught that it would leak
an `httpOnly` cookie's value over JSON, replayable as that cookie (see
[reflections/crit-10.md](reflections/crit-10.md)). Replaced with a
server-computed `ownedByMe` boolean.

## A CI-only build failure

`lib/db.ts` opened its SQLite connection and ran schema migrations eagerly
at module load; `next build`'s page-data step imports every route in
parallel workers just to inspect exports, so several workers opened and
migrated the same file at once — passed three local rebuilds, failed in CI.
Fixed by making the connection lazy, inside `getDb()`
([996842a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/996842a)),
so the import-only step never touches SQLite at all — not a longer timeout,
removing the condition that raced.

## Final-project features

A unified Layers panel
([2271e0e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/2271e0e))
added rings, radar coverage, and a live lightning layer over a public MQTT
relay (no key, no TLS — the same relay the Home Assistant integration uses)
to the existing always-on radar. The selected place moved into the URL as
the shareable source of truth, with localStorage as a same-browser fallback
([da6716b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/da6716b)).
A "Use my location" button re-requests geolocation on demand, with distinct
error messages per `GeolocationPositionError` code
([4bc923e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/4bc923e))
so a denied permission (fixed in site settings) reads differently from an
OS-level location service being off.

From the RICE-prioritized backlog: a UV badge and day/night map theming
(night mode is a CSS filter on the same free tiles, since every keyless
colored dark tile provider checked now gates behind an API key); multi-location
favorites, capped at 5 with oldest-dropped-first; and push notifications for
favorited locations, checked opportunistically on real traffic to the
warnings endpoint rather than a cron job, since Fly's machine scales to zero
between visits and an in-process interval wouldn't fire reliably — the
honest cost is a new warning waits for the next visitor anywhere, not a
fixed delay.

The Temperature layer went through the most iteration of any feature: a
heat-map plugin that summed overlapping points instead of blending them
([37367ce](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/37367ce)
replaced it with a hand-rolled bilinear-interpolated canvas image), clipped
to Australia's real coastline
([06e3fd4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/06e3fd4)),
and reprojected to Web Mercator after a subtle offset turned out to be plain
lat/lon degrees stretched onto a projection where latitude lines aren't
evenly spaced
([412362e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-davidflocondezo/commit/412362e)).
Each fix was root-caused by reading the actual rendered pixels or the
library's own source, not by guessing at parameters.
