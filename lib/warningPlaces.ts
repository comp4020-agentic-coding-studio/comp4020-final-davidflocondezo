// Neither BOM's warnings API nor the CAP feed carries polygon/circle
// geometry (confirmed live against real alerts — see PROCESS.md). Instead,
// this resolves the real place names already present in an alert's own text
// (e.g. "Minor Flood Warning for Bulloo River to Quilpie") through the
// location search this app already trusts (lib/bom.ts searchLocations),
// and only ever shows a place once it's a confirmed, correctly-placed
// result — never a guessed shape. Alerts naming no resolvable place (most
// coastal/marine and district-level warnings, e.g. "Cape Naturaliste",
// "Northern Tablelands") simply resolve to zero places; the caller's
// existing text-only warnings list is the fallback for those, unchanged.
import type { CapAlert } from "./capWarnings.ts";
import { searchLocations } from "./bom.ts";

const STATE_ABBREVIATIONS: Record<string, string> = {
  "New South Wales": "NSW",
  Victoria: "VIC",
  Queensland: "QLD",
  "Western Australia": "WA",
  "South Australia": "SA",
  Tasmania: "TAS",
  "Australian Capital Territory": "ACT",
  "Northern Territory": "NT",
};

// 1-3 consecutive capitalized words — deliberately naive. Confirmed live
// that both a real town name ("Quilpie") and non-place phrases ("Bulloo
// River") come back as cleanly distinguishable outcomes from
// searchLocations (an exact match vs. an empty result), so there's nothing
// to gain from smarter extraction up front.
const CANDIDATE_PHRASE = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g;

const MAX_PLACES_PER_ALERT = 3;

export interface WarningPlace {
  lat: number;
  lon: number;
  name: string;
}

export async function resolveWarningPlaces(alert: CapAlert): Promise<WarningPlace[]> {
  const expectedAbbreviation = STATE_ABBREVIATIONS[alert.state];
  if (!expectedAbbreviation) return [];

  // areaDesc only, not headline: confirmed live that headline's BOM
  // boilerplate ("Warning", "Severe Thunderstorm", the state name itself
  // when it's "Victoria") substring-matches real unrelated places ("Mount
  // Warning" NSW, "Victoria Point" QLD) and gets through as a false
  // positive. areaDesc's remainder after the state-name prefix (already
  // split off above) is consistently just the district/place text BOM
  // itself uses, with none of headline's generic alert-type words.
  const remainder = alert.areaDesc.split(":").slice(1).join(":").trim();
  const candidates = [...new Set(remainder.match(CANDIDATE_PHRASE) ?? [])];

  const places: WarningPlace[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (places.length >= MAX_PLACES_PER_ALERT) break;
    let results;
    try {
      results = await searchLocations(candidate);
    } catch {
      // BOM's search is a reverse-engineered, rate-limited endpoint (see
      // lib/bom.ts) — with ~200 alerts potentially resolving concurrently
      // (app/api/bom/warning-areas/route.ts), a burst of requests can get a
      // transient 403. One candidate failing to resolve isn't a reason to
      // drop the whole alert; it's treated the same as a candidate that
      // legitimately matched no place.
      continue;
    }
    // A candidate phrase can match a same-named place in another state (or
    // several places in the same state); only the state-matching ones are
    // trustworthy here, and only the first keeps results predictable rather
    // than silently picking whichever the API lists first.
    const match = results.find((r) => r.state === expectedAbbreviation);
    if (!match || seen.has(match.geohash)) continue;
    seen.add(match.geohash);
    places.push({ lat: match.lat, lon: match.lon, name: match.name });
  }
  return places;
}
