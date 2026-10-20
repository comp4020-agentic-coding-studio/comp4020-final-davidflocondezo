import { expect, inject, it } from "vitest";

// Crit 10's failure condition, made mechanical: one visitor must never be
// able to alter another visitor's data, and that must be enforced on the
// server regardless of what any UI shows. Two "visitors" here are two
// fetch() calls that don't share cookies — the same shape as two browser
// profiles with no shared storage.
const baseUrl = inject("baseUrl");

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}

it("a visitor cannot delete another visitor's report", async () => {
  const lat = -35.3 + Math.random() * 0.01;
  const lon = 149.1 + Math.random() * 0.01;

  const postRes = await fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, description: "owned by visitor A" }),
  });
  expect(postRes.status).toBe(201);
  const ownerCookie = cookieFrom(postRes);
  const created = (await postRes.json()) as { id: string; ownedByMe: boolean };
  expect(created.ownedByMe).toBe(true);

  // No cookie sent at all: a fresh visitor, issued their own id server-side.
  const strangerDelete = await fetch(new URL(`/api/reports/${created.id}`, baseUrl), {
    method: "DELETE",
  });
  expect(strangerDelete.status).toBe(403);

  // The report must still be there for the stranger's rejection to mean
  // anything.
  const listRes = await fetch(new URL("/api/reports", baseUrl));
  const reports = (await listRes.json()) as { id: string }[];
  expect(reports.some((r) => r.id === created.id)).toBe(true);

  // The actual owner can still delete it.
  const ownerDelete = await fetch(new URL(`/api/reports/${created.id}`, baseUrl), {
    method: "DELETE",
    headers: { cookie: ownerCookie },
  });
  expect(ownerDelete.status).toBe(204);
});

it("other visitors never see a report's owner, only their own ownership", async () => {
  const lat = -35.3 + Math.random() * 0.01;
  const lon = 149.1 + Math.random() * 0.01;

  const postRes = await fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon }),
  });
  const created = (await postRes.json()) as Record<string, unknown>;
  expect(created).not.toHaveProperty("visitorId");
  expect(created).not.toHaveProperty("visitor_id");

  const strangerList = await fetch(new URL("/api/reports", baseUrl));
  const reports = (await strangerList.json()) as Record<string, unknown>[];
  const found = reports.find((r) => r.id === created.id);
  expect(found).not.toHaveProperty("visitorId");
  expect(found?.ownedByMe).toBe(false);
});

it("a visitor cannot edit another visitor's report", async () => {
  const lat = -35.3 + Math.random() * 0.01;
  const lon = 149.1 + Math.random() * 0.01;

  const postRes = await fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, description: "original" }),
  });
  const ownerCookie = cookieFrom(postRes);
  const created = (await postRes.json()) as { id: string };

  const strangerEdit = await fetch(new URL(`/api/reports/${created.id}`, baseUrl), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "hijacked" }),
  });
  expect(strangerEdit.status).toBe(403);

  const listRes = await fetch(new URL("/api/reports", baseUrl));
  const reports = (await listRes.json()) as { id: string; description: string }[];
  expect(reports.find((r) => r.id === created.id)?.description).toBe("original");

  const ownerEdit = await fetch(new URL(`/api/reports/${created.id}`, baseUrl), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ description: "updated by owner" }),
  });
  expect(ownerEdit.status).toBe(200);

  const listRes2 = await fetch(new URL("/api/reports", baseUrl));
  const reports2 = (await listRes2.json()) as { id: string; description: string }[];
  expect(reports2.find((r) => r.id === created.id)?.description).toBe("updated by owner");
});

it("confirming a report is capped at once per visitor, and anyone (including the owner) may confirm", async () => {
  const lat = -35.3 + Math.random() * 0.01;
  const lon = 149.1 + Math.random() * 0.01;

  const postRes = await fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon }),
  });
  const ownerCookie = cookieFrom(postRes);
  const created = (await postRes.json()) as { id: string; confirmCount: number };
  expect(created.confirmCount).toBe(0);

  // The owner confirms their own report (self-confirm is allowed).
  const ownerConfirm = await fetch(new URL(`/api/reports/${created.id}/confirm`, baseUrl), {
    method: "POST",
    headers: { cookie: ownerCookie },
  });
  expect(ownerConfirm.status).toBe(200);
  expect((await ownerConfirm.json()) as { confirmCount: number }).toMatchObject({ confirmCount: 1 });

  // Confirming again from the same cookie jar is a no-op, not an error.
  const ownerConfirmAgain = await fetch(new URL(`/api/reports/${created.id}/confirm`, baseUrl), {
    method: "POST",
    headers: { cookie: ownerCookie },
  });
  expect(ownerConfirmAgain.status).toBe(200);
  expect((await ownerConfirmAgain.json()) as { confirmCount: number }).toMatchObject({ confirmCount: 1 });

  // A different visitor (no cookie sent) brings the count to 2.
  const strangerConfirm = await fetch(new URL(`/api/reports/${created.id}/confirm`, baseUrl), {
    method: "POST",
  });
  expect(strangerConfirm.status).toBe(200);
  expect((await strangerConfirm.json()) as { confirmCount: number }).toMatchObject({ confirmCount: 2 });
  const strangerCookie = cookieFrom(strangerConfirm);

  // That same stranger's own view sees confirmedByMe: true; it's
  // requester-relative, not a shared fact every visitor would see the same way.
  const strangerList = await fetch(new URL("/api/reports", baseUrl), {
    headers: { cookie: strangerCookie },
  });
  const strangerReports = (await strangerList.json()) as { id: string; confirmedByMe: boolean }[];
  expect(strangerReports.find((r) => r.id === created.id)?.confirmedByMe).toBe(true);
});
