import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { confirmReport, reportExists } from "../../../../../lib/db.ts";
import { logEvent } from "../../../../../lib/logger.ts";
import { publishReportConfirmed } from "../../../../../lib/reportsBus.ts";
import { getOrIssueVisitorId } from "../../../../../lib/visitor.ts";

export const runtime = "nodejs";

// Anyone may confirm, including the report's own creator — this isn't an
// ownership check like DELETE/PATCH, it's a different kind of server-side
// rule: "at most once per visitor," enforced by report_confirmations'
// primary key (lib/db.ts), not by this handler's own logic.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const res = NextResponse.json({});
  const visitorId = getOrIssueVisitorId(req, res);

  if (!reportExists(id)) {
    logEvent({ action: "report.confirm", visitorId, allowed: false, reportId: id, reason: "not found" });
    return NextResponse.json({ error: "not found" }, { status: 404, headers: res.headers });
  }

  const { added, confirmCount } = confirmReport(id, visitorId);
  logEvent({
    action: "report.confirm",
    visitorId,
    allowed: true,
    reportId: id,
    reason: added ? undefined : "already confirmed",
  });
  if (added) publishReportConfirmed(id, confirmCount);
  return NextResponse.json({ confirmCount, confirmedByMe: true }, { headers: res.headers });
}
