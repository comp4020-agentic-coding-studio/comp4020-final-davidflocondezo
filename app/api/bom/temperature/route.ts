import { NextResponse } from "next/server";
import { getTemperatureObservations } from "../../../../lib/temperature.ts";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getTemperatureObservations());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
