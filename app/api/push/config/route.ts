import { NextResponse } from "next/server";
import { getVapidPublicKey, isPushConfigured } from "../../../../lib/push.ts";

export const runtime = "nodejs";

// Lets the client know whether to even offer the notify toggle — a repo run
// without VAPID keys set (lib/push.ts) has nothing for PushManager.subscribe
// to use.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ configured: isPushConfigured(), publicKey: getVapidPublicKey() });
}
