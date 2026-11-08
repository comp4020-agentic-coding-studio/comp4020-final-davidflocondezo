"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "./LocationSearch.tsx";

export interface PushToggleProps {
  place: SearchResult;
  // Notifications only make sense for a place already in the quick-switch
  // bar (FavoritesBar.tsx) — tying it to favorites means unfavoriting a
  // place is also how a visitor stops being notified about it, with no
  // separate "forgot I turned this on" state to go stale.
  isFavorite: boolean;
}

// PushManager.subscribe wants the VAPID key as a Uint8Array, not the
// base64url string the server hands back.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export default function PushToggle({ place, isFavorite }: PushToggleProps) {
  const [supported, setSupported] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by enable()/disable() so the background status check below can
  // tell a stale in-flight result from a current one — otherwise a slow
  // getSubscription()+status fetch that was already running when the user
  // clicked the bell can resolve afterward and stomp the click's own result
  // back to the old value.
  const actionIdRef = useRef(0);

  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window);
  }, []);

  useEffect(() => {
    if (!supported) return;
    void fetch("/api/push/config")
      .then((res) => res.json())
      .then((data: { configured: boolean }) => setConfigured(data.configured))
      .catch(() => setConfigured(false));
  }, [supported]);

  // Re-checks whenever the place changes (favoriting a *different* place
  // shouldn't show the previous place's subscribed state) — status lives
  // server-side (push_subscriptions), not in anything the browser itself
  // remembers per-geohash.
  useEffect(() => {
    if (!supported || !configured) return;
    const startedAsActionId = actionIdRef.current;
    let cancelled = false;
    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!sub || cancelled) return null;
        return fetch(`/api/push/status?endpoint=${encodeURIComponent(sub.endpoint)}&geohash=${place.geohash}`)
          .then((res) => res.json())
          .then((data: { subscribed: boolean }) => data.subscribed);
      })
      .then((isSubscribed) => {
        // A click during this check already set its own, more current
        // answer — don't overwrite it with what was in flight before.
        if (!cancelled && actionIdRef.current === startedAsActionId) setSubscribed(Boolean(isSubscribed));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported, configured, place.geohash]);

  async function enable(): Promise<void> {
    actionIdRef.current++;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notifications are blocked — allow them in your browser's site settings to turn this on.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await fetch("/api/push/config").then((res) => res.json());
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          geohash: place.geohash,
          lat: place.lat,
          lon: place.lon,
          placeName: place.name,
        }),
      });
      setSubscribed(true);
    } catch {
      setError("Couldn't turn on notifications — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    actionIdRef.current++;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, geohash: place.geohash }),
        });
      }
      setSubscribed(false);
    } catch {
      setError("Couldn't turn off notifications — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported || !configured || !isFavorite) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <button
        type="button"
        disabled={busy}
        aria-pressed={subscribed}
        title={subscribed ? "Stop notifying me about warnings here" : "Notify me about warnings here"}
        onClick={() => void (subscribed ? disable() : enable())}
        style={{
          display: "flex",
          alignItems: "center",
          background: "none",
          border: "none",
          cursor: busy ? "default" : "pointer",
          padding: 0,
          fontSize: "1.1rem",
          opacity: busy ? 0.5 : 1,
          color: subscribed ? "#2461e5" : "#ccc",
        }}
      >
        🔔
      </button>
      {error && (
        <span style={{ color: "crimson", fontSize: "0.8rem" }}>{error}</span>
      )}
    </span>
  );
}
