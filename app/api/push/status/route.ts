import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isPushSubscribed } from "../../../../lib/push.ts";

export const runtime = "nodejs";

// A browser's PushSubscription endpoint is stable across page loads, but the
// browser itself never persists "which geohashes did I subscribe for" —
// that only lives in push_subscriptions here. This is how PushToggle knows
// whether to render as already-on after a reload.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");
  const geohash = searchParams.get("geohash");
  if (!endpoint || !geohash) {
    return NextResponse.json({ error: "endpoint and geohash are required" }, { status: 400 });
  }
  return NextResponse.json({ subscribed: isPushSubscribed(endpoint, geohash) });
}
