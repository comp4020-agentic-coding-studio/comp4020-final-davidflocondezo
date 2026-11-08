// Feature #19: shows a notification when lib/push.ts sends one for a
// favorited place's new/changed warning, and focuses (or opens) the app to
// that place on click. A plain script, not a module — service workers
// register from a URL, so this ships as-is, unbundled.
self.addEventListener("push", (event) => {
  let payload = { title: "Weather warning", body: "A warning has changed near a saved location.", geohash: "" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // malformed/empty payload — the fallback above still shows something.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { geohash: payload.geohash },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const geohash = event.notification.data?.geohash;
  const url = geohash ? `/?place=${geohash}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
