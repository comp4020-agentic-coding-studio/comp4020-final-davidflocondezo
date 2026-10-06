import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const COOKIE = "visitor_id";

export function getOrIssueVisitorId(
  req: NextRequest,
  res: NextResponse,
): string {
  const existing = req.cookies.get(COOKIE)?.value;
  if (existing) return existing;

  const id = randomUUID();
  res.cookies.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}
