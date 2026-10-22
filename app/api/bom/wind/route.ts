import { NextResponse } from "next/server";
import { getWindObservations } from "../../../../lib/wind.ts";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getWindObservations());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
