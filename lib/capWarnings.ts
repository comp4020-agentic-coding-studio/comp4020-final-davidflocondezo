// BOM's own warnings API (lib/bom.ts getWeather) is text-only and scoped to
// one place; this is the national CAP (Common Alerting Protocol) feed WMO
// hosts for BOM, giving every current Australian alert with fuller text
// (description, instruction) regardless of place. Confirmed live: no
// warning in either source carries polygon/circle geometry — see
// lib/warningPlaces.ts for how this app gets an approximate map location
// instead.
import { cached } from "./bom.ts";

const RSS_URL = "https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml";

export interface CapAlert {
  id: string;
  headline: string;
  description: string;
  instruction: string;
  severity: string;
  areaDesc: string;
  // The state/territory full name CAP's areaDesc prefixes every alert with
  // (e.g. "Queensland: Bulloo River to Quilpie...") — cheap to extract here
  // once, rather than re-parsing areaDesc in every consumer.
  state: string;
}

async function fetchAlertXml(url: string): Promise<CapAlert | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();

  const tag = (name: string): string =>
    (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();

  const id = xml.match(/<identifier>([\s\S]*?)<\/identifier>/)?.[1]?.trim() ?? url;
  const areaDesc = tag("areaDesc");
  const state = areaDesc.split(":")[0]?.trim() ?? "";

  return {
    id,
    headline: tag("headline"),
    description: tag("description"),
    instruction: tag("instruction"),
    severity: tag("severity"),
    areaDesc,
    state,
  };
}

// Fetching every alert's XML at once (one unbounded Promise.all) measured at
// ~35s for ~220 alerts; a moderate, deliberately-chosen batch size brought
// that to a more consistent ~13s without the risk of hammering a third
// party's server much harder for inconsistent return (tested up to 60 —
// gains above ~30 were noisy and sometimes an artifact of CDN caching from
// a prior run, not a real improvement on fresh URLs).
const FETCH_CONCURRENCY = 30;

async function fetchAlertXmlBatch(urls: string[]): Promise<CapAlert[]> {
  const alerts: CapAlert[] = [];
  for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
    const batch = urls.slice(i, i + FETCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((url) => fetchAlertXml(url)));
    for (const alert of batchResults) if (alert) alerts.push(alert);
  }
  return alerts;
}

export async function getCapAlerts(): Promise<CapAlert[]> {
  return cached("cap-alerts", 10 * 60_000, async () => {
    const res = await fetch(RSS_URL);
    if (!res.ok) throw new Error(`CAP alert feed fetch failed: ${res.status}`);
    const rss = await res.text();

    // The feed re-lists the same alert every time it's reissued (confirmed
    // live: ~500 RSS items reduce to ~220 distinct alerts by title) — dedup
    // on the RSS item's own <title>, which is exactly the alert's headline,
    // before fetching any full XML. Keeping only the newest (first, since
    // the feed is newest-first) occurrence roughly halves the number of XML
    // fetches a cache-miss needs, and is kinder to a free third-party feed
    // than re-fetching every reissue.
    const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    const seenTitles = new Set<string>();
    const urls: string[] = [];
    for (const item of items) {
      const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
      // The channel's own self-link (rss.xml) matches a naive ".xml"
      // pattern too; alert entries are the ones under a dated path, which
      // the self-link never is.
      const link = item.match(
        /<link>(https:\/\/severeweather\.wmo\.int\/v2\/cap-alerts\/au-bom-en\/\d{4}\/[^<]+\.xml)<\/link>/,
      )?.[1];
      if (!title || !link || seenTitles.has(title)) continue;
      seenTitles.add(title);
      urls.push(link);
    }

    return fetchAlertXmlBatch(urls);
  });
}
