import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { removePushSubscription } from "../../../../lib/db.ts";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { endpoint, geohash } = (await req.json()) as { endpoint?: string; geohash?: string };
  if (typeof endpoint !== "string" || typeof geohash !== "string") {
    return NextResponse.json({ error: "endpoint and geohash are required" }, { status: 400 });
  }
  removePushSubscription(endpoint, geohash);
  return NextResponse.json({});
}
