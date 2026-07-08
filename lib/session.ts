import { getToken, type JWT } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Reads the decrypted, server-only JWT (which contains provider access tokens)
 * for the current request. Returns null when the request is unauthenticated.
 *
 * Use this in API routes — NOT getServerSession — when you need the raw tokens.
 * The client-facing session shape never carries tokens.
 */
export async function getRequestToken(req: NextRequest): Promise<JWT | null> {
  return getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });
}

export class UnauthorizedError extends Error {}

/**
 * Guard for API routes: returns the JWT or throws UnauthorizedError.
 * Pair with `unauthorizedResponse()` in a try/catch, or use `requireSession`.
 */
export async function requireToken(req: NextRequest): Promise<JWT> {
  const token = await getRequestToken(req);
  if (!token) throw new UnauthorizedError("Not authenticated");
  return token;
}

/** The Facebook access token, or throws if the session lacks it. */
export function requireFacebookToken(token: JWT): string {
  const t = token.facebook?.accessToken;
  if (!t) {
    throw new UnauthorizedError("Facebook account not connected");
  }
  return t;
}

/** The Google access token, or throws if the session lacks it. */
export function requireGoogleToken(token: JWT): string {
  const t = token.google?.accessToken;
  if (!t) {
    throw new UnauthorizedError("Google account not connected");
  }
  return t;
}

export function unauthorizedResponse(message = "Not authenticated") {
  return NextResponse.json({ error: message }, { status: 401 });
}
