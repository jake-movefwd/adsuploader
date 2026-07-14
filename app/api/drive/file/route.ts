import { NextRequest, NextResponse } from "next/server";
import {
  downloadDriveFile,
  getDriveFileMeta,
  DriveApiError,
} from "@/lib/drive";
import {
  requireToken,
  requireGoogleToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";
import { isAcceptedMimeType, isVideoMime } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * GET /api/drive/file?fileId=...
 *
 * Streams the original bytes of a Drive **image** back to the browser so the
 * client-side cropper can display it. Uses the already-held `drive.readonly`
 * scope (no re-consent). Videos are rejected — they're never cropped, and this
 * is only meant for small image files. Bytes are held in memory only.
 */
export async function GET(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const googleToken = requireGoogleToken(token);

    const fileId = req.nextUrl.searchParams.get("fileId");
    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    const meta = await getDriveFileMeta(googleToken, fileId);
    if (!isAcceptedMimeType(meta.mimeType) || isVideoMime(meta.mimeType)) {
      return NextResponse.json(
        { error: `Not a supported image: ${meta.mimeType}` },
        { status: 400 }
      );
    }

    const blob = await downloadDriveFile(googleToken, fileId);
    return new NextResponse(blob, {
      headers: {
        "Content-Type": meta.mimeType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return unauthorizedResponse(err.message);
    }
    if (err instanceof DriveApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load Drive image" },
      { status: 500 }
    );
  }
}
