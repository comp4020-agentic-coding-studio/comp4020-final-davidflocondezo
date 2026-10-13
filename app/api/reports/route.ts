import ngeohash from "ngeohash";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createReport, listActiveReports } from "../../../lib/db.ts";
import { publishReport } from "../../../lib/reportsBus.ts";

export const runtime = "nodejs";

export function GET(): NextResponse {
  return NextResponse.json(listActiveReports());
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { lat, lon, description } = (await req.json()) as {
    lat: number;
    lon: number;
    description?: string;
  };
  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "lat and lon must be numbers" }, { status: 400 });
  }

  const geohash = ngeohash.encode(lat, lon, 6);
  const report = createReport(lat, lon, geohash, description ?? "");
  publishReport(report);
  return NextResponse.json(report, { status: 201 });
}
