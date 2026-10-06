import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getWeather } from "../../../../lib/bom.ts";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const geohash = req.nextUrl.searchParams.get("geohash");
  if (!geohash) return NextResponse.json({ error: "missing geohash" }, { status: 400 });

  try {
    const weather = await getWeather(geohash);
    return NextResponse.json(weather);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
