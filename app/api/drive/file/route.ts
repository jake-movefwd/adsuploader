import { NextRequest, NextResponse } from "next/server";
import {
  fetchDriveFileResponse,
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
// Large videos can take a while to stream through; hint a generous duration.
export const maxDuration = 300;

/**
 * GET /api/drive/file?fileId=...
 *
 * Streams the original bytes of a Drive image or video back to the browser:
 * images for the client-side cropper, videos for the thumbnail picker (which
 * scrubs frames locally). Uses the already-held `drive.readonly` scope (no
 * re-consent).
 *
 * The browser's Range header is forwarded to Drive and the upstream stream is
 * piped straight through (never buffered whole in memory), so a `<video>`
 * element fetches only the byte ranges it needs to scrub — this is what stops
 * large videos from 500ing the function on an out-of-memory / timeout.
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

    const range = req.headers.get("range");
    const upstream = await fetchDriveFileResponse(googleToken, fileId, range);

    const headers = new Headers();
    headers.set("Content-Type", meta.mimeType);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    // 206 for a partial range, 200 for a full body.
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
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
