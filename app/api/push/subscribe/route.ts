import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { savePushSubscription } from "../../../../lib/db.ts";
import { isPushConfigured } from "../../../../lib/push.ts";

export const runtime = "nodejs";

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  geohash: string;
  lat: number;
  lon: number;
  placeName: string;
}

// No visitor-id ownership check here (unlike reports' create/delete) — a
// push subscription's endpoint is itself an unguessable capability URL the
// browser generated, not something a visitor_id cookie needs to additionally
// protect.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "push notifications aren't configured on this server" }, { status: 503 });
  }

  const body = (await req.json()) as Partial<SubscribeBody>;
  if (
    typeof body.endpoint !== "string" ||
    typeof body.keys?.p256dh !== "string" ||
    typeof body.keys?.auth !== "string" ||
    typeof body.geohash !== "string" ||
    typeof body.lat !== "number" ||
    typeof body.lon !== "number" ||
    typeof body.placeName !== "string"
  ) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  savePushSubscription({
    endpoint: body.endpoint,
    geohash: body.geohash,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    lat: body.lat,
    lon: body.lon,
    placeName: body.placeName,
  });
  return NextResponse.json({}, { status: 201 });
}
