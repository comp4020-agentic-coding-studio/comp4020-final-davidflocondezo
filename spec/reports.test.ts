import http from "node:http";
import https from "node:https";
import { expect, inject, it } from "vitest";

// Mechanical checks for the crit 9 real-time requirement: a report posted by
// one client (a) persists (so a reload or a later viewer sees it) and (b)
// reaches an already-open connection live, without that connection polling
// for it.
const baseUrl = inject("baseUrl");

it("a posted report is returned by GET /api/reports", async () => {
  const lat = -35.3 + Math.random() * 0.01;
  const lon = 149.1 + Math.random() * 0.01;

  const postRes = await fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon }),
  });
  expect(postRes.status).toBe(201);
  const created = (await postRes.json()) as { id: string; lat: number; lon: number };

  const listRes = await fetch(new URL("/api/reports", baseUrl));
  expect(listRes.status).toBe(200);
  const reports = (await listRes.json()) as { id: string }[];
  expect(reports.some((r) => r.id === created.id)).toBe(true);
});

it("a posted report reaches an already-open /api/reports/stream connection", async () => {
  // Opened with node:http, not fetch: Node's fetch (undici) shares one
  // connection pool per process, and a fetch() left holding this stream's
  // body open can starve a later fetch() POST to the same origin in this
  // same process — a test-harness artifact (a browser's two tabs don't share
  // a pool), not a real server limitation. node:http sidesteps it.
  const streamUrl = new URL("/api/reports/stream", baseUrl);
  const client = streamUrl.protocol === "https:" ? https : http;
  let onChunk: ((text: string) => void) | undefined;
  const req = client.get(streamUrl, (res) => {
    res.on("data", (chunk: Buffer) => onChunk?.(chunk.toString()));
  });
  req.on("error", () => {});

  const received = new Promise<{ lat: number; lon: number }>((resolve) => {
    let buffer = "";
    onChunk = (text) => {
      buffer += text;
      const match = buffer.match(/^data: (.*)$/m);
      if (match) resolve(JSON.parse(match[1]));
    };
  });

  const lat = -35.3 + Math.random() * 0.01;
  const lon = 149.1 + Math.random() * 0.01;

  // Give the stream a moment to be registered server-side before posting.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fetch(new URL("/api/reports", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon }),
  });

  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2000));
  const report = await Promise.race([received, timeout]);
  req.destroy();

  expect(report, "no report arrived on the open stream within 2s").toBeDefined();
  expect(report?.lat).toBeCloseTo(lat, 5);
  expect(report?.lon).toBeCloseTo(lon, 5);
}, 10_000);
