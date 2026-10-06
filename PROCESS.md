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

## How I directed, grounded and corrected the work

[To be filled in with commit links as the build progresses — markers follow
the links given here, not a general trawl of the repo.]
