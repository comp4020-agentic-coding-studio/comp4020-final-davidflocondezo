import { expect, inject, it } from "vitest";

// GET /api/lightning must respond immediately regardless of whether the
// server's MQTT connection to the Blitzortung relay (lib/lightning.ts) has
// actually connected — getRecentStrikes() never awaits the socket, so this
// never hangs even if the sandbox/CI network can't reach a third-party
// relay with no SLA.
const baseUrl = inject("baseUrl");

it("GET /api/lightning responds with a JSON array", async () => {
  const res = await fetch(new URL("/api/lightning", baseUrl));
  expect(res.status).toBe(200);
  const strikes = await res.json();
  expect(Array.isArray(strikes)).toBe(true);
});
