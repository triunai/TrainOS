import { NextResponse } from "next/server";
import { readDocument } from "@/server/storage/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Evidence download. Bytes are re-hashed on every read; a file that no longer
 * matches its recorded SHA-256 is refused with 409 rather than served, so a
 * tampered artefact can never leave the vault looking genuine.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const result = await readDocument(params.id).catch(() => undefined);
  if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!result.intact) {
    return NextResponse.json({ error: "INTEGRITY_FAILURE", message: "Stored bytes do not match the recorded SHA-256", sha256: result.doc.fileHashSha256 }, { status: 409 });
  }
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "content-type": result.doc.mimeType,
      "content-disposition": `inline; filename="${result.doc.fileName.replace(/"/g, "")}"`,
      "x-content-sha256": result.doc.fileHashSha256,
      "cache-control": "private, max-age=0, no-store",
    },
  });
}
