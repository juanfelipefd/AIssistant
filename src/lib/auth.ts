import { SignJWT, jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

// Shared session-token logic used by BOTH the Node.js login API route and
// the Edge-runtime middleware. `jose` works identically in both runtimes,
// unlike `node:crypto`/`jsonwebtoken`, which are unavailable on Edge — so
// all JWT signing/verification for the session cookie lives here.

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs a minimal session JWT. This is a single-user app, so the payload
 * only needs to assert "this request is authenticated" — no user id, no
 * roles.
 */
export async function signSessionToken(): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Verifies a session JWT. Returns false for any invalid, expired, or
 * malformed token rather than throwing.
 */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecretKey());
    return true;
  } catch {
    return false;
  }
}

/**
 * Session guard for API route handlers. Middleware is the first line of
 * defense, not the only one — every protected route calls this itself:
 *
 *   const denied = await requireSession(request);
 *   if (denied) return denied;
 *
 * Returns a 401 response when the request has no valid session, or null
 * when it does.
 */
export async function requireSession(
  request: NextRequest,
): Promise<NextResponse | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token && (await verifySessionToken(token))) {
    return null;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
