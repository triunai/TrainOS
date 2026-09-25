import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP Basic protection for the operator cockpit (TPMS_BASIC_AUTH =
 * "user:password"). Participant-facing and machine-to-machine routes stay open:
 * magic-link check-in (/c), quizzes (/q), certificate verification (/verify),
 * public APIs and webhooks — each of those authenticates by its own token or
 * signature.
 */
const PUBLIC = [/^\/c\//, /^\/q\//, /^\/verify\//, /^\/api\/v1\/public\//, /^\/api\/v1\/leads\/webhook\//, /^\/api\/v1\/whatsapp\//, /^\/api\/v1\/mail\//, /^\/api\/health/, /^\/_next\//, /^\/favicon/];

export function middleware(request: NextRequest) {
  const expected = process.env.TPMS_BASIC_AUTH;
  if (!expected) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded === expected) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="TPMS cockpit"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
