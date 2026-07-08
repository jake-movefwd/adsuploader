import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { ACCEPTED_MIME_TYPES } from "@/lib/constants";
import {
  requireToken,
  requireFacebookToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/blob/upload
 *
 * Implements the Vercel Blob client-upload handshake: the browser calls this
 * route (via `upload()` from `@vercel/blob/client`) to get a short-lived token
 * to upload bytes straight to Blob storage, bypassing this Function's request
 * body — Vercel enforces a hard 4.5MB body limit on Functions, but not on
 * direct-to-Blob uploads. Auth-gated the same way as every other route.
 */
export async function POST(req: NextRequest) {
  try {
    const token = await requireToken(req);
    requireFacebookToken(token);

    const body = (await req.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, _clientPayload) => ({
        allowedContentTypes: [...ACCEPTED_MIME_TYPES],
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // No-op: /api/meta/image reads the blob back and deletes it once
        // it has forwarded the bytes to Meta.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return unauthorizedResponse(err.message);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload token request failed" },
      { status: 400 }
    );
  }
}
