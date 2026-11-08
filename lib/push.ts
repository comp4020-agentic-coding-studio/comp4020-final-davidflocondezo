// Web Push for feature #19: notify a visitor when the nearest warning to one
// of their favorited places changes. No scheduler — see checkAndNotify's own
// comment for why the check instead rides along on real traffic.
// web-push is pure ESM with named exports only (no default export) — a
// default import resolves to undefined under Next's bundler.
import { sendNotification, setVapidDetails } from "web-push";
import {
  isPushSubscribed as dbIsPushSubscribed,
  listPushSubscriptions,
  removePushSubscriptionsByEndpoint,
  updateLastWarningHeadline,
} from "./db.ts";
import { haversineKm } from "./geo.ts";
import type { WarningArea } from "./warningAreas.ts";

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
// A mailto: is what the Web Push spec expects in the VAPID subject; a push
// service only ever uses it to contact the sender if it needs to, never
// shown to the visitor.
const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

if (publicKey && privateKey) {
  setVapidDetails(subject, publicKey, privateKey);
}

// Exposed so the client knows whether push is configured at all — a repo
// cloned without VAPID keys set (e.g. a fresh fork before `fly secrets set`)
// should hide the notify toggle rather than offer a button that 400s.
export function isPushConfigured(): boolean {
  return Boolean(publicKey && privateKey);
}

export function getVapidPublicKey(): string | null {
  return publicKey ?? null;
}

export function isPushSubscribed(endpoint: string, geohash: string): boolean {
  return dbIsPushSubscribed(endpoint, geohash);
}

// The same "nearest warning to a place" logic app/page.tsx already runs
// client-side (nearestWarningHeadline) for display, duplicated here because
// this runs server-side against every watched place, not just the one place
// currently on screen.
function nearestWarningHeadline(lat: number, lon: number, warnings: WarningArea[]): string | null {
  let closest: { headline: string; km: number } | undefined;
  for (const warning of warnings) {
    for (const place of warning.places) {
      const km = haversineKm(lat, lon, place.lat, place.lon);
      if (!closest || km < closest.km) closest = { headline: warning.headline, km };
    }
  }
  return closest?.headline ?? null;
}

// Called from the warning-areas route on every real request for that data
// (app/api/bom/warning-areas/route.ts) rather than on a fixed schedule: this
// app's Fly machine scales to zero between visits (fly.toml), so a cron-style
// interval here would just never fire while nobody's looking. Piggybacking on
// real traffic means a watched place only gets notified once some visitor's
// browser has fetched warnings since the change — in the worst case (no
// traffic at all) a new warning waits until the next page load anywhere, not
// a fixed delay. That tradeoff is deliberate, not a bug — see PROCESS.md.
export async function checkAndNotify(warnings: WarningArea[]): Promise<void> {
  if (!isPushConfigured()) return;

  const subscriptions = listPushSubscriptions();
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const headline = nearestWarningHeadline(sub.lat, sub.lon, warnings);
      if (headline === sub.lastWarningHeadline) return;

      updateLastWarningHeadline(sub.endpoint, sub.geohash, headline);
      // No warning now where there was one before isn't itself worth a push
      // (the "all clear" case) — only a new or changed warning is.
      if (!headline) return;

      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: `Warning near ${sub.placeName}`, body: headline, geohash: sub.geohash }),
        );
      } catch (err) {
        // A 404/410 from the push service means the browser unsubscribed
        // (uninstalled, cleared data, expired) without telling this app —
        // the only signal we get is a failed send, so clean it up here.
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removePushSubscriptionsByEndpoint(sub.endpoint);
        }
      }
    }),
  );
}
