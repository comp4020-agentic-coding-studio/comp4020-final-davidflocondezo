import { NextResponse } from "next/server";
import { getCapAlerts } from "../../../../lib/capWarnings.ts";
import { resolveWarningPlaces, type WarningPlace } from "../../../../lib/warningPlaces.ts";

export const runtime = "nodejs";

export interface WarningArea {
  id: string;
  headline: string;
  description: string;
  instruction: string;
  severity: string;
  places: WarningPlace[];
}

// BOM's location search (lib/bom.ts, used by resolveWarningPlaces) is a
// reverse-engineered, rate-limited endpoint that already drew a live 403
// during testing under heavier concurrent load. Alerts are resolved in
// small batches rather than all at once, trading a little latency for not
// hammering a third party's API with 100+ simultaneous requests.
const RESOLVE_CONCURRENCY = 8;

// Alerts are national, not scoped to a geohash — the client filters to
// "near me" by distance once it has the list, same shape as how reports are
// already fetched in full and filtered client-side to the visible map
// bounds (app/components/WeatherMap.tsx renderVisibleReports).
export async function GET(): Promise<NextResponse> {
  try {
    const alerts = await getCapAlerts();
    const resolved: WarningArea[] = [];
    for (let i = 0; i < alerts.length; i += RESOLVE_CONCURRENCY) {
      const batch = alerts.slice(i, i + RESOLVE_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (alert) => ({
          id: alert.id,
          headline: alert.headline,
          description: alert.description,
          instruction: alert.instruction,
          severity: alert.severity,
          places: await resolveWarningPlaces(alert),
        })),
      );
      for (const area of batchResults) if (area.places.length > 0) resolved.push(area);
    }
    return NextResponse.json(resolved);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
