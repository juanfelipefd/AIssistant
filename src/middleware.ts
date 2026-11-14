import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// Middleware runs on the Edge runtime, where node:crypto is not fully
// available — verification here goes through jose (src/lib/auth.ts), the
// same library used to sign the token in the Node.js login route.
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = token ? await verifySessionToken(token) : false;

  if (authenticated) {
    return NextResponse.next();
  }

  // API clients get a 401, not a redirect to an HTML login page.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except: /login, /api/auth/* (login + logout), Next.js
    // static asset internals, favicon.ico, and the PWA manifest route.
    // Each exclusion is anchored to a full segment ("(?:/|$)") or the full
    // path ("$") so that e.g. /api/authorize or /loginfoo still require auth.
    "/((?!(?:login|api/auth|_next/static|_next/image)(?:/|$)|favicon\\.ico$|manifest\\.webmanifest$).*)",
  ],
};
