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

    if (!("geolocation" in navigator)) {
      void loadTraceOrDefault();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        selectPlace({
          geohash: ngeohash.encode(lat, lon, 6),
          name: "Your location",
          state: "",
          lat,
          lon,
        });
      },
      () => void loadTraceOrDefault(),
      { timeout: 8000 },
    );
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
