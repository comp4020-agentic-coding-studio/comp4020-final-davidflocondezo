"use client";

import ngeohash from "ngeohash";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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

interface WeatherObservation {
  temp?: number;
}

export default function Home() {
  const [place, setPlace] = useState<SearchResult | null>(null);
  const [weather, setWeather] = useState<{
    observations?: { data?: WeatherObservation };
    warnings?: { data?: { title: string }[] };
  } | null>(null);

  // On first load: try geolocation; fall back to a previously saved trace,
  // then to Canberra. Whatever we land on is also saved as the new trace, so
  // a later visit without a fresh geolocation grant still shows it.
  useEffect(() => {
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
    const res = await fetch("/api/trace");
    const trace = (await res.json()) as SearchResult | null;
    selectPlace(trace ?? CANBERRA);
  }

  function selectPlace(p: SearchResult): void {
    setPlace(p);
    void fetch("/api/trace", { method: "POST", body: JSON.stringify(p) });
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
