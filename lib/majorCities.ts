import ngeohash from "ngeohash";

// The 8 state/territory capitals plus regional centres — the same
// "always-on, pick a recognisable set of places" role lib/radarStations.ts's
// list plays for radar coverage, not an attempt at a complete gazetteer.
// Picked for name recognition and geographic spread across every state/
// territory, weighted by land area rather than population alone — WA, SA and
// NT cover most of the continent but have far fewer population centres than
// the eastern states, so an even-per-state count would leave huge stretches
// of map with no label at all. Each city's geohash is precomputed (not
// derived at render time) since it's what /api/bom/weather actually keys its
// cache and upstream requests on.
export interface MajorCity {
  name: string;
  state: string;
  lat: number;
  lon: number;
  geohash: string;
}

const RAW_CITIES: { name: string; state: string; lat: number; lon: number }[] = [
  // Capitals
  { name: "Sydney", state: "NSW", lat: -33.8688, lon: 151.2093 },
  { name: "Melbourne", state: "VIC", lat: -37.8136, lon: 144.9631 },
  { name: "Brisbane", state: "QLD", lat: -27.4698, lon: 153.0251 },
  { name: "Perth", state: "WA", lat: -31.9523, lon: 115.8613 },
  { name: "Adelaide", state: "SA", lat: -34.9285, lon: 138.6007 },
  { name: "Hobart", state: "TAS", lat: -42.8821, lon: 147.3272 },
  { name: "Darwin", state: "NT", lat: -12.4634, lon: 130.8456 },
  { name: "Canberra", state: "ACT", lat: -35.2809, lon: 149.13 },
  // Regional centres
  { name: "Gold Coast", state: "QLD", lat: -28.0167, lon: 153.4 },
  { name: "Newcastle", state: "NSW", lat: -32.9283, lon: 151.7817 },
  { name: "Wollongong", state: "NSW", lat: -34.4278, lon: 150.8931 },
  { name: "Geelong", state: "VIC", lat: -38.1499, lon: 144.3617 },
  { name: "Townsville", state: "QLD", lat: -19.259, lon: 146.8169 },
  { name: "Cairns", state: "QLD", lat: -16.9186, lon: 145.7781 },
  { name: "Toowoomba", state: "QLD", lat: -27.5598, lon: 151.9507 },
  { name: "Ballarat", state: "VIC", lat: -37.5622, lon: 143.8503 },
  { name: "Bendigo", state: "VIC", lat: -36.757, lon: 144.2794 },
  { name: "Launceston", state: "TAS", lat: -41.4332, lon: 147.1441 },
  { name: "Mackay", state: "QLD", lat: -21.155, lon: 149.186 },
  { name: "Rockhampton", state: "QLD", lat: -23.3791, lon: 150.51 },
  { name: "Bunbury", state: "WA", lat: -33.3267, lon: 115.6372 },
  { name: "Alice Springs", state: "NT", lat: -23.698, lon: 133.8807 },
  { name: "Wagga Wagga", state: "NSW", lat: -35.1082, lon: 147.3598 },
  { name: "Albury", state: "NSW", lat: -36.0737, lon: 146.9135 },
  { name: "Coffs Harbour", state: "NSW", lat: -30.2963, lon: 153.1157 },
  // WA, SA and NT are geographically huge but were left with only one or two
  // points each above — filled out so a visitor panning/zooming into any of
  // them sees labels too, not just empty space between the capital and the
  // map's edge.
  { name: "Geraldton", state: "WA", lat: -28.7774, lon: 114.6128 },
  { name: "Kalgoorlie", state: "WA", lat: -30.7489, lon: 121.4656 },
  { name: "Broome", state: "WA", lat: -17.9644, lon: 122.2304 },
  { name: "Port Hedland", state: "WA", lat: -20.3167, lon: 118.5667 },
  { name: "Albany", state: "WA", lat: -35.0269, lon: 117.8837 },
  { name: "Mount Gambier", state: "SA", lat: -37.8284, lon: 140.7828 },
  { name: "Whyalla", state: "SA", lat: -33.0333, lon: 137.5667 },
  { name: "Port Augusta", state: "SA", lat: -32.4925, lon: 137.7656 },
  { name: "Katherine", state: "NT", lat: -14.4667, lon: 132.2667 },
  { name: "Tennant Creek", state: "NT", lat: -19.6531, lon: 134.1897 },
];

// BOM's observations endpoint strictly requires a 6-character geohash (see
// lib/bom.ts's own comment); forecasts/warnings accept this same length fine.
export const MAJOR_CITIES: MajorCity[] = RAW_CITIES.map((c) => ({
  ...c,
  geohash: ngeohash.encode(c.lat, c.lon, 6),
}));
