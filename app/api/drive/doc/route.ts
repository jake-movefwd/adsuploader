import { NextRequest, NextResponse } from "next/server";
import { createDoc, DriveApiError } from "@/lib/drive";
import {
  requireToken,
  requireGoogleToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/drive/doc
 *
 * Body: application/json { name, folderId, videoId?, accountId? }
 *
 * Creates a Google Doc named `name` in the user-picked `folderId`, seeded with a
 * heading + a reference back to the Meta video, and returns { url } — the Doc's
 * shareable link. Called from the client only after a video upload succeeds, so a
 * failure here never affects the ad upload itself.
 *
 * Guarded by requireToken + requireGoogleToken (defense-in-depth; middleware
 * excludes /api/*). A 403 caused by a missing scope is returned with
 * needsReconnect:true so the UI can prompt a one-time Google re-consent.
 */
export async function POST(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const googleToken = requireGoogleToken(token);

    const { name, folderId, videoId, accountId } = await req.json();
    if (!name || !folderId) {
      return NextResponse.json(
        { error: "name and folderId are required" },
        { status: 400 }
      );
    }

    const seedText = videoId
      ? `Meta video: ${videoId}${accountId ? ` (account ${accountId})` : ""}`
      : "";

    const url = await createDoc(googleToken, name, folderId, seedText);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return unauthorizedResponse(err.message);
    }
    if (err instanceof DriveApiError) {
      return NextResponse.json(
        { error: err.message, needsReconnect: err.needsReconnect },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Failed to create Google Doc" },
      { status: 500 }
    );
  }
}
