import { NextRequest, NextResponse } from "next/server";
import { getVideoStatus, MetaApiError } from "@/lib/meta";
import { requireToken, requireFacebookToken } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/meta/video/status?videoId=...
 *
 * Lightweight poll for a video's Meta processing (transcode) state. The upload
 * routes (from-drive / from-blob) return as soon as the bytes are transferred;
 * the client polls this until `ready` before using the video in an ad. Keeping
 * the (potentially minutes-long) transcode wait OFF the upload function is what
 * stops large videos from timing it out.
 *
 * Returns { processingProgress, videoStatus, ready }.
 */
export async function GET(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);

    const videoId = req.nextUrl.searchParams.get("videoId");
    if (!videoId) {
      return NextResponse.json(
        { error: "videoId is required" },
        { status: 400 }
      );
    }

    const status = await getVideoStatus(fbToken, videoId);
    return NextResponse.json(status);
  } catch (err) {
    const status = err instanceof MetaApiError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to read video status";
    return NextResponse.json({ error: message }, { status });
  }
}
