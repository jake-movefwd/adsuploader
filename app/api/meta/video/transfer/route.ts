import { NextRequest, NextResponse } from "next/server";
import { transferVideoChunk, MetaApiError } from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/meta/video/transfer  (multipart/form-data)
 * fields: accountId, uploadSessionId, startOffset, chunk (Blob)
 * -> { startOffset, endOffset }  (next offsets; equal means done)
 *
 * The client drives the chunk loop so it can render accurate per-chunk progress;
 * the Facebook token stays server-side here.
 */
export async function POST(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);

    const form = await req.formData();
    const accountId = form.get("accountId");
    const uploadSessionId = form.get("uploadSessionId");
    const startOffsetRaw = form.get("startOffset");
    const chunk = form.get("chunk");

    if (
      typeof accountId !== "string" ||
      typeof uploadSessionId !== "string" ||
      typeof startOffsetRaw !== "string" ||
      !(chunk instanceof Blob)
    ) {
      return NextResponse.json(
        { error: "accountId, uploadSessionId, startOffset and chunk are required" },
        { status: 400 }
      );
    }

    const result = await transferVideoChunk(
      accountId,
      fbToken,
      uploadSessionId,
      Number(startOffsetRaw),
      chunk
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof MetaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to transfer video chunk" },
      { status: 500 }
    );
  }
}
