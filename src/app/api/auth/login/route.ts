import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
} from "@/lib/auth";

// This route runs in the Node.js runtime by default (not Edge), so
// node:crypto is available here for the timing-safe password comparison.
// Signing itself still uses `jose` (see src/lib/auth.ts) so the token is
// verifiable by the Edge middleware, which cannot use node:crypto.

function safeCompare(submitted: string, expected: string): boolean {
  // Hash both values first so we always compare two fixed-length (32-byte)
  // buffers. This sidesteps timingSafeEqual's "different length" exception
  // (which would otherwise leak length information) while keeping the
  // actual comparison constant-time.
  const submittedHash = createHash("sha256").update(submitted).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(submittedHash, expectedHash);
}

export async function POST(request: NextRequest) {
  let password = "";

  try {
    const body = await request.json();
    if (typeof body?.password === "string") {
      password = body.password;
    }
  } catch {
    // Malformed body — fall through to the generic invalid-password response.
  }

  const appPassword = process.env.APP_PASSWORD ?? "";
  const passwordIsValid =
    appPassword.length > 0 && safeCompare(password, appPassword);

  if (!passwordIsValid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await signSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
