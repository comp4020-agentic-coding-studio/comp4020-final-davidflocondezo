import { NextRequest, NextResponse } from "next/server";
import { FORECAST_DAYS, getTemperatureObservations } from "../../../../lib/temperature.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const dayParam = request.nextUrl.searchParams.get("day");
  const day = dayParam === null ? 0 : Number(dayParam);
  if (!Number.isInteger(day) || day < 0 || day >= FORECAST_DAYS) {
    return NextResponse.json({ error: `day must be an integer 0-${FORECAST_DAYS - 1}` }, { status: 400 });
  }

  try {
    return NextResponse.json(await getTemperatureObservations(day));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
