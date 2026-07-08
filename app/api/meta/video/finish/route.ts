import { NextRequest, NextResponse } from "next/server";
import { finishVideoUpload, MetaApiError } from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/meta/video/finish
 * body: { accountId, uploadSessionId }
 */
export async function POST(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);

    const { accountId, uploadSessionId } = await req.json();
    if (!accountId || !uploadSessionId) {
      return NextResponse.json(
        { error: "accountId and uploadSessionId are required" },
        { status: 400 }
      );
    }

    await finishVideoUpload(accountId, fbToken, uploadSessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof MetaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to finish video upload" },
      { status: 500 }
    );
  }
}
