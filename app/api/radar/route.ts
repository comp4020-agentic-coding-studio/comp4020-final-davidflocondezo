import { NextResponse } from "next/server";
import { latestRadarTileUrlTemplate } from "../../../lib/radar.ts";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const tileUrlTemplate = await latestRadarTileUrlTemplate();
  return NextResponse.json({ tileUrlTemplate });
}
