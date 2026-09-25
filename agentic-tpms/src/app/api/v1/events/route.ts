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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: string) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      client.on("notification", (msg) => {
        if (msg.channel === "tpms_events" && msg.payload) send("domain", msg.payload);
      });
      await client.query("listen tpms_events");
      send("ready", JSON.stringify({ at: new Date().toISOString() }));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 25_000);
      request.signal.addEventListener("abort", async () => {
        clearInterval(heartbeat);
        try {
          await client.query("unlisten tpms_events");
        } finally {
          await client.end().catch(() => undefined);
          controller.close();
        }
      });
    },
    async cancel() {
      clearInterval(heartbeat);
      await client.end().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
