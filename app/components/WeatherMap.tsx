"use client";

import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import ngeohash from "ngeohash";
import { useEffect, useRef } from "react";

export interface WeatherMapProps {
  lat: number;
  lon: number;
  /** Precision-6 geohash of the place currently being viewed. */
  placeGeohash: string;
}

interface Report {
  id: string;
  lat: number;
  lon: number;
  geohash: string;
  createdAt: string;
}

// Reports live 2h server-side (lib/db.ts REPORT_LIFETIME_MS); this mirrors
// that so a marker fades out and disappears client-side without needing
// another round trip to notice it expired.
const REPORT_LIFETIME_MS = 2 * 60 * 60 * 1000;
// Coarser than the precision-6 geohash reports are stored at (~4.9km cell),
// so a report is shown to anyone viewing roughly the same area, not just an
// exact geohash match.
const AREA_PREFIX_LENGTH = 5;

const inSameArea = (reportGeohash: string, placeGeohash: string): boolean =>
  reportGeohash.slice(0, AREA_PREFIX_LENGTH) === placeGeohash.slice(0, AREA_PREFIX_LENGTH);

const reportOpacity = (createdAt: string): number => {
  const age = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, 1 - age / REPORT_LIFETIME_MS);
};

// Plain amber circle, not the red/triangle styling an official warning would
// use, so a community report is never visually mistaken for one (see
// PROCESS.md, crit 9 decision).
function reportIcon(Leaflet: typeof L, opacity: number): L.DivIcon {
  return Leaflet.divIcon({
    className: "",
    html: `<div style="
      width: 16px; height: 16px; border-radius: 50%;
      background: #e8a33d; border: 2px solid #8a5a10;
      opacity: ${opacity};
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const relativeTime = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

const reportPopupHtml = (report: Report): string =>
  `<strong>Community report — not verified</strong><br/>reported ${relativeTime(report.createdAt)}`;

// Leaflet needs `window`, so this only ever runs client-side (see the
// dynamic(..., { ssr: false }) import in app/page.tsx).
export default function WeatherMap({ lat, lon, placeGeohash }: WeatherMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const reportMarkersRef = useRef<Map<string, { marker: L.Marker; report: Report }>>(new Map());
  const placeGeohashRef = useRef(placeGeohash);

  useEffect(() => {
    placeGeohashRef.current = placeGeohash;
  }, [placeGeohash]);

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | undefined;
    let fadeInterval: ReturnType<typeof setInterval> | undefined;

    const upsertReport = (Leaflet: typeof L, map: L.Map, report: Report): void => {
      if (!inSameArea(report.geohash, placeGeohashRef.current)) return;
      const existing = reportMarkersRef.current.get(report.id);
      if (existing) return;

      const marker = Leaflet.marker([report.lat, report.lon], {
        icon: reportIcon(Leaflet, reportOpacity(report.createdAt)),
      })
        .addTo(map)
        .bindPopup(reportPopupHtml(report));
      reportMarkersRef.current.set(report.id, { marker, report });
    };

    void import("leaflet").then(async (L) => {
      if (cancelled || !containerRef.current) return;
      leafletRef.current = L;

      const map = mapRef.current ?? L.map(containerRef.current).setView([lat, lon], 7);
      mapRef.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      L.marker([lat, lon]).addTo(map);

      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat: tapLat, lng: tapLon } = e.latlng;
        const optimistic: Report = {
          id: `pending-${Date.now()}`,
          lat: tapLat,
          lon: tapLon,
          geohash: ngeohash.encode(tapLat, tapLon, 6),
          createdAt: new Date().toISOString(),
        };
        upsertReport(L, map, optimistic);

        void fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: tapLat, lon: tapLon }),
        });
      });

      const res = await fetch("/api/radar");
      if (cancelled || !res.ok) return;
      const { tileUrlTemplate } = (await res.json()) as { tileUrlTemplate: string };
      radarLayerRef.current = L.tileLayer(tileUrlTemplate, {
        opacity: 0.6,
        attribution: "Radar © RainViewer",
      }).addTo(map);

      const seedRes = await fetch("/api/reports");
      if (!cancelled && seedRes.ok) {
        const reports = (await seedRes.json()) as Report[];
        for (const report of reports) upsertReport(L, map, report);
      }

      eventSource = new EventSource("/api/reports/stream");
      eventSource.onmessage = (event) => {
        const report = JSON.parse(event.data) as Report;
        upsertReport(L, map, report);
      };

      fadeInterval = setInterval(() => {
        for (const [id, { marker, report }] of reportMarkersRef.current) {
          const opacity = reportOpacity(report.createdAt);
          if (opacity <= 0) {
            map.removeLayer(marker);
            reportMarkersRef.current.delete(id);
          } else {
            marker.setIcon(reportIcon(L, opacity));
          }
        }
      }, 30_000);
    });

    return () => {
      cancelled = true;
      eventSource?.close();
      if (fadeInterval) clearInterval(fadeInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setView([lat, lon]);
  }, [lat, lon]);

  // Switching place drops reports that no longer match, then re-seeds from
  // the server for the new area (the SSE stream only carries reports
  // created *after* this client connected).
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    for (const [id, { marker, report }] of reportMarkersRef.current) {
      if (!inSameArea(report.geohash, placeGeohash)) {
        map.removeLayer(marker);
        reportMarkersRef.current.delete(id);
      }
    }

    let cancelled = false;
    void fetch("/api/reports")
      .then((res) => (res.ok ? (res.json() as Promise<Report[]>) : []))
      .then((reports) => {
        if (cancelled) return;
        for (const report of reports) {
          if (!inSameArea(report.geohash, placeGeohash)) continue;
          if (reportMarkersRef.current.has(report.id)) continue;
          const marker = L.marker([report.lat, report.lon], {
            icon: reportIcon(L, reportOpacity(report.createdAt)),
          })
            .addTo(map)
            .bindPopup(reportPopupHtml(report));
          reportMarkersRef.current.set(report.id, { marker, report });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [placeGeohash]);

  return <div ref={containerRef} style={{ height: "60vh", width: "100%" }} />;
}
