import type { BroadcastReport } from "../../../../lib/reportsBus.ts";
import { reportsBus } from "../../../../lib/reportsBus.ts";

export const runtime = "nodejs";

// SSE, not WebSockets: the app deploys as Next's standalone build
// (`node server.js`, Dockerfile), which a custom WebSocket server would
// replace. A route handler returning a stream needs no change to that shape.
export function GET(req: Request): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const onReport = (report: BroadcastReport): void => {
        controller.enqueue(
          encoder.encode(`event: created\ndata: ${JSON.stringify(report)}\n\n`),
        );
      };
      const onReportDeleted = (id: string): void => {
        controller.enqueue(encoder.encode(`event: deleted\ndata: ${JSON.stringify({ id })}\n\n`));
      };
      const onReportEdited = (payload: { id: string; description: string }): void => {
        controller.enqueue(encoder.encode(`event: edited\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const onReportConfirmed = (payload: { id: string; confirmCount: number }): void => {
        controller.enqueue(encoder.encode(`event: confirmed\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      reportsBus.on("report", onReport);
      reportsBus.on("report-deleted", onReportDeleted);
      reportsBus.on("report-edited", onReportEdited);
      reportsBus.on("report-confirmed", onReportConfirmed);

      req.signal.addEventListener("abort", () => {
        reportsBus.off("report", onReport);
        reportsBus.off("report-deleted", onReportDeleted);
        reportsBus.off("report-edited", onReportEdited);
        reportsBus.off("report-confirmed", onReportConfirmed);
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
