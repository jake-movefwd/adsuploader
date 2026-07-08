import { NextRequest, NextResponse } from "next/server";
import { getVideoStatus, MetaApiError } from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/meta/video/status?videoId=...
 * -> { processingProgress, videoStatus, ready }
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
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof MetaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to fetch video status" },
      { status: 500 }
    );
  }
}
