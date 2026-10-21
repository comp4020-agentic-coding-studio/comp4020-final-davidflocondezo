import { NextResponse } from "next/server";
import { getWarningAreas } from "../../../../lib/warningAreas.ts";

export const runtime = "nodejs";

// Alerts are national, not scoped to a geohash — the client filters to
// "near me" by distance once it has the list, same shape as how reports are
// already fetched in full and filtered client-side to the visible map
// bounds (app/components/WeatherMap.tsx renderVisibleReports).
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getWarningAreas());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
