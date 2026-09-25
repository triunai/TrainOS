import pg from "pg";
import { env } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: every `tpms.domain_events` insert (stage changes and
 * friends) is NOTIFYed on `tpms_events` and forwarded here, so an open cockpit
 * page refreshes when the worker moves a package. One dedicated LISTEN
 * connection per stream — LISTEN needs a session, which a transaction-mode
 * pooler (e.g. Supabase port 6543) does not provide; point DATABASE_URL at a
 * session connection for live updates.
 */
export async function GET(request: Request) {
  const client = new pg.Client({ connectionString: env().DATABASE_URL });
  await client.connect();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  // Abort (client navigated away) and cancel (the runtime tore the stream
  // down) both land here, in either order; only the first one does anything.
  // After it, a late NOTIFY or heartbeat must not enqueue into a closed stream.
  const shutdown = async (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    await client.query("unlisten tpms_events").catch(() => undefined);
    await client.end().catch(() => undefined);
    try {
      controller?.close();
    } catch {
      /* already closed by the runtime */
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      client.on("notification", (msg) => {
        if (msg.channel === "tpms_events" && msg.payload) write(`event: domain\ndata: ${msg.payload}\n\n`);
      });
      await client.query("listen tpms_events");
      write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      heartbeat = setInterval(() => write(": keep-alive\n\n"), 25_000);
      request.signal.addEventListener("abort", () => void shutdown(controller));
    },
    async cancel() {
      await shutdown();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
