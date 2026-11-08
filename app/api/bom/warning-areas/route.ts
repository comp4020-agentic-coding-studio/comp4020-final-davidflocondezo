import { NextResponse } from "next/server";
import { checkAndNotify } from "../../../../lib/push.ts";
import { getWarningAreas } from "../../../../lib/warningAreas.ts";

export const runtime = "nodejs";

// Alerts are national, not scoped to a geohash — the client filters to
// "near me" by distance once it has the list, same shape as how reports are
// already fetched in full and filtered client-side to the visible map
// bounds (app/components/WeatherMap.tsx renderVisibleReports).
export async function GET(): Promise<NextResponse> {
  try {
    const warnings = await getWarningAreas();
    // Rides along on this fetch rather than its own schedule — see
    // checkAndNotify's comment (lib/push.ts) for why. Never blocks or fails
    // this response: a push error is independent of what this request asked
    // for.
    void checkAndNotify(warnings).catch(() => {});
    return NextResponse.json(warnings);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
