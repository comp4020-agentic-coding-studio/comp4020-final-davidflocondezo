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
  description: string;
  createdAt: string;
  // Whether the current browser's visitor cookie created this report — the
  // server decides this (see app/api/reports/route.ts), so it's trustworthy
  // for showing edit/delete even though the raw owner id is never sent.
  ownedByMe: boolean;
  confirmCount: number;
  // Whether *this* browser has already confirmed — requester-relative, like
  // ownedByMe; never arrives via the SSE broadcast (see lib/reportsBus.ts).
  confirmedByMe: boolean;
}

// Reports live 2h server-side (lib/db.ts REPORT_LIFETIME_MS); this mirrors
// that so a marker fades out and disappears client-side without needing
// another round trip to notice it expired.
const REPORT_LIFETIME_MS = 2 * 60 * 60 * 1000;
// Matches lib/db.ts REPORT_DESCRIPTION_MAX_LENGTH; the server enforces this
// independently, this just keeps the input from accepting more than can
// ever be saved.
const DESCRIPTION_MAX_LENGTH = 280;

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

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Inline, not an icon-font/library dependency — matches the rest of the
// app's zero-extra-frontend-deps approach (see PROCESS.md's stack rationale).
const TRASH_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 6h18" stroke-linecap="round"/>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

interface ReportPopupHandlers {
  onConfirm: (id: string) => Promise<void>;
  onEdit: (id: string, description: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

type PopupMode = "view" | "editing" | "confirmingDelete";

// A stateful mini-component built the same way openDraftPopup's create-flow
// already is in this file: a real DOM element with innerHTML + querySelector
// + addEventListener, re-rendered in place on mode changes rather than
// closing and reopening the popup (which would reset its screen position).
function buildReportPopupContent(initialReport: Report, handlers: ReportPopupHandlers): HTMLElement {
  const root = document.createElement("div");
  root.style.minWidth = "200px";
  // Leaflet stops mousedown/touchstart from reaching the map via a real
  // listener on the popup's own (stable) container, but it suppresses the
  // 'click' event differently: when a click reaches the map, it walks up
  // from event.target via element.parentNode, live, looking for a flag on an
  // ancestor (Map.prototype._isClickDisabled in leaflet-src.js). Every mode
  // change below (Edit/bin icon/Save/Cancel/"Yes, delete") replaces
  // root.innerHTML synchronously inside its own click handler, which detaches
  // the just-clicked button from the DOM in that same tick — so by the time
  // Leaflet's walk starts from that now-parentless button, there's no path
  // left to find the flag, and Leaflet wrongly treats the click as having
  // landed on the map underneath (dropping a new report pin there). Stopping
  // propagation here, on `root` itself (never replaced, only its children
  // are), intercepts the click using the browser's real bubble dispatch
  // before Leaflet's lazy walk ever runs.
  root.addEventListener("click", (e) => e.stopPropagation());
  let report = initialReport;
  let mode: PopupMode = "view";
  // Leaflet positions a popup using the content size it last measured
  // (Popup.prototype._updateLayout/_updatePosition in leaflet-src.js), and
  // only re-measures inside its own setContent()/update(). Rewriting
  // root.innerHTML in place (view -> editing -> confirmingDelete) changes the
  // content's actual size without going through either, so Leaflet can keep
  // the popup positioned/sized for the *previous* mode — meaning a click
  // that looks like it lands on a button can miss the popup's real hit area
  // and fall through to the map tile underneath, registering as a tap to
  // create a new report. Wired up by the caller once the popup exists (see
  // bindPopup below) to call the real Leaflet popup's `.update()` after every
  // re-render so its box tracks the content it currently holds.
  let requestLayoutUpdate: (() => void) | undefined;

  function renderView(): void {
    root.innerHTML = `
      <strong>Community report — not verified</strong><br/>
      ${report.description ? `${escapeHtml(report.description)}<br/>` : ""}
      <span style="color: #555;">reported ${relativeTime(report.createdAt)}</span>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
        <button type="button" data-action="confirm" ${report.confirmedByMe ? "disabled" : ""}
          style="padding: 3px 8px;">
          ${report.confirmedByMe ? "✓ Confirmed" : "Confirm"} (${report.confirmCount})
        </button>
        ${
          report.ownedByMe
            ? `<button type="button" data-action="edit" style="padding: 3px 8px;">Edit</button>
               <button type="button" data-action="delete" aria-label="Delete report"
                 style="padding: 3px; display: inline-flex; color: #8a2020; border-color: #8a2020;">
                 ${TRASH_ICON_SVG}
               </button>`
            : ""
        }
      </div>
    `;
    root.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.addEventListener("click", () => {
      void (async () => {
        await handlers.onConfirm(report.id);
      })();
    });
    root.querySelector<HTMLButtonElement>('[data-action="edit"]')?.addEventListener("click", () => {
      mode = "editing";
      renderEditing();
    });
    root.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener("click", () => {
      mode = "confirmingDelete";
      renderConfirmingDelete();
    });
    requestLayoutUpdate?.();
  }

  function renderEditing(): void {
    root.innerHTML = `
      <strong>Edit report</strong>
      <textarea rows="2" maxlength="${DESCRIPTION_MAX_LENGTH}"
        style="width: 100%; margin: 6px 0; box-sizing: border-box; resize: vertical;"
      >${escapeHtml(report.description)}</textarea>
      <div style="color: crimson; font-size: 0.85em; display: none;"></div>
      <div style="display: flex; gap: 8px;">
        <button type="button" data-action="save" style="flex: 1; padding: 4px;">Save</button>
        <button type="button" data-action="cancel" style="flex: 1; padding: 4px;">Cancel</button>
      </div>
    `;
    const textarea = root.querySelector("textarea")!;
    const errorEl = root.querySelector("div")!;
    textarea.focus();

    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", () => {
      mode = "view";
      renderView();
    });
    root.querySelector<HTMLButtonElement>('[data-action="save"]')?.addEventListener("click", () => {
      void (async () => {
        const button = root.querySelector<HTMLButtonElement>('[data-action="save"]')!;
        button.disabled = true;
        errorEl.style.display = "none";
        const ok = await handlers.onEdit(report.id, textarea.value);
        if (ok) {
          report = { ...report, description: textarea.value.slice(0, DESCRIPTION_MAX_LENGTH) };
          mode = "view";
          renderView();
        } else {
          button.disabled = false;
          errorEl.textContent = "Couldn't save — try again.";
          errorEl.style.display = "block";
        }
      })();
    });
    requestLayoutUpdate?.();
  }

  // Entered by clicking the bin icon; no DELETE request fires until "Yes,
  // delete" is explicitly clicked here.
  function renderConfirmingDelete(): void {
    root.innerHTML = `
      <strong>Delete this report?</strong>
      <p style="margin: 6px 0;">This can't be undone.</p>
      <div style="display: flex; gap: 8px;">
        <button type="button" data-action="confirm-delete"
          style="flex: 1; padding: 4px; color: white; background: #8a2020; border-color: #8a2020;">
          Yes, delete
        </button>
        <button type="button" data-action="cancel" style="flex: 1; padding: 4px;">Cancel</button>
      </div>
    `;
    root.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", () => {
      mode = "view";
      renderView();
    });
    root.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')?.addEventListener("click", () => {
      void (async () => {
        const button = root.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!;
        button.disabled = true;
        const ok = await handlers.onDelete(report.id);
        if (!ok) {
          mode = "view";
          renderView();
        }
        // On success the marker/popup is torn down by the caller.
      })();
    });
    requestLayoutUpdate?.();
  }

  // Applies a live update (edit/confirm arriving over SSE, or this client's
  // own successful confirm) without disturbing an in-progress edit or
  // delete-confirmation the viewer is mid-way through.
  function patch(next: Partial<Report>): void {
    report = { ...report, ...next };
    if (mode === "view") renderView();
  }

  // Called once by the caller after binding this to a real Leaflet popup
  // (see bindPopup below), since the popup to update doesn't exist yet
  // during the initial renderView() call above.
  function setLayoutUpdateCallback(callback: () => void): void {
    requestLayoutUpdate = callback;
  }

  renderView();
  return Object.assign(root, { patch, setLayoutUpdateCallback });
}

type ReportPopupElement = HTMLElement & {
  patch: (next: Partial<Report>) => void;
  setLayoutUpdateCallback: (callback: () => void) => void;
};

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

    const reportHandlers: ReportPopupHandlers = {
      onConfirm: async (id) => {
        try {
          const res = await fetch(`/api/reports/${id}/confirm`, { method: "POST" });
          if (!res.ok) return;
          const { confirmCount } = (await res.json()) as { confirmCount: number };
          applyReportPatch(id, { confirmCount, confirmedByMe: true });
        } catch {
          // Leave the button in its clickable state; nothing to roll back
          // since confirming is idempotent.
        }
      },
      onEdit: async (id, description) => {
        try {
          const res = await fetch(`/api/reports/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description }),
          });
          if (!res.ok) return false;
          applyReportPatch(id, { description: description.slice(0, DESCRIPTION_MAX_LENGTH) });
          return true;
        } catch {
          return false;
        }
      },
      onDelete: async (id) => {
        try {
          const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
          if (!res.ok) return false;
          removeReport(id);
          return true;
        } catch {
          return false;
        }
      },
    };

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
          const popupContent = buildReportPopupContent(report, reportHandlers) as ReportPopupElement;
          const newMarker = Leaflet.marker([report.lat, report.lon], {
            icon: reportIcon(Leaflet, reportOpacity(report.createdAt)),
          })
            .addTo(map)
            .bindPopup(popupContent);
          // Leaflet only re-measures a popup's size/position inside its own
          // update(); without this, switching the content's mode in place
          // (view/editing/confirmingDelete) leaves the popup positioned for
          // the previous mode's size, so a click that looks like it's on a
          // button can land past the popup's real edge and reach the map
          // underneath (registering as "add a report here").
          popupContent.setLayoutUpdateCallback(() => newMarker.getPopup()?.update());
          reportMarkersRef.current.set(id, newMarker);
        } else if (!visible && marker) {
          map.removeLayer(marker);
          reportMarkersRef.current.delete(id);
        }
      }
    };

    const removeReport = (id: string): void => {
      const marker = reportMarkersRef.current.get(id);
      if (marker) {
        marker.remove();
        reportMarkersRef.current.delete(id);
      }
      knownReportsRef.current.delete(id);
    };

    // Applies an edit/confirm, whether from this client's own action or an
    // SSE broadcast from someone else, to both the known-reports cache and
    // any currently-open popup for that marker (without closing/reopening
    // it, which would lose the viewer's scroll position on the map).
    const applyReportPatch = (id: string, patch: Partial<Report>): void => {
      const existing = knownReportsRef.current.get(id);
      if (existing) knownReportsRef.current.set(id, { ...existing, ...patch });

      const popup = reportMarkersRef.current.get(id)?.getPopup();
      const content = popup?.getContent();
      if (content instanceof HTMLElement && "patch" in content) {
        (content as ReportPopupElement).patch(patch);
      }
    };

    // Tapping the map opens an editable popup (description + Create button)
    // at the tapped point, rather than posting immediately — nothing is
    // saved until Create is clicked, so an accidental tap costs nothing.
    const openDraftPopup = (Leaflet: typeof L, map: L.Map, tapLat: number, tapLon: number): void => {
      const content = document.createElement("div");
      content.style.minWidth = "200px";
      content.innerHTML = `
        <strong>New community report</strong>
        <textarea
          rows="2"
          maxlength="${DESCRIPTION_MAX_LENGTH}"
          placeholder="What are you seeing? (optional)"
          style="width: 100%; margin: 6px 0; box-sizing: border-box; resize: vertical;"
        ></textarea>
        <div style="color: crimson; font-size: 0.85em; display: none;"></div>
        <button type="button" style="width: 100%; padding: 4px;">Create</button>
      `;
      const textarea = content.querySelector("textarea")!;
      const errorEl = content.querySelector("div")!;
      const button = content.querySelector("button")!;

      const popup = Leaflet.popup().setLatLng([tapLat, tapLon]).setContent(content).openOn(map);

      button.addEventListener("click", () => {
        void (async () => {
          button.disabled = true;
          errorEl.style.display = "none";
          try {
            const res = await fetch("/api/reports", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat: tapLat, lon: tapLon, description: textarea.value }),
            });
            if (!res.ok) throw new Error(`request failed: ${res.status}`);
            const report = (await res.json()) as Report;
            knownReportsRef.current.set(report.id, report);
            // The SSE "created" broadcast for this same report (with
            // ownedByMe/confirmedByMe defaulted to false — see the
            // addEventListener("created", ...) handler below) can reach this
            // same tab's already-open stream connection and build a marker
            // before this POST's own response resolves, since the two
            // travel over separate HTTP connections with no ordering
            // guarantee between them. If that already happened, patch the
            // existing marker's popup with the authoritative values instead
            // of silently no-op'ing (which left Edit/Delete missing until a
            // later reload or SSE event).
            if (reportMarkersRef.current.has(report.id)) {
              applyReportPatch(report.id, report);
            } else {
              renderVisibleReports(Leaflet, map);
            }
            map.closePopup(popup);
          } catch {
            button.disabled = false;
            errorEl.textContent = "Couldn't create the report — try again.";
            errorEl.style.display = "block";
          }
        })();
      });

      textarea.focus();
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
        openDraftPopup(L, map, e.latlng.lat, e.latlng.lng);
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
      // Broadcast "created" events never carry ownership/confirmedByMe (see
      // lib/reportsBus.ts) — only this client's own direct responses
      // (POST/confirm) say those are true, so anything arriving over SSE
      // defaults both to false.
      eventSource.addEventListener("created", (event) => {
        const report = JSON.parse((event as MessageEvent<string>).data) as Omit<
          Report,
          "ownedByMe" | "confirmedByMe"
        >;
        if (!knownReportsRef.current.has(report.id)) {
          knownReportsRef.current.set(report.id, { ...report, ownedByMe: false, confirmedByMe: false });
          renderVisibleReports(L, map);
        }
      });
      eventSource.addEventListener("deleted", (event) => {
        const { id } = JSON.parse((event as MessageEvent<string>).data) as { id: string };
        removeReport(id);
      });
      eventSource.addEventListener("edited", (event) => {
        const { id, description } = JSON.parse((event as MessageEvent<string>).data) as {
          id: string;
          description: string;
        };
        applyReportPatch(id, { description });
      });
      eventSource.addEventListener("confirmed", (event) => {
        const { id, confirmCount } = JSON.parse((event as MessageEvent<string>).data) as {
          id: string;
          confirmCount: number;
        };
        // confirmedByMe is deliberately left untouched here: this event may
        // be someone else's confirmation, and this client's own confirmed
        // state only ever changes via its own fetch response.
        applyReportPatch(id, { confirmCount });
      });

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
