import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTrace, saveTrace } from "../../../lib/db.ts";
import { logEvent } from "../../../lib/logger.ts";
import { getOrIssueVisitorId } from "../../../lib/visitor.ts";

export const runtime = "nodejs";

export function GET(req: NextRequest): NextResponse {
  const res = NextResponse.json({});
  const visitorId = getOrIssueVisitorId(req, res);
  const trace = getTrace(visitorId);
  return NextResponse.json(trace ?? null, { headers: res.headers });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { geohash: string; name: string; lat: number; lon: number };
  const res = NextResponse.json({ ok: true });
  const visitorId = getOrIssueVisitorId(req, res);
  saveTrace(visitorId, body);
  logEvent({ action: "trace.save", visitorId, allowed: true, geohash: body.geohash });
  return res;
}
