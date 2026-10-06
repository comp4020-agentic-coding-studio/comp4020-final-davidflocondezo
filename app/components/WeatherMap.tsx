"use client";

import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import { useEffect, useRef } from "react";

export interface WeatherMapProps {
  lat: number;
  lon: number;
}

// Leaflet needs `window`, so this only ever runs client-side (see the
// dynamic(..., { ssr: false }) import in app/page.tsx).
export default function WeatherMap({ lat, lon }: WeatherMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    let cancelled = false;

    void import("leaflet").then(async (L) => {
      if (cancelled || !containerRef.current) return;

      const map = mapRef.current ?? L.map(containerRef.current).setView([lat, lon], 7);
      mapRef.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      L.marker([lat, lon]).addTo(map);

      const res = await fetch("/api/radar");
      if (cancelled || !res.ok) return;
      const { tileUrlTemplate } = (await res.json()) as { tileUrlTemplate: string };
      radarLayerRef.current = L.tileLayer(tileUrlTemplate, {
        opacity: 0.6,
        attribution: "Radar © RainViewer",
      }).addTo(map);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setView([lat, lon]);
  }, [lat, lon]);

  return <div ref={containerRef} style={{ height: "60vh", width: "100%" }} />;
}
