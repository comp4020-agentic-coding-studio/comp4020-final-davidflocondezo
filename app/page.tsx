"use client";

import ngeohash from "ngeohash";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import LocationSearch, { type SearchResult } from "./components/LocationSearch.tsx";
import { nearestStation } from "../lib/radarStations.ts";

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

function placeFromGeohash(geohash: string): SearchResult {
  const { latitude: lat, longitude: lon } = ngeohash.decode(geohash);
  // A bare geohash carries no name/state, so this reads as a deliberate
  // selection rather than a guess — mirrors "Your location" for geolocation.
  return { geohash, name: "Selected location", state: "", lat, lon };
}

interface WeatherObservation {
  temp?: number;
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [place, setPlace] = useState<SearchResult | null>(null);
  const [weather, setWeather] = useState<{
    observations?: { data?: WeatherObservation };
    warnings?: { data?: { title: string }[] };
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

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
          setLocationError(
            err.code === err.PERMISSION_DENIED
              ? "Location access is blocked for this site — allow it in your browser's site settings, then try again."
              : "Couldn't get your location — try again.",
          );
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
    if (!place) return;
    void fetch(`/api/bom/weather?geohash=${place.geohash}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setWeather)
      .catch(() => setWeather(null));
  }, [place]);

  const station = place ? nearestStation(place.lat, place.lon) : undefined;

  return (
    <main style={{ padding: "1rem", maxWidth: "960px", margin: "0 auto" }}>
      <h1>Weather &amp; rain radar</h1>
      <LocationSearch onSelect={selectPlace} />
      <p>
        <button type="button" onClick={() => requestLocation(() => {}, false)} style={{ padding: "0.5rem 1rem" }}>
          Use my location
        </button>
      </p>
      {locationError && <p style={{ color: "crimson" }}>{locationError}</p>}

      {place && station && (
        <>
          <h2>
            {place.name}
            {place.state ? `, ${place.state}` : ""}
          </h2>
          <WeatherMap lat={place.lat} lon={place.lon} />
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
