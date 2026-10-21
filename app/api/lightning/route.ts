import { NextResponse } from "next/server";
import { getRecentStrikes } from "../../../lib/lightning.ts";

export const runtime = "nodejs";

// National, like warning-areas — the client doesn't filter by map bounds,
// same reasoning as app/api/bom/warning-areas/route.ts. getRecentStrikes()
// never awaits the MQTT connection itself, so this always responds
// immediately (possibly with an empty array right after a cold start)
// rather than blocking on a third-party relay with no SLA.
export function GET(): NextResponse {
  return NextResponse.json(getRecentStrikes());
}
