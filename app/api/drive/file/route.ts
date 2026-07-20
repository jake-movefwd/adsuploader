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
import { isAcceptedMimeType } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * GET /api/drive/file?fileId=...
 *
 * Streams the original bytes of a Drive image or video back to the browser:
 * images for the client-side cropper, videos for the thumbnail picker (which
 * scrubs frames locally). Uses the already-held `drive.readonly` scope (no
 * re-consent). Bytes are held in memory only — large videos are downloaded in
 * full so they can be scrubbed.
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
    if (!isAcceptedMimeType(meta.mimeType)) {
      return NextResponse.json(
        { error: `Not a supported file: ${meta.mimeType}` },
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
      { error: "Failed to load Drive file" },
      { status: 500 }
    );
  }
}
