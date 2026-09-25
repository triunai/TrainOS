import { NextResponse } from "next/server";
import { readCertificatePdf } from "@/server/certificates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public certificate download. Revoked or tampered files are never served. */
export async function GET(_request: Request, { params }: { params: { serial: string } }) {
  const pdf = await readCertificatePdf(decodeURIComponent(params.serial)).catch(() => undefined);
  if (!pdf) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (pdf.revoked) return NextResponse.json({ error: "REVOKED" }, { status: 410 });
  if (!pdf.intact) return NextResponse.json({ error: "INTEGRITY_FAILURE" }, { status: 409 });
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${pdf.fileName}"`, "cache-control": "public, max-age=300" },
  });
}
