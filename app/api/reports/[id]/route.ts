import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  deleteReportIfOwner,
  reportExists,
  REPORT_DESCRIPTION_MAX_LENGTH,
  updateReportDescriptionIfOwner,
} from "../../../../lib/db.ts";
import { logEvent } from "../../../../lib/logger.ts";
import { publishReportDeleted, publishReportEdited } from "../../../../lib/reportsBus.ts";
import { getOrIssueVisitorId } from "../../../../lib/visitor.ts";

export const runtime = "nodejs";

// Ownership is enforced here, server-side, regardless of what the UI shows:
// deleting someone else's report always fails with 403, even if a client is
// hand-crafting the request (see crit 10 spec — this is the thing the demo
// has to prove, not just imply).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const res = NextResponse.json({});
  const visitorId = getOrIssueVisitorId(req, res);

  const deleted = deleteReportIfOwner(id, visitorId);
  if (deleted) {
    logEvent({ action: "report.delete", visitorId, allowed: true, reportId: id });
    publishReportDeleted(id);
    return new NextResponse(null, { status: 204, headers: res.headers });
  }

  const exists = reportExists(id);
  logEvent({
    action: "report.delete",
    visitorId,
    allowed: false,
    reportId: id,
    reason: exists ? "not the owner" : "not found",
  });
  return NextResponse.json(
    { error: exists ? "you didn't create this report" : "not found" },
    { status: exists ? 403 : 404, headers: res.headers },
  );
}

// Same ownership shape as DELETE: the check lives inside the UPDATE's WHERE
// clause (lib/db.ts), so editing someone else's report always fails
// regardless of what the UI shows.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { description } = (await req.json()) as { description?: string };
  const res = NextResponse.json({});
  const visitorId = getOrIssueVisitorId(req, res);

  if (typeof description !== "string") {
    return NextResponse.json({ error: "description must be a string" }, { status: 400, headers: res.headers });
  }

  const updated = updateReportDescriptionIfOwner(id, visitorId, description);
  if (updated) {
    logEvent({ action: "report.edit", visitorId, allowed: true, reportId: id });
    publishReportEdited(id, description.slice(0, REPORT_DESCRIPTION_MAX_LENGTH));
    return NextResponse.json({ ok: true }, { headers: res.headers });
  }

  const exists = reportExists(id);
  logEvent({
    action: "report.edit",
    visitorId,
    allowed: false,
    reportId: id,
    reason: exists ? "not the owner" : "not found",
  });
  return NextResponse.json(
    { error: exists ? "you didn't create this report" : "not found" },
    { status: exists ? 403 : 404, headers: res.headers },
  );
}
