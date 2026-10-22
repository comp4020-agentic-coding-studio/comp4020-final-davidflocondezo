"use client";

import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { Strike } from "../../lib/lightning.ts";
import { nearestStation } from "../../lib/radarStations.ts";
import type { WarningArea } from "../../lib/warningAreas.ts";
import type { WindObservation } from "../../lib/wind.ts";
import LayersPanel, { type LayerToggles } from "./LayersPanel.tsx";

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

// Marks the resolved location the weather/radar/forecast on screen are for.
// A divIcon, like reportIcon below, rather than Leaflet's default L.Icon:
// Leaflet's default marker image (marker-icon.png etc.) is built assuming a
// plain <script> include, so its relative image paths 404 once Leaflet is
// loaded through a bundler (this app's dynamic import()) instead — the
// broken-image box this was replacing. Blue, not amber, so it's never
// mistaken for a community report pin (reportIcon below).
function locationIcon(Leaflet: typeof L): L.DivIcon {
  return Leaflet.divIcon({
    className: "",
    html: `<div style="
      width: 14px; height: 14px; border-radius: 50%;
      background: #2f6fed; border: 2px solid #ffffff;
      box-shadow: 0 0 0 1px #2f6fed;
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

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

// Neither BOM's warnings data nor the CAP feed carries polygon/circle
// geometry for a warning (confirmed live — see PROCESS.md and
// lib/warningPlaces.ts), so this is deliberately an approximation: a fixed
// radius around a place the warning's own text names, not an official
// boundary. 25km matches the real-world spacing between two towns named in
// the same flood warning during live testing — a reasonable single default,
// not tuned per warning type.
const WARNING_RADIUS_METERS = 25_000;

// CAP v1.2 defines severity as exactly these 5 values (OASIS spec) — a
// closed enum, not an open string, so this lookup is exhaustive by
// construction rather than needing a fallback for "most" inputs. Yellow ->
// orange -> red for low -> high severity is the dominant international
// weather-alert convention (Canada, Norway, India, China all use some
// variant); "Unknown" keeps the colors this app used before severity was
// differentiated at all, since BOM's own feed leaves it unset more often
// than not (43 of 82 live warnings checked during development) — that's a
// gap in BOM's data, not a signal the warning is actually low-severity, so
// it gets the same middle-ground look as before rather than being treated
// as mild.
//
// One saturated color per tier, used for both stroke and fill — at the low
// fillOpacity below, a lighter fill color (the first version of this) read
// as a different hue from its own outline rather than a lighter tint of it;
// using the same hex for both keeps the circle looking like one coherent
// color at a glance, with fillOpacity (not a second, paler color) doing the
// work of keeping the fill unobtrusive over the map tiles.
const SEVERITY_COLORS: Record<string, string> = {
  Extreme: "#7b241c",
  Severe: "#c0392b",
  Moderate: "#d68910",
  Minor: "#9a7d0a",
};
const DEFAULT_SEVERITY_COLOR = "#c0392b";

function warningCircleOptions(severity: string): L.CircleMarkerOptions {
  const color = SEVERITY_COLORS[severity] ?? DEFAULT_SEVERITY_COLOR;
  // Amber is already the community-report convention (crit 9's documented
  // decision) for "unverified, person-reported" — none of the severity
  // tiers above use it, so a warning circle is never mistaken for one.
  return { color, weight: 2, fillColor: color, fillOpacity: 0.15 };
}

function warningPopupHtml(warning: WarningArea, placeName: string): string {
  const color = SEVERITY_COLORS[warning.severity] ?? DEFAULT_SEVERITY_COLOR;
  return `
    <strong>${escapeHtml(warning.headline)}</strong><br/>
    <span style="color: ${color}; font-weight: bold;">${escapeHtml(warning.severity)} severity</span><br/>
    ${warning.description ? `${escapeHtml(warning.description)}<br/>` : ""}
    ${warning.instruction ? `<p style="margin: 6px 0;">${escapeHtml(warning.instruction)}</p>` : ""}
    <span style="color: #555; font-size: 0.85em;">
      Approximate area near ${escapeHtml(placeName)} — not an official BOM boundary.
    </span>
  `;
}

// A neutral blue-gray, distinct from both the amber community-report
// convention and the severity-colored (yellow->red) warning circles — these
// are purely informational, not a hazard indicator.
const INFO_CIRCLE_OPTIONS: L.CircleMarkerOptions = {
  color: "#3b82c4",
  weight: 1,
  fillColor: "#3b82c4",
  fillOpacity: 0.05,
  dashArray: "4 4",
};

// Arbitrary, round distances giving a quick sense of scale around the
// selected location — not tied to any data source.
const RING_RADII_KM = [50, 100, 150];

// BOM's own public convention for radar range: ~100km is "generally
// reliable", ~150-200km is the general limit of useful coverage before
// earth curvature and beam spreading make returns unreliable. 150km is a
// reasonable single default (this app's station list doesn't track radar
// type/band, so there's no finer-grained figure to use per station).
const COVERAGE_RADIUS_KM = 150;

// A lightning-bolt glyph plus a ring that pulses continuously via the SVG's
// own <animate repeatCount="indefinite">, not CSS keyframes — nothing beyond
// what a divIcon + inline SVG already support elsewhere in this file
// (TRASH_ICON_SVG et al). The loop keeps running for as long as the marker
// stays on the map (i.e. until the strike ages out of the server's buffer),
// so a strike stays easy to spot rather than settling into a small static
// dot that blends into whatever map tile color sits underneath it —
// reported live: a single real strike was in the API response but not
// visually noticeable once its one-shot pulse had already finished.
//
// A white halo stroke sits behind the bolt and the ring's own color
// (#ff9100, a saturated orange not reused anywhere else on the map — ring
// colors elsewhere are red/amber-severity or blue-gray-info) so the icon
// reads clearly against light tan/green/blue map tiles alike, rather than
// relying on the bolt's own yellow fill for contrast.
function lightningIcon(Leaflet: typeof L): L.DivIcon {
  return Leaflet.divIcon({
    className: "",
    html: `
      <svg width="32" height="32" viewBox="-16 -16 32 32" style="overflow: visible;">
        <circle r="5" fill="none" stroke="#ff9100" stroke-width="3">
          <animate attributeName="r" values="5;15;5" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
        <path d="M-2 -8 L-5 1 L-1 1 L2 8 L5 -1 L1 -1 Z" fill="none" stroke="#ffffff" stroke-width="5" stroke-linejoin="round" />
        <path d="M-2 -8 L-5 1 L-1 1 L2 8 L5 -1 L1 -1 Z" fill="#ffd400" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// BOM's wind observations report direction as one of the 16 standard
// compass points (confirmed live — "ENE", "WSW", etc.), not raw degrees.
// 0deg = North = arrow pointing up, matching the arrow glyph's own default
// orientation below.
const COMPASS_TO_DEGREES: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

// Same yellow->orange->red convention already used for warning severity
// (SEVERITY_COLORS above) — faster wind reads as "hotter" the same way a
// more severe warning does, reusing an established visual language rather
// than inventing a new one for this layer.
function windColor(speedKmh: number): string {
  if (speedKmh >= 40) return "#c0392b";
  if (speedKmh >= 25) return "#e67e22";
  if (speedKmh >= 10) return "#d68910";
  return "#2e86c1";
}

// A simple arrow divIcon (same convention as lightningIcon/locationIcon),
// rotated to the wind's compass direction and colored by speed. Points in
// the direction the wind is blowing *from*, matching BOM's own convention
// (the `direction` field is already "from", e.g. "wind from the east").
function windArrowIcon(Leaflet: typeof L, speedKmh: number, direction: string): L.DivIcon {
  const degrees = COMPASS_TO_DEGREES[direction] ?? 0;
  const color = windColor(speedKmh);
  return Leaflet.divIcon({
    className: "",
    html: `
      <svg width="24" height="24" viewBox="-12 -12 24 24" style="overflow: visible; transform: rotate(${degrees}deg);">
        <path d="M0 -9 L5 4 L0 1 L-5 4 Z" fill="${color}" stroke="#1a1a1a" stroke-width="1" stroke-linejoin="round" />
      </svg>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function windPopupHtml(obs: { stationName: string; speedKmh: number; direction: string }): string {
  return `${escapeHtml(obs.stationName)}: ${obs.speedKmh} km/h from the ${escapeHtml(obs.direction)}`;
}

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
  const leafletRef = useRef<typeof L | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  // Every report seen so far (seed fetch + SSE), regardless of whether it's
  // currently inside the visible map — the source of truth for re-filtering
  // on pan/zoom without another round trip.
  const knownReportsRef = useRef<Map<string, Report>>(new Map());
  // Only the reports currently rendered as markers (a subset of the above,
  // filtered to the map's current bounds).
  const reportMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  // Refs alone don't retrigger effects, so these two flip to true once the
  // map (synchronously) and the radar tile layer (after its own await) are
  // actually ready for the toggle effects below to touch.
  const [mapReady, setMapReady] = useState(false);
  const [radarLoaded, setRadarLoaded] = useState(false);
  const [toggles, setToggles] = useState<LayerToggles>({
    radar: true,
    rings: false,
    coverage: false,
    lightning: false,
    wind: false,
  });
  // Diffed against each poll's response, keyed by a derived id (strikes
  // carry none of their own) — see lightningIcon's comment for why this
  // can't be a clear-and-redraw like the rings/coverage circles (it would
  // restart each marker's continuous pulse animation every poll).
  const lightningMarkersRef = useRef<Map<string, L.Marker>>(new Map());

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

      // interactive: false — this marker has no popup of its own, but
      // Leaflet renders markers in a pane above vector layers (circles,
      // polygons) by default. Without this, a warning circle (added below)
      // whose place happens to be very close to the selected location sits
      // visually and interactively underneath this dot, so a real click
      // there hits the marker's own DOM element first — which has no
      // listener — and falls through to the map's default click (confirmed:
      // this opened "new community report" instead of the warning popup).
      L.marker([lat, lon], { icon: locationIcon(L), interactive: false }).addTo(map);

      map.on("moveend", () => renderVisibleReports(L, map));

      map.on("click", (e: L.LeafletMouseEvent) => {
        openDraftPopup(L, map, e.latlng.lat, e.latlng.lng);
      });

      leafletRef.current = L;
      setMapReady(true);

      const res = await fetch("/api/radar");
      if (cancelled || !res.ok) return;
      const { tileUrlTemplate } = (await res.json()) as { tileUrlTemplate: string };
      // Not .addTo(map) here — attachment is driven entirely by the radar
      // toggle effect below, which also covers the default-on case once
      // radarLoaded flips true.
      radarLayerRef.current = L.tileLayer(tileUrlTemplate, {
        opacity: 0.6,
        attribution: "Radar © RainViewer",
        // RainViewer's tile API tops out at zoom 7 (lib/radar.ts); without
        // this, zooming the base map in further still requests tiles at the
        // current (higher) zoom, which RainViewer doesn't have — those come
        // back as placeholder "Zoom level not supported" squares. This caps
        // the *requests* at 7 and has Leaflet upscale that same tile to fill
        // higher zoom levels instead, which is the standard way to overlay a
        // lower-resolution source on a map that zooms further.
        maxNativeZoom: 7,
      });
      setRadarLoaded(true);

      const seedRes = await fetch("/api/reports");
      if (!cancelled && seedRes.ok) {
        const reports = (await seedRes.json()) as Report[];
        for (const report of reports) knownReportsRef.current.set(report.id, report);
        renderVisibleReports(L, map);
      }

      // National list, not scoped to this map's location — the first
      // request after a 10-minute cache expiry can take several seconds
      // (fetching ~200 individual CAP alert documents server-side; see
      // lib/capWarnings.ts), so this never blocks the rest of the map's
      // setup above, same as radar/reports already don't block each other.
      void fetch("/api/bom/warning-areas")
        .then((res) => (res.ok ? (res.json() as Promise<WarningArea[]>) : []))
        .then((warnings) => {
          if (cancelled) return;
          for (const warning of warnings) {
            for (const place of warning.places) {
              L.circle([place.lat, place.lon], {
                radius: WARNING_RADIUS_METERS,
                ...warningCircleOptions(warning.severity),
              })
                .addTo(map)
                // A warning's real description + instructions (lib/capWarnings.ts)
                // can run well past the map's own height; maxHeight caps the
                // popup and Leaflet's own CSS (.leaflet-popup-scrolled) makes
                // the overflow scrollable, rather than text running off-screen.
                .bindPopup(warningPopupHtml(warning, place.name), { maxHeight: 300 });
            }
          }
        })
        .catch(() => {
          // Warning circles are an enhancement over the existing text
          // warnings list (app/page.tsx), not load-bearing — a failed fetch
          // here just means no circles this load, nothing to recover.
        });

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

  // Radar: toggles the already-constructed radarLayerRef on/off, rather
  // than constructing/destroying a new tile layer each time (which would
  // re-fetch every visible tile on every toggle).
  useEffect(() => {
    const map = mapRef.current;
    const layer = radarLayerRef.current;
    if (!map || !layer) return;
    if (toggles.radar) layer.addTo(map);
    else map.removeLayer(layer);
  }, [toggles.radar, radarLoaded]);

  // Rings: concentric circles around the selected location, purely
  // client-side (no data source) — depends on [lat, lon] so it re-centers
  // for free whenever the selected place changes, the same way the
  // existing setView effect above does.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!map || !Leaflet || !mapReady || !toggles.rings) return;
    const group = Leaflet.layerGroup(
      RING_RADII_KM.map((km) => Leaflet.circle([lat, lon], { radius: km * 1000, ...INFO_CIRCLE_OPTIONS })),
    ).addTo(map);
    return () => {
      group.remove();
    };
  }, [toggles.rings, mapReady, lat, lon]);

  // Coverage: one circle around the nearest radar station's documented
  // ~150km reliable range (see COVERAGE_RADIUS_KM's comment).
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!map || !Leaflet || !mapReady || !toggles.coverage) return;
    const station = nearestStation(lat, lon);
    const circle = Leaflet.circle([station.lat, station.lon], {
      radius: COVERAGE_RADIUS_KM * 1000,
      ...INFO_CIRCLE_OPTIONS,
    })
      .addTo(map)
      .bindPopup(`Approximate radar coverage — ${escapeHtml(station.name)}`);
    return () => {
      circle.remove();
    };
  }, [toggles.coverage, mapReady, lat, lon]);

  // Wind: one arrow per radar station (lib/wind.ts resolves each of
  // RADAR_STATIONS to its nearest real BOM weather station), fetched once
  // per toggle-on rather than polled — unlike lightning, wind observations
  // don't change on a timescale that needs refreshing while the layer is
  // open, so this matches the simpler fetch-and-group pattern Rings/Coverage
  // already use rather than Lightning's poll+diff.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!map || !Leaflet || !mapReady || !toggles.wind) return;

    const group = Leaflet.layerGroup().addTo(map);
    let cancelled = false;

    void fetch("/api/bom/wind")
      .then((res) => (res.ok ? (res.json() as Promise<WindObservation[]>) : []))
      .then((observations) => {
        if (cancelled) return;
        for (const obs of observations) {
          Leaflet.marker([obs.lat, obs.lon], { icon: windArrowIcon(Leaflet, obs.speedKmh, obs.direction) })
            .addTo(group)
            .bindPopup(windPopupHtml(obs));
        }
      })
      .catch(() => {
        // Wind arrows are an enhancement, not load-bearing — a failed
        // fetch here just means no arrows this toggle, nothing to recover.
      });

    return () => {
      cancelled = true;
      group.remove();
    };
  }, [toggles.wind, mapReady]);

  // Lightning: polls the server-buffered strike list (lib/lightning.ts) and
  // diffs against lightningMarkersRef, rather than clearing and redrawing
  // every poll, so an already-shown strike's marker (and its continuously
  // looping pulse animation) isn't needlessly torn down and recreated every
  // 20s — only strikes that are genuinely new or have aged out of the
  // server's buffer are added/removed.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!map || !Leaflet || !mapReady || !toggles.lightning) return;

    const group = Leaflet.layerGroup().addTo(map);
    let cancelled = false;

    const poll = async (): Promise<void> => {
      const res = await fetch("/api/lightning");
      if (cancelled || !res.ok) return;
      const strikes = (await res.json()) as Strike[];
      const seenKeys = new Set<string>();
      for (const s of strikes) {
        const key = `${s.time}:${s.lat}:${s.lon}`;
        seenKeys.add(key);
        if (lightningMarkersRef.current.has(key)) continue;
        const marker = Leaflet.marker([s.lat, s.lon], { icon: lightningIcon(Leaflet), interactive: false }).addTo(
          group,
        );
        lightningMarkersRef.current.set(key, marker);
      }
      for (const [key, marker] of lightningMarkersRef.current) {
        if (!seenKeys.has(key)) {
          marker.remove();
          lightningMarkersRef.current.delete(key);
        }
      }
    };

    void poll().catch(() => {
      // A relay with no SLA will sometimes be unreachable; the layer just
      // shows whatever's already on the map (possibly nothing) rather than
      // erroring, same as a failed warning-areas/radar fetch degrades today.
    });
    const interval = setInterval(() => void poll().catch(() => {}), 20_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      lightningMarkersRef.current.clear();
      group.remove();
    };
  }, [toggles.lightning, mapReady]);

  return (
    <>
      <LayersPanel toggles={toggles} onChange={setToggles} />
      <div ref={containerRef} style={{ height: "60vh", width: "100%" }} />
    </>
  );
}
