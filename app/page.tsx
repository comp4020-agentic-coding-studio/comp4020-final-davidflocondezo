"use client";

import ngeohash from "ngeohash";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type CSSProperties } from "react";
import { haversineKm } from "../lib/geo.ts";
import { nearestStation } from "../lib/radarStations.ts";
import type { WarningArea } from "../lib/warningAreas.ts";
import CurrentConditions from "./components/CurrentConditions.tsx";
import FavoritesBar from "./components/FavoritesBar.tsx";
import LocationSearch, { type SearchResult } from "./components/LocationSearch.tsx";
import OnboardingTour from "./components/OnboardingTour.tsx";
import PushToggle from "./components/PushToggle.tsx";

const WeatherMap = dynamic(() => import("./components/WeatherMap.tsx"), { ssr: false });

const CANBERRA: SearchResult = {
  geohash: ngeohash.encode(-35.2809, 149.13, 6),
  name: "Canberra",
  state: "ACT",
  lat: -35.2809,
  lon: 149.13,
};

// Same-browser cache of the last selected place, checked before the
// server-side cookie trace since it's synchronous (no round trip). Not
// load-bearing: a private-browsing tab or a cleared/disabled storage falls
// straight through to the trace/default chain below.
const STORAGE_KEY = "place";

function readStoredPlace(): SearchResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SearchResult) : null;
  } catch {
    return null;
  }
}

// Same same-browser localStorage convenience as STORAGE_KEY above and
// WeatherMap.tsx's own EXPLAINER_SEEN_KEY — not load-bearing, so a
// private-browsing tab or cleared storage just shows the tour again.
const TOUR_SEEN_KEY = "onboardingTourSeen";

function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "true");
  } catch {
    // worst case the tour shows again on a later visit, which is harmless.
  }
}

// A short list of starred places, independent of STORAGE_KEY above (which
// only ever holds the single last-visited place) — same same-browser
// localStorage convenience, not load-bearing.
const FAVORITES_KEY = "favorites";
const MAX_FAVORITES = 5;

function readFavorites(): SearchResult[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as SearchResult[]) : [];
  } catch {
    return [];
  }
}

function saveFavorites(list: SearchResult[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // private browsing / storage disabled — favorites just won't persist
    // across a reload, same degradation as the other localStorage uses here.
  }
}

function placeFromGeohash(geohash: string): SearchResult {
  const { latitude: lat, longitude: lon } = ngeohash.decode(geohash);
  // A bare geohash carries no name/state, so this reads as a deliberate
  // selection rather than a guess — mirrors "Your location" for geolocation.
  return { geohash, name: "Selected location", state: "", lat, lon };
}

interface WeatherObservation {
  temp?: number;
}

interface DailyForecast {
  icon_descriptor?: string | null;
  uv?: { category: string; max_index: number } | null;
  astronomical?: { sunrise_time: string; sunset_time: string } | null;
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [place, setPlace] = useState<SearchResult | null>(null);
  const [weather, setWeather] = useState<{
    observations?: { data?: WeatherObservation };
    warnings?: { data?: { title: string }[] };
    forecast?: { data?: DailyForecast[] };
  } | null>(null);
  // Nationwide, with each warning's resolved place coordinates — fetched
  // separately from `weather` above (which only carries the forecast
  // district's own warning *titles*, no coordinates) so CurrentConditions
  // can show whichever warning is geographically nearest `place`, not just
  // the first one BOM's feed happens to list.
  const [warningAreas, setWarningAreas] = useState<WarningArea[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showTour, setShowTour] = useState(false);
  // Loaded lazily (empty on the server-rendered pass, filled in on mount)
  // since localStorage doesn't exist during SSR — same pattern STORAGE_KEY's
  // place/tour-seen reads already use via useEffect rather than useState's
  // initializer.
  const [favorites, setFavorites] = useState<SearchResult[]>([]);

  // Shared by the initial load (below) and the "Use my location" button —
  // same success path, same geohash/name shape. A browser that already
  // denied the permission once won't re-show its own prompt on a later call
  // (Chrome/Firefox/Safari all suppress it); this can only report that back
  // to the visitor, not force the browser to ask again. `silent` skips
  // setting an error message: the initial page load shouldn't greet a
  // visitor with an error before they've clicked anything, only the button
  // (a deliberate action) should surface one.
  function requestLocation(onDenied: () => void, silent: boolean): void {
    if (!("geolocation" in navigator)) {
      if (!silent) setLocationError("Location isn't available in this browser.");
      onDenied();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationError(null);
        const { latitude: lat, longitude: lon } = pos.coords;
        selectPlace({
          geohash: ngeohash.encode(lat, lon, 6),
          name: "Your location",
          state: "",
          lat,
          lon,
        });
      },
      (err) => {
        if (!silent) {
          // The 3 GeolocationPositionError codes need separate messages:
          // PERMISSION_DENIED is a site-level block (fixed in the browser's
          // own site settings); POSITION_UNAVAILABLE is almost always the
          // OS's location service itself being off, or off for this browser
          // specifically (fixed in the OS's system settings, not the
          // browser) — collapsing these into one generic message left no
          // way to tell which one actually applied.
          let message: string;
          if (err.code === err.PERMISSION_DENIED) {
            message = "Location access is blocked for this site — allow it in your browser's site settings, then try again.";
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            message =
              "Your device couldn't determine your location — check that Location Services is turned on for this browser in your system settings.";
          } else {
            message = "Getting your location timed out — check your connection and try again.";
          }
          setLocationError(message);
        }
        onDenied();
      },
      { timeout: 8000 },
    );
  }

  // Load priority: the URL's ?place= (a bookmarked/shared link should always
  // show what it promised, regardless of where the visitor actually is or
  // whether they grant geolocation) > geolocation > localStorage/cookie
  // trace (same idea, whichever answers first) > the hardcoded default.
  useEffect(() => {
    const urlGeohash = searchParams.get("place");
    if (urlGeohash) {
      setPlace(placeFromGeohash(urlGeohash));
      return;
    }

    requestLocation(() => void loadTraceOrDefault(), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTraceOrDefault(): Promise<void> {
    const stored = readStoredPlace();
    if (stored) {
      selectPlace(stored);
      return;
    }
    const res = await fetch("/api/trace");
    const trace = (await res.json()) as SearchResult | null;
    selectPlace(trace ?? CANBERRA);
  }

  function selectPlace(p: SearchResult): void {
    setPlace(p);
    void fetch("/api/trace", { method: "POST", body: JSON.stringify(p) });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // private browsing / storage disabled — localStorage is a same-browser
      // convenience cache here, not the only copy of this state.
    }
    router.replace(`/?place=${p.geohash}`, { scroll: false });
  }

  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  // Push notifications (feature #19) are only ever turned on for a favorited
  // place (PushToggle.tsx), so unfavoriting one should also stop them —
  // otherwise a dropped favorite keeps silently pushing from a row the
  // visitor has no UI left to see or turn off. Best-effort: no push
  // subscription existing yet for this geohash is the common case, not an
  // error.
  function unsubscribePush(geohash: string): void {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    void navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) return;
        void fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, geohash }),
        });
      })
      .catch(() => {});
  }

  // Adds the current place if it isn't already favorited (dropping the
  // oldest once at MAX_FAVORITES, so starring one more always succeeds
  // rather than silently doing nothing at the cap), or removes it if it is
  // — the single star button's whole job, toggled by what's already saved.
  function toggleFavorite(p: SearchResult): void {
    setFavorites((current) => {
      const already = current.some((f) => f.geohash === p.geohash);
      const next = already ? current.filter((f) => f.geohash !== p.geohash) : [...current, p].slice(-MAX_FAVORITES);
      // Whatever fell out of `current` and isn't in `next` either unstarred
      // normally or got evicted by the MAX_FAVORITES cap — both cases mean
      // its notifications (if any) are now orphaned, same as removeFavorite.
      for (const dropped of current) {
        if (!next.some((f) => f.geohash === dropped.geohash)) unsubscribePush(dropped.geohash);
      }
      saveFavorites(next);
      return next;
    });
  }

  function removeFavorite(geohash: string): void {
    setFavorites((current) => {
      const next = current.filter((f) => f.geohash !== geohash);
      saveFavorites(next);
      return next;
    });
    unsubscribePush(geohash);
  }

  useEffect(() => {
    if (!place) return;
    void fetch(`/api/bom/weather?geohash=${place.geohash}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setWeather)
      .catch(() => setWeather(null));
  }, [place]);

  // National list, fetched once (not re-fetched per place change, unlike
  // the geohash-scoped weather call above) — the same list WeatherMap.tsx's
  // own warning-circle layer already fetches independently; CurrentConditions
  // just needs the list client-side to pick the nearest one.
  useEffect(() => {
    void fetch("/api/bom/warning-areas")
      .then((res) => (res.ok ? (res.json() as Promise<WarningArea[]>) : []))
      .then(setWarningAreas)
      .catch(() => setWarningAreas([]));
  }, []);

  const station = place ? nearestStation(place.lat, place.lon) : undefined;

  // Fired once by WeatherMap's own onReady, once its Layers panel actually
  // exists on screen — so a first-ever visitor never sees the tour
  // reference UI that isn't rendered yet.
  function handleMapReady(): void {
    if (!hasSeenTour()) setShowTour(true);
  }

  function dismissTour(): void {
    markTourSeen();
    setShowTour(false);
  }

  // The warning whose *nearest resolved place* is closest to the selected
  // location — not just the first one BOM's feed lists — falling back to the
  // feed's own first warning when no place is selected yet (briefly, before
  // the initial geolocation/trace/default chain resolves one).
  const nearestWarningHeadline = ((): string | null => {
    if (warningAreas.length === 0) return null;
    if (!place) return warningAreas[0].headline;

    let closest: { headline: string; km: number } | undefined;
    for (const warning of warningAreas) {
      for (const warningPlace of warning.places) {
        const km = haversineKm(place.lat, place.lon, warningPlace.lat, warningPlace.lon);
        if (!closest || km < closest.km) closest = { headline: warning.headline, km };
      }
    }
    return closest?.headline ?? null;
  })();

  const isCurrentPlaceFavorite = place ? favorites.some((f) => f.geohash === place.geohash) : false;

  return (
    <main style={{ padding: "1rem", maxWidth: "960px", margin: "0 auto" }}>
      <div
        style={
          {
            paddingTop: "32px",
            paddingBottom: "32px",
            backgroundColor: "#0c4ad0",
            backgroundImage: "url(/isobars-dark-02.svg)",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "top center",
            backgroundSize: "100%",
            "--esri-calcite-mode-name": "light",
            lineHeight: "1.5rem",
            color: "#fff",
          } as CSSProperties
        }
      >
        <h1>Weather &amp; rain radar</h1>
        <p style={{ marginTop: "-0.5rem" }}>See rain, wind, wave and other weather information for Australia</p>
      </div>
      <CurrentConditions
        tempC={weather?.observations?.data?.temp ?? null}
        iconDescriptor={weather?.forecast?.data?.[0]?.icon_descriptor ?? null}
        nearestWarningHeadline={nearestWarningHeadline}
        uv={weather?.forecast?.data?.[0]?.uv ?? null}
      />
      <FavoritesBar favorites={favorites} onSelect={selectPlace} onRemove={removeFavorite} />
      <div className="search-row">
        <div className="search-input-wrap">
          <LocationSearch onSelect={selectPlace} />
        </div>
        <button
          type="button"
          onClick={() => requestLocation(() => {}, false)}
          style={{ padding: "0.5rem 1rem", height: "2.375rem" }}
        >
          Use my location
        </button>
      </div>
      {/* Column on mobile (each full-width, stacked); row on desktop, with
          the search input capped to a fixed width so "Use my location" has
          room to sit on the same line — plain <style> since this repo has
          no CSS setup to target a breakpoint from inline styles alone. */}
      <style>{`
        .search-row {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
        }
        .search-input-wrap {
          width: 100%;
        }
        @media (min-width: 640px) {
          .search-row {
            flex-direction: row;
            align-items: flex-start;
          }
          .search-input-wrap {
            width: 320px;
          }
        }
      `}</style>
      {locationError && <p style={{ color: "crimson" }}>{locationError}</p>}

      {place && station && (
        <>
          <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>
              {place.name}
              {place.state ? `, ${place.state}` : ""}
            </span>
            <button
              type="button"
              aria-label={isCurrentPlaceFavorite ? "Remove from favorites" : "Add to favorites"}
              title={isCurrentPlaceFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => toggleFavorite(place)}
              style={{
                display: "flex",
                alignItems: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "1.25rem",
                color: isCurrentPlaceFavorite ? "#e6a817" : "#ccc",
              }}
            >
              {isCurrentPlaceFavorite ? "★" : "☆"}
            </button>
            <PushToggle place={place} isFavorite={isCurrentPlaceFavorite} />
          </h2>
          <WeatherMap
            lat={place.lat}
            lon={place.lon}
            placeName={place.name}
            placeGeohash={place.geohash}
            astronomical={weather?.forecast?.data?.[0]?.astronomical ?? null}
            onReady={handleMapReady}
            onShowTour={() => setShowTour(true)}
          />
          <p>Nearest radar: {station.name}</p>

          {weather?.warnings?.data && weather.warnings.data.length > 0 && (
            <section>
              <h3>Warnings</h3>
              <ul>
                {weather.warnings.data.map((w) => (
                  <li key={w.title}>{w.title}</li>
                ))}
              </ul>
            </section>
          )}

          {weather?.observations?.data?.temp !== undefined && (
            <p>Current temperature: {weather.observations.data.temp}°C</p>
          )}
        </>
      )}

      <p>
        <a href="/readme/">About this app</a>
      </p>
      {showTour && <OnboardingTour onDismiss={dismissTour} />}
    </main>
  );
}

// useSearchParams() requires a Suspense boundary (Next.js App Router), since
// it can bail the page out of static prerendering otherwise.
export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
