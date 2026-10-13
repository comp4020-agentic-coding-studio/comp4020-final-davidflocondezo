"use client";

import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import { useEffect, useRef } from "react";

export interface WeatherMapProps {
  lat: number;
  lon: number;
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
export default function WeatherMap({ lat, lon }: WeatherMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  // Every report seen so far (seed fetch + SSE), regardless of whether it's
  // currently inside the visible map — the source of truth for re-filtering
  // on pan/zoom without another round trip.
  const knownReportsRef = useRef<Map<string, Report>>(new Map());
  // Only the reports currently rendered as markers (a subset of the above,
  // filtered to the map's current bounds).
  const reportMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | undefined;
    let fadeInterval: ReturnType<typeof setInterval> | undefined;

    // A report is only shown if it's inside what's actually on screen right
    // now — a fixed-size "area" cell doesn't track the map's real zoom level,
    // which can show anything from a suburb to a continent (see crit 9 ADR,
    // decision 3: this replaced an earlier geohash-prefix filter that silently
    // dropped nearly every tap once the map was zoomed out further than a
    // ~4km cell).
    const renderVisibleReports = (Leaflet: typeof L, map: L.Map): void => {
      const bounds = map.getBounds();
      for (const [id, report] of knownReportsRef.current) {
        const visible = bounds.contains([report.lat, report.lon]);
        const marker = reportMarkersRef.current.get(id);
        if (visible && !marker) {
          const newMarker = Leaflet.marker([report.lat, report.lon], {
            icon: reportIcon(Leaflet, reportOpacity(report.createdAt)),
          })
            .addTo(map)
            .bindPopup(reportPopupHtml(report));
          reportMarkersRef.current.set(id, newMarker);
        } else if (!visible && marker) {
          map.removeLayer(marker);
          reportMarkersRef.current.delete(id);
        }
      }
    };

    void import("leaflet").then(async (L) => {
      if (cancelled || !containerRef.current) return;

      const map = mapRef.current ?? L.map(containerRef.current).setView([lat, lon], 7);
      mapRef.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      L.marker([lat, lon]).addTo(map);

      map.on("moveend", () => renderVisibleReports(L, map));

      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat: tapLat, lng: tapLon } = e.latlng;
        const id = `pending-${Date.now()}`;
        knownReportsRef.current.set(id, {
          id,
          lat: tapLat,
          lon: tapLon,
          geohash: "",
          createdAt: new Date().toISOString(),
        });
        renderVisibleReports(L, map);

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
        for (const report of reports) knownReportsRef.current.set(report.id, report);
        renderVisibleReports(L, map);
      }

      eventSource = new EventSource("/api/reports/stream");
      eventSource.onmessage = (event) => {
        const report = JSON.parse(event.data) as Report;
        knownReportsRef.current.set(report.id, report);
        renderVisibleReports(L, map);
      };

      fadeInterval = setInterval(() => {
        for (const [id, marker] of reportMarkersRef.current) {
          const report = knownReportsRef.current.get(id);
          if (!report) continue;
          const opacity = reportOpacity(report.createdAt);
          if (opacity <= 0) {
            map.removeLayer(marker);
            reportMarkersRef.current.delete(id);
            knownReportsRef.current.delete(id);
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

  return <div ref={containerRef} style={{ height: "60vh", width: "100%" }} />;
}
