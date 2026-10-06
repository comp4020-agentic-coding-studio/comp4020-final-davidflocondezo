import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { searchLocations } from "../../../../lib/bom.ts";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) return NextResponse.json({ error: "missing q" }, { status: 400 });

  try {
    const results = await searchLocations(query);
    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
