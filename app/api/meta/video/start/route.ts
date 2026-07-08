import { NextRequest, NextResponse } from "next/server";
import { startVideoUpload, MetaApiError } from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/meta/video/start
 * body: { accountId, fileSize }
 * -> { videoId, uploadSessionId, startOffset, endOffset }
 */
export async function POST(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);

    const { accountId, fileSize } = await req.json();
    if (!accountId || typeof fileSize !== "number" || fileSize <= 0) {
      return NextResponse.json(
        { error: "accountId and a positive fileSize are required" },
        { status: 400 }
      );
    }

    const result = await startVideoUpload(accountId, fbToken, fileSize);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof MetaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to start video upload" },
      { status: 500 }
    );
  }
}
