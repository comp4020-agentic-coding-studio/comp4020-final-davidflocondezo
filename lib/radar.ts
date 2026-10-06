// Rain radar imagery. BOM's own radar is either Akamai-blocked as a plain
// directory listing (https://www.bom.gov.au/radar/ returns 403) or served
// through a newer WMTS endpoint (api.bom.gov.au/apikey/v1/mapping/timeseries)
// whose tile grid uses a non-standard, Australia-cropped origin per zoom
// level — not the global slippy-map pyramid Leaflet expects, and not
// something to get right (or verify visually, without a browser in the dev
// sandbox) under this crit's time budget. RainViewer's public radar API
// (https://www.rainviewer.com/api.html) is documented, free, keyless, covers
// Australia, and serves standard XYZ tiles, so it's the radar source instead.
const METADATA_URL = "https://api.rainviewer.com/public/weather-maps.json";

let cached: { expires: number; tileUrlTemplate: string } | undefined;

export async function latestRadarTileUrlTemplate(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.tileUrlTemplate;

  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`RainViewer metadata fetch failed: ${res.status}`);
  const body = (await res.json()) as { host: string; radar: { past: { path: string }[] } };
  const latest = body.radar.past.at(-1);
  if (!latest) throw new Error("RainViewer returned no radar frames");

  const tileUrlTemplate = `${body.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
  cached = { expires: Date.now() + 2 * 60_000, tileUrlTemplate };
  return tileUrlTemplate;
}
