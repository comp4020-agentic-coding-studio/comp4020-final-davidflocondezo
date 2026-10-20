import ngeohash from "ngeohash";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createReport, listActiveReports, type Report } from "../../../lib/db.ts";
import { logEvent } from "../../../lib/logger.ts";
import { publishReport } from "../../../lib/reportsBus.ts";
import { getOrIssueVisitorId } from "../../../lib/visitor.ts";

export const runtime = "nodejs";

// `visitorId` identifies who owns a report so DELETE can enforce it
// server-side; it isn't shown to other visitors (it's not secret, but
// exposing it would let a client just claim someone else's id back as a
// cookie). `ownedByMe` is the only ownership signal a client gets.
function toPublic(report: Report, requesterId: string): Omit<Report, "visitorId"> & { ownedByMe: boolean } {
  const { visitorId, ...rest } = report;
  return { ...rest, ownedByMe: visitorId === requesterId };
}

export function GET(req: NextRequest): NextResponse {
  const res = NextResponse.json([]);
  const visitorId = getOrIssueVisitorId(req, res);
  const reports = listActiveReports(visitorId).map((r) => toPublic(r, visitorId));
  return NextResponse.json(reports, { headers: res.headers });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { lat, lon, description } = (await req.json()) as {
    lat: number;
    lon: number;
    description?: string;
  };
  const res = NextResponse.json({});
  const visitorId = getOrIssueVisitorId(req, res);

  if (typeof lat !== "number" || typeof lon !== "number") {
    logEvent({ action: "report.create", visitorId, allowed: false, reason: "invalid lat/lon" });
    return NextResponse.json({ error: "lat and lon must be numbers" }, { status: 400, headers: res.headers });
  }

  const geohash = ngeohash.encode(lat, lon, 6);
  const report = createReport(lat, lon, geohash, description ?? "", visitorId);
  logEvent({ action: "report.create", visitorId, allowed: true, reportId: report.id, geohash });
  publishReport(report);
  return NextResponse.json(toPublic(report, visitorId), { status: 201, headers: res.headers });
}
