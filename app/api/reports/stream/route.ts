import type { Report } from "../../../../lib/db.ts";
import { reportsBus } from "../../../../lib/reportsBus.ts";

export const runtime = "nodejs";

// SSE, not WebSockets: the app deploys as Next's standalone build
// (`node server.js`, Dockerfile), which a custom WebSocket server would
// replace. A route handler returning a stream needs no change to that shape.
export function GET(req: Request): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const onReport = (report: Report): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(report)}\n\n`));
      };

      reportsBus.on("report", onReport);

      req.signal.addEventListener("abort", () => {
        reportsBus.off("report", onReport);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
